# CONTRATO DE INTEGRACIÓN — v1.1.0 (2026-11-06)

Contrato **versionado y coordinado** entre CRM-ALBRA (Capa 0), WHATSPOWER (Capa 2A) y WHATSPOWER-ULTRA (Capa 2B). Cada repositorio es autónomo y desplegable por separado: este contrato describe los compromisos externos, no dependencias de código.

## 1. Identidad y organización

- Toda identidad administrativa o de servicio está **ligada a una organización** (`organizationId`).
- La organización del llamador se resuelve SIEMPRE de la credencial verificada (clave API/HMAC/secreto interno). **Jamás** se acepta `organizationId` del body, query o cabecera de cliente para autorizar.
- Cabecera `X-Org-Id`: opcional en Capa 2A SOLO como restricción adicional (una clave por-org no puede operar otra org); jamás amplía privilegios.
- Identidades de servicio con privilegios globales (clave sin `:org` en Capa 2B) quedan limitadas a operadores de infraestructura y quedan registradas en `audit_log`.

## 2. Autenticación server-to-server

| Enlace | Mecanismo |
|---|---|
| CRM → 2A (locks/supresión/inbound) | `Authorization: Bearer <INTERNAL_API_SECRET>` (legacy → org `default`) o `INTERNAL_API_KEYS` `orgId:secreto[:rol]` |
| 2B → 2A (locks/supresión JIT) | `Authorization: Bearer <AGENTIC_2A_INTERNAL_SECRET>` |
| Webhooks entrantes 2A/2B | HMAC-SHA256 v2 (§3) |
| CRM → 2B / 2B → CRM (despacho) | Adaptador daemon con gate `ALLOW_REAL_DISPATCH` |

Regla de roles en 2A: liberar locks y eliminar supresiones exige rol `admin`.

## 3. Firmas HMAC v2 y anti-replay (ROMPIENTE coordinado con v1.0)

- `X-Timestamp`: segundos UNIX, ventana aceptada **±300 s**.
- `X-Signature-SHA256`: `v2=<hex>` donde `hex = HMAC-SHA256(secret, timestamp + "." + rawBody)`.
  - El **timestamp entra en la MAC**: modificarlo invalida la firma (anti-replay real).
  - Comparación **timing-safe** (`crypto.timingSafeEqual`).
  - Se acepta `v2=` explícito o hex desnudo durante la transición, pero SIEMPRE sobre `timestamp.body`.
- **Anti-replay persistente**: huella de `(timestamp, body)` almacenada en SQLite (`replay_fingerprints`/`webhook_replay`), purga >600 s. Sobrevive reinicios del proceso (invariante: instancia única por BD).
- **X-Event-Id**: UUID obligatorio cuando la operación tiene efectos externos. Idempotencia persistente con clave `orgId::eventId` (SQLite), purga 7 días.
- **Secretos por integración/organización**: 2B usa `WEBHOOK_LEAD_SECRETS=orgId:secreto,orgId:secreto`; el secreto que valida el HMAC VINCULA la organización. El secreto legacy `WEBHOOK_LEAD_SECRET` vincula únicamente la org `default`. En producción, 2B exige secretos por-org.
- Rotación: publicar el nuevo secreto junto al antiguo (ambos válidos en la ventana de transición), cambiar emisor, retirar el antiguo. Jamás se rompe la verificación durante la rotación.

## 4. Los 7 rechazos obligatorios (verificados por tests en 2A y 2B)

1. Firma válida + timestamp modificado → **401**.
2. Petición repetida (misma huella) → **401**.
3. Firma incorrecta → **401**.
4. Timestamp vencido → **401**.
5. Secreto ausente → **503** fail-closed.
6. Eventos legítimos de organizaciones distintas → sin colisión, cada uno en su org.
7. Dos peticiones simultáneas del mismo evento → **una sola** operación (idempotencia).

## 5. Colas, campañas y despacho (Capa 2B)

