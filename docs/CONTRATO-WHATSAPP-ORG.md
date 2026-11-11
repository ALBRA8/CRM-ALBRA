# CONTRATO DE CONEXIONES WHATSAPP POR ORGANIZACIÓN — v2.0 (OLEADA 2)

**Fecha de vigencia:** 2026-11-11 · **Base:** decisión de negocio de Meta/WhatsApp
(10 puntos, autorizada por el propietario) · **Alcance:** CRM-ALBRA (Capa 1,
administrador), WHATSPOWER (Capa 2A, ejecutor conversacional), WHATSPOWER-ULTRA
(Capa 3, campañas masivas).

Este documento es la **fuente de verdad** del intercambio de identidad de
organización y de credenciales WhatsApp entre los tres módulos. Sustituye,
para el canal WhatsApp Cloud API, cualquier supuesto de credencial global
(META_ACCESS_TOKEN / sesión Baileys compartida queda como legado coexistente
hasta la migración de cada organización).

---

## §1. Principios (directamente derivados de la decisión)

| # | Principio | Implementación |
|---|-----------|----------------|
| 1 | Una org conecta UNO o VARIOS números según su plan | `WhatsAppConnection` (N por org) + `whatsapp-plans.ts` (pilot=1, starter=2, growth=5, enterprise=20) |
| 2 | Cada org tiene sus propios tokens y credenciales | Token por conexión, cifrado AES-256-GCM; la credencial global deja de ser vía de envío |
| 3 | Credenciales cifradas y exclusivas por organization_id | `accessTokenEnc` bajo FK `organizationId`; jamás en logs ni respuestas API |
| 4 | Atribución automática número→org | `phoneNumberId` UNIQUE global; webhook resuelve la org por la tabla de conexiones (jamás por el body) |
| 5 | CRM administra conexiones y permisos | Rutas `/api/whatsapp/connections*` con `requireAuth`/`requireAdmin` |
| 6 | WHATSPOWER ejecuta con las credenciales de cada org | `MetaCloudOrgTransport` + `OrgWaRegistry` |
| 7 | ULTRA usa la misma identidad de organización | `MetaCloudDispatcher` por-org + `OrgWaCredentialRegistry` |
| 8 | Aislamiento total entre empresas | Toda resolución verifica pertenencia org↔número; ajeno → 404/null sin filtrar |
| 9 | Desconexión/revocación aislada | `disconnectConnection` afecta SOLO esa conexión; destruye material sensible |
| 10 | Flujo oficial Meta (Embedded Signup), sin contraseñas | `/api/whatsapp/embedded-signup`: state anti-CSRF firmado + code→token server-side |

## §2. Identidad de organización (invariante compartido por los 3 módulos)

- La organización es **siempre** la misma cadena (`organizationId`) en CRM,
  WHATSPOWER y ULTRA. `__legacy__` es espacio RESERVADO — ninguna credencial lo
  opera.
- El orgId se resuelve **en el servidor** (JWT de sesión, credencial de servicio
  por org, o tabla de conexiones por phoneNumberId). **Jamás** se acepta un
  organization_id enviado por el cliente para autorizar acceso a datos.
- Comparación de secretos e identidades: SIEMPRE en tiempo constante.

## §3. Credenciales de servicio por organización (autenticación interna)

Formato único (contrato §1 v1.1.0, vigente):

```
INTERNAL_API_KEYS="orgId:secreto[:rol],orgId2:secreto2[:rol]"
```

- Rol `admin` para los ejecutores que resuelven credenciales WhatsApp
  (WHATSPOWER, ULTRA); `agent` no puede resolver tokens.
- Legado `INTERNAL_API_SECRET` resuelve a la org `default` con rol admin
  (compatibilidad operativa; nueva instancia debe usar claves por org).

## §4. Endpoints del administrador de conexiones (CRM-ALBRA)

Todos exigen sesión JWT (orgId del token, jamás del body):

| Método y ruta | Rol mínimo | Función |
|---|---|---|
| `GET /api/whatsapp/connections` | member | Lista las conexiones DE la org + estado del plan (cupo usado/máximo) |
| `POST /api/whatsapp/connections` | admin | Conecta un número con token directo de administrador (valida contra Graph `/me` + `/{phoneNumberId}`) |
| `GET /api/whatsapp/connections/[id]` | member | Detalle + últimos 20 eventos de auditoría |
| `DELETE /api/whatsapp/connections/[id]` | admin | Desconecta (`{revoked:true}` para revocación); destruye token cifrado |
| `POST /api/whatsapp/connections/[id]/verify` | member | Revalida el token contra Graph; token revocado → estado `revoked` |
| `GET /api/whatsapp/embedded-signup` | member | `appId`/`configId` + `state` anti-CSRF firmado (15 min) |
| `POST /api/whatsapp/embedded-signup` | member | Callback oficial: `{code, state, phoneNumberId, wabaId}` → canje server-side → conexión cifrada |

Errores: límite de plan → **402**; número ya conectado a otra cuenta → **409**
(sin revelar a qué org); token rechazado → **400**; conexión ajena → **404**.

## §5. Endpoint interno de resolución de credenciales (CRM → WHATSPOWER/ULTRA)

