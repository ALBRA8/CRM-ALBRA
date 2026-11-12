# CHANGELOG — Reparación Integral 2026-11-06

## [fix/reparacion-integral] CRM-ALBRA

### Seguridad
- **JWT-in-URL eliminado**: descargas directas con tickets de un solo uso (60 s, SHA-256) vía `POST /api/download-ticket` + `?ticket=`; `?token=` ya no autentica.
- Puente CRM→WhatsPower en **HMAC v2** (timestamp ligado al cuerpo) y stage-change con Bearer (los Stage Triggers morían en 401 silencioso).
- Lifecycle: rate limiting (login 10/min cuenta + 30/min IP; forgot 5/h; reset 10/h), resetToken **solo como SHA-256**, revocación de sesiones (cutoff `iat`) al cambiar contraseña, desactivar o degradar.
- 4 rutas daemon→CRM con comparación timing-safe; `handle()` mapea P2002→409 / P2025→404 y devuelve 500 genérico sin fuga de SQL.

### Tests
- 464 → **475 tests** (L1–L6: tickets, revocación, hasheo de reset, HMAC v2, rate limit). Scanner de secretos limpio.

## [fix/reparacion-integral] WHATSPOWER

### Seguridad
- `/qr` y `/qr/data` tras puerta Bearer (el QR de WhatsApp permitía secuestrar la sesión); visor reescrito como shell con clave en sessionStorage (jamás en URL).
- Webhook de pagos: `eventId` único + **idempotencia durable** (`payment_webhook_events`), validación `amount/currency/reference`, **máquina de estados legal** (terminales inmutables), auditoría completa (`payment_audit`), transición **atómica** (`BEGIN IMMEDIATE` + changes), simulator bloqueado en producción salvo decisión explícita.
- HMAC **v2** (`${ts}.${body}`) + rotación `actual|previo` + anti-replay **durable** (SQLite, sobrevive reinicios y multi-réplica).
- Servidor en `127.0.0.1` por defecto.

### Funcionalidad
- Flow Studio operativo tras el endurecimiento (puerta de clave + Bearer automático en `/api/*`).

### Tests
- 86 → **104 tests** (PAY-01..07, 7 negativas de pagos, QR-01..03, replay durable).

## [fix/reparacion-integral] WHATSPOWER-ULTRA

### Seguridad
- HMAC **v2 con secretos por organización** (`WEBHOOK_LEAD_SECRETS="org:sec|prev"`, org reservada `_legacy`); firma liga `org+timestamp+body` (cierra replay con ts fresco); huellas anti-replay por organización (sin colisión cross-org).
- Inyección cross-org cerrada: webhook-lead 403 si la campaña no pertenece a la org autenticada; el secreto v1 no puede ligar leads a campañas.
- Anti-replay **durable** (SQLite) sobrevive reinicios; `REPLAY_DB_PATH` para réplicas.

### Cola de despacho
- **Claim atómico** `PENDING→DISPATCHING` (UPDATE condicional + `claimed_by/claimed_at`): un ítem, un worker; fin del doble despacho concurrente.
- `reconcileStaleClaims()` controlado → `UNCERTAIN_DISPATCH` (nunca reintento ciego); `recoverFromCrash` solo toca claims stale; updates post-claim con guard `claimed_by` (multi-réplica).
- `PAUSED*` no despacha; idempotencia unificada con el importador CSV; `ALLOW_REAL_DISPATCH` con paridad en ambos adaptadores (la salvaguarda queda intacta).

### Funcionalidad
- Campaign Studio operativo (puerta de clave + Bearer automático); 5 rutas con body limitado (413); checkers 2A con Bearer (la integración anti-ban vuelve a funcionar).

### Tests
- 60 → **76 tests** (7 negativas HMAC obligatorias, ORG-WH-01..03, REPLAY-DUR-01, CLAIM-01..05).


## 2026-11-11/12 — Auditoría integral: ciclos 1 y 2 (rama impl/audit-20261111)

### Corregido
- Seguridad: rate limiting durable en BD; fail-closed de secretos; HMAC timing-safe;
  secretos Telegram cifrados con lookup por hash; JWT jamás en URLs de export; errores
  genéricos (sin filtrar e.message); P2002→409 / P2025→404.
- Fiabilidad: idempotencia extremo a extremo con eventId determinista; dedup de webhooks
  (waMessageId/mid) incl. statuses; liberación de dedup on-throw; transacciones atómicas
  (registro, conexiones con límite de plan, cliente+timeline); WAL + busy_timeout.
- Frontend (CRM): deep-links reales, reset de formulario corregido, TabsList wrap,
  JSON.parse blindado, vista /chat muerta eliminada.
- Pruebas: suites en verde al cierre de cada ciclo; pruebas nuevas para cada corrección
  (rate limit durable, dedup, dual-formato, release-on-throw, etc.).

### Rerequisito de despliegue
- Ejecutar `npx prisma migrate deploy` (incluye migración 4_audit_indexes con respaldo
  reversible) y `node scripts/migrate-telegram-secrets.mjs` (backfill idempotente).
- NO desplegar sin autorización expresa del propietario.