- **Claim atómico**: `UPDATE campaign_items SET status='DISPATCHING' WHERE id=? AND status='PENDING'`; `changes=0` → otro worker lo tomó (jamás doble despacho).
- Toda transición posterior usa guard `WHERE status='DISPATCHING'`.
- **UNCERTAIN_DISPATCH** para resultados de red inciertos; jamás reintento ciego.
- **Reconciliación controlada**: `FAILED_RETRYABLE` reintenta máx. **3** intentos vía claim condicional; después → `FAILED` permanente. `recoverFromCrash` reconcilia huérfanos al arrancar.
- **ALLOW_REAL_DISPATCH** (gate de envío real): exigido por TODOS los adaptadores (daemon y Meta Cloud). Fail-closed: duda/ausencia/config incompleta ⇒ bloqueo. En pruebas JAMÁS se activa.
- Pacing: intervalo entre despachos lo impone el llamador vía `nextPacingDelayMs` (jitter 15–35 s por defecto); cooldown por lote con vencimiento temporal y reset automático.
- Supresión y locks se comprueban **JIT, inmediatamente antes del despacho** (no solo al encolar); fallo de comprobación ⇒ bloqueo del envío.

## 6. Estados y transiciones

- Campaña (2B): `DRAFT → RUNNING ⇄ PAUSED → CANCELLED|COMPLETED`; terminales `COMPLETED/CANCELLED` intocables (409). `/step` solo procesa campañas `RUNNING`.
- Pago (2A): `PENDING → APPROVED | REJECTED` (terminales). Otro cambio → **409**. `status` fuera de whitelist → 400. Auditoría en `payment_audit`.
- Modos de pago 2A: `PAYMENTS_MODE=simulator|sandbox|production` (obligatoria en producción); el simulador se etiqueta y jamás se presenta como cobro real.

## 7. Entradas, límites y abuso

- Cuerpo máx. **1 MB** en todas las rutas que leen body; error de stream ⇒ rechazo (jamás cuerpo parcial); exceso ⇒ **413** con drenaje con tope.
- Rate limiting: 2B general 120/min por identidad (30/min webhook-lead por org); 2A por ruta (inbound, pagos, qr). Excedido ⇒ **429 + Retry-After**.
- `x-forwarded-for` ignorado salvo `TRUST_PROXY==='true'`.
- Destinos de enlaces rastreados: solo `http(s)://` absoluto.
- Errores 5xx: mensaje genérico al cliente; detalle solo en log del servidor. Logs jamás contienen secretos, teléfonos ni cuerpos.

## 8. Timeouts y reintentos entre servicios

- Checks S2S (locks/supresión): timeout 1500 ms; fallo o respuesta no-OK ⇒ **fail-closed** (no disponible ⇒ no despacho).
- Despacho externo (Meta/daemon): timeout y clasificación de resultado incierto ⇒ `UNCERTAIN_DISPATCH`.
- Webhooks: ventana ±300 s; fuera de ventana el emisor debe reenviar con timestamp y firma nuevos.

## 9. Propiedad de datos

- Contactos, conversaciones, locks, supresiones, sesiones, ítems y campañas: propiedad de la organización autenticada; claves compuestas `(organizationId, phone)` en 2A.
- Un teléfono compartido entre dos organizaciones NO comparte estado (locks, sesiones de flujo, supresiones, inbox separados).
- Enumeración cross-org prohibida: recurso de otra org ⇒ **404** sin oráculo.

---
Historial: v1.0.0 (2026-10) — firma HMAC sobre body, anti-replay en memoria. v1.1.0 (2026-11-06) — esta versión.

---
## Apéndice CRM-ALBRA (Capa 0) — 2026-11-06

- **CRM → WHATSPOWER (2A)**: `POST /api/inbound` con `X-Signature-SHA256 = HMAC-SHA256(secret, timestamp + "." + rawBody)` y el MISMO `X-Timestamp` firmado (contrato v1.1.0). Implementado en `src/lib/whatspower-bridge.ts` (`signWhatspowerPayload`). El receptor (2A) verifica timestamp ±300s → HMAC timing-safe → anti-replay persistente → idempotencia `orgId::eventId`.
- **Identidad**: cada llamada CRM→2A lleva el `orgId` del usuario autenticado en el CRM dentro del payload; 2A resuelve la organización de la credencial (`INTERNAL_API_SECRET` legacy → org `default`, o `INTERNAL_API_KEYS` por org) y rechaza `X-Org-Id` de otra organización.
- **CRM → 2B**: atribución/despacho vía adaptador daemon con gate `ALLOW_REAL_DISPATCH` (2B jamás despacha real sin él).
- **Rotación de secretos**: publicar nuevo secreto junto al antiguo, cambiar emisor, retirar el antiguo. Históricos publicados: ver `CONTEXTO CRM/PENDIENTES.md` (ROTACION-PENDIENTE).