```
GET /api/internal/whatsapp/credentials
Authorization: Bearer <credencial de servicio de la org, rol admin>

sin parámetros            → { organizationId, connections: [id, phoneNumberId, phoneNumber, wabaId, displayName] }   (SIN tokens)
?phoneNumberId=<id>       → { organizationId, connectionId, phoneNumberId, wabaId, phoneNumber, accessToken }
?connectionId=<id>        → ídem, por id de conexión
```

- El orgId se resuelve **de la credencial** (jamás de un parámetro).
- Números de otras organizaciones → **404** (no se revela su existencia).
- Conexión no activa → **409**. Rate limit por org → **429**.
- El token viaja en claro SOLO por este canal autenticado y se usa en memoria
  (TTL 5 min en las capas consumidoras; jamás en disco ni logs).

## §6. Webhook de Meta (entrante) — atribución automática

`POST /api/whatsapp/webhook` (CRM):

1. **Fase 1 (nuevo):** `phoneNumberId` → `WhatsAppConnection` (UNIQUE global).
   Firma `X-Hub-Signature-256` verificada contra el secreto de la conexión
   (app propia cifrada) o el global de plataforma (`META_APP_SECRET`).
2. **Fase 2 (legado):** si no hay conexión nueva, flujo `Integration` anterior
   (coexistente hasta migración).
3. Sin match o firma inválida → **401**.
4. `GET` de suscripción: `hub.verify_token` POR CONEXIÓN
   (`webhookVerifyToken`), además del global y del legado.

## §7. Consumo en WHATSPOWER (Capa 2A)

- `TRANSPORT=meta-cloud`: envío directo con credenciales por org.
- `OrgWaRegistry` fuentes: `WA_ORG_NUMBERS` (índice standalone) +
  `WA_ORG_CREDENTIALS` (standalone), o `CRM_INTERNAL_CREDENTIAL` (vía CRM).
- Fail-closed: sin orgId, org sin conexión o sin credencial → `REJECTED`
  (clasificación B2 intacta: 2xx SENT / 4xx REJECTED / 5xx+timeout UNCERTAIN).
- `TransportSender.sendMessage(to, text, correlationId, idempotencyKey?, orgId?)`
  — el orgId del evento acompaña al envío.

## §7.1. Ejecutores de automatizaciones stage-change (v2, OLEADA 2)

`POST /api/crm/stage-change` (WHATSPOWER) — ejecución REAL e idempotente:

1. **`eventId` obligatorio por ocurrencia** (el CRM lo genera en
   `notifyWhatspowerStageChange`, p. ej. `sevt_<uuid>`): clave de
   idempotencia guardada en `stage_change_dedup` POR ORGANIZACIÓN.
   Un replay del mismo evento responde `{ triggered: false, duplicate: true }`
   y **jamás reenvía** el mensaje. Sin `eventId`, el receptor deriva una
   clave determinista `(org|opportunity|from|to)`.
2. **Reglas por organización** (`automation_rules`, UNIQUE(org, stage)):
   cada empresa define sus disparadores; los defaults internos son SOLO
   fallback para orgs sin regla propia.
3. **Despacho real por organización**: `send_message` envía con el
   transporte `meta-cloud` de ESA organización (punto 6 de la decisión);
   `start_flow` abre sesión de flujo en la org (si el primer nodo envía
   mensaje, se entrega con las credenciales de la org); `enroll_sequence`
   inscribe en la secuencia de la org.
4. **Auditoría honesta** (`automation_events`): `SENT | UNCERTAIN |
   REJECTED_NO_CONNECTION | REJECTED | RECORDED_NO_TRANSPORT |
   FLOW_STARTED | FLOW_UNAVAILABLE | SEQUENCE_ENROLLED |
   SEQUENCE_UNAVAILABLE | SKIPPED_NO_RULE`. Prohibido el éxito fingido.

## §8. Consumo en ULTRA (Capa 3)

- `TRANSPORT_ENGINE=meta_cloud` + `META_ORG_CREDENTIALS` (standalone) o
  `CRM_INTERNAL_CREDENTIALS` (vía CRM, "orgId:secreto,...").
- `MetaCloudDispatcher.dispatch(to, text, organizationId)`:
  salvaguarda `ALLOW_REAL_DISPATCH` → org obligatoria → conexión de la org →
  credencial de la org → Graph API.
- La credencial global `META_ACCESS_TOKEN` **ya no despacha** (guard de
  producción lo exige: `META_ORG_CREDENTIALS`/`CRM_INTERNAL_CREDENTIALS`).

## §9. Reglas de calidad transversales (reglas obligatorias del proyecto)

1. Nada de stubs sin ejecución real: toda ruta/lógica nueva tiene pruebas.
2. Pruebas por decisión: cifrado, límites de plan, aislamiento cruzado,
   webhook, Embedded Signup (CRM 25; WHATSPOWER 14; ULTRA 15).
3. Migración aditiva con rollback documentado (`docs/MIGRACIONES.md` CRM).
4. Ramas de implementación independientes; sin merges a main ni despliegues
   de producción sin autorización específica.
5. Compatibilidad: el legado (Baileys por org, `Integration.*`) sigue
   operativo; nada se elimina sin justificación (la única vía eliminada es la
   credencial global de Meta, por decisión expresa del propietario).
