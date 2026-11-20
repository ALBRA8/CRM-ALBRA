# PRODUCTION_READINESS — Ecosistema ALBRA (2026-11-06)

## Checklist de validación final (ejecutada, no declarada)

| # | Ítem | Estado | Evidencia |
|---|---|---|---|
| 1 | Instalación limpia de dependencias | ✅ CRM `npm ci`/install en CI; WP/ULTRA **cero dependencias** (Node ≥22 stdlib) | `.github/workflows/ci.yml` ×3 |
| 2 | Compilación / verificación de tipos | ✅ `tsc --noEmit` 0 errores ×3 | Ciclo 2 |
| 3 | Aplicación inicia correctamente | ✅ Guards fail-fast de producción validados por tests (ENV-01..03 WP, ENV ULTRA) | suites |
| 4 | Base de datos funcional | ✅ Prisma (CRM) + SQLite con migraciones aditivas reversibles (WP/ULTRA) | `docs/MIGRACIONES.md` |
| 5 | Migraciones verificadas | ✅ Aditivas + rollback documentado (columnas claimed_by/claimed_at/organization_id; tablas payment_*/replay_seen) | docs |
| 6 | APIs verificadas | ✅ CRM 125 rutas auditadas (todas con guard o pública justificada; cifra conciliada 2026-11-20, ver bloque canónico); WP/ULTRA con puerta Bearer + HMAC | AUD-2 + verify-doc-figures |
| 7 | Autenticación y autorización | ✅ JWT org-scoped + RBAC; QR/admin gated; rate limiting login/forgot/reset | suites de seguridad |
| 8 | Funcionalidades principales | ✅ Salvo lo documentado en AUDIT_REPORT §6 (A2 wiring, studios: Historial/addNode) | AUD-3 |
| 9 | Pruebas unitarias | ✅ CRM 955/955 en 107 archivos (2026-11-20, cifras del cierre E4/D4/I2); WP/ULTRA fuera de este repositorio | suite + verify-doc-figures |
| 10 | Pruebas de integración | ✅ Incluidas en las suites (bridge, contracts, e2e simulado) | suites |
| 11 | E2E | ⚠️ CRM: smoke histórico ok; ULTRA: pilot-safeguards/bajas requieren `.env` (fuera de CI, documentado) | AUD-5 #6 |
| 12 | Seguridad revisada | ✅ 57 hallazgos consolidados; 0 críticos abiertos; OWASP top revisado | AUDIT_REPORT |
| 13 | Dependencias revisadas | ✅ CRM: lockfile + audit pass en CI; WP/ULTRA: sin dependencias runtime | CI |
| 14 | Rendimiento | ✅ Body limits 1MB, timeouts (AbortSignal), índices SQLite/Prisma, claim atómico | código |
| 15 | Responsive | ⚠️ Studios HTML operativos con clave; revisión visual fina pendiente (no bloqueante) | AUD-3 |
| 16 | Logs y manejo de errores | ✅ Sin fuga de secretos (verificado); P2002/P2025 mapeados; 500 genérico | AUD-2/5 |
| 17 | Variables de entorno documentadas | ✅ `.env.example` ×3 sincronizados con lo leído en `src` | AUD-5 |
| 18 | Configuración de producción | ✅ Guards fail-fast; bind 127.0.0.1; Caddy TLS documentado (DEPLOY.md) | guards |
| 19 | Ausencia de secretos expuestos | ✅ Scanner CRM limpio; WP/ULTRA sin secretos hardcodeados (fail-closed) | scanner |
| 20 | Ausencia de regresiones | ✅ Ciclo 2 sin fallos nuevos | suites |
| 21 | Repositorio sincronizado | ✅ Ramas `fix/reparacion-integral` publicadas (sin force push, main intacta) | ls-remote |

## Requisitos para el corte a producción (decisiones del dueño)

1. **Rotar el PAT** publicado en el chat (inmediato).
2. Mergear `fix/reparacion-integral` → `main` por PR tras revisión (la protección de rama lo exige).
3. Completar M13–M16 (unicidad de quotes, transacción de ingreso, backup transaccional, baseline `prisma migrate`) con ventana de prueba sobre la BD viva.
4. Crear organizaciones/API keys reales (CRM Settings) para el puente pleno.
5. Purga del historial git (procedimiento en `docs/` del cierre previo) con ventana de congelación.

## Veredicto

**APTO PARA STAGING / PRE-PRODUCCIÓN HOY.** Producción plena tras completar los 5 puntos anteriores. Ningún criterio se declaró aprobado sin evidencia; lo no ejecutable desde este entorno está marcado como ⚠️ con su causa.


---

## Verificación 2026-11-20 — cifras conciliadas con el código (E4)

La «falsa confianza» documental se cierra con un bloque canónico que un script
recuenta del código en cada corrida (CI lo valida — tarea D4). Nada de lo que
sigue se escribe a mano:

<!-- FIGURAS-CANONICAS-INICIO (verificado por scripts/verify-doc-figures.mjs — no editar a mano) -->
rutas_api: 128
archivos_prueba: 128
modelos_prisma: 43
migraciones: 21
componentes_ui: 106
<!-- FIGURAS-CANONICAS-FIN -->

Estado verificado en esta fecha (repositorio CRM-ALBRA, rama de construcción):

- Suite completa en verde: **1104/1104 pruebas en 128 archivos**; `tsc --noEmit` 0 errores; eslint limpio; `next build` OK.
- Las cifras históricas de entradas anteriores (475, 569, 781… 920) son el registro de SU fecha y no se reescriben: la historia no se miente, se ancla.
- Las secciones de WP/ULTRA de este documento corresponden a sus propios repos (dependencia externa); sus suites no se cuentan aquí.
- Re-ejecutar en cada release: `node scripts/verify-doc-figures.mjs` (o `--print` para actualizar el bloque).

---

## Checklist de producción — verificación 2026-11-12

Solo se marca lo EJECUTADO y verificado en este ciclo (nada "presumido"):

- [x] Suites de prueba completas en verde (CRM 569/569, WP 203/203, ULTRA 152/152).
- [x] tsc --noEmit 0 errores en los 3 repos.
- [x] npm audit: 0 críticas / 0 altas en runtime (5 moderadas documentadas en CRM).
- [x] Secretos: sin valores hardcodeados; .env.example con valores vacíos y comentarios propios;
      escáner de secretos en CI (scripts/scan-secrets.mjs + tests/security).
- [x] Secretos en reposo cifrados (AES-256-GCM) + lookup por hash; backfill idempotente incluido.
- [x] Migraciones seguras: no destructivas; respaldo reversible en dedup; migrador con selftest.
- [x] Aislamiento multi-empresa probado NEGATIVAMENTE (multitenancy, cross-org, nicho, doctor,
      dashboard-isolation, multiorg-isolation en los 3 repos).
- [x] Rate limiting durable en endpoints públicos (CRM auth/demo/register/creds; WP inbound/payments).
- [x] Anti-replay durable + dedup de webhooks (Meta, Telegram, pagos, stage-change).
- [x] Idempotencia extremo a extremo CRM→WHATSPOWER (eventId determinista + dedup 24 h + liberación on-throw).
- [x] Backups: nightly + drill de restauración (scripts/backup-nightly.sh, backup-restore-drill.sh).
- [x] Docker/compose: usuario sin privilegios, restart unless-stopped, volúmenes persistentes, WAL+busy_timeout.
- [ ] DESPLIEGUE A PRODUCCIÓN: BLOQUEADO POR DISEÑO hasta autorización expresa del propietario.

### Matriz de seguridad multiusuario / multiempresa
| Vector | CRM | WHATSPOWER | ULTRA |
| --- | --- | --- | --- |
| Identidad por request | JWT + estado de sesión en BD (tv, isActive, org) | X-Org-Id + credencial de servicio por org | Bearer ADMIN_API_KEYS dual-formato + X-Org-Id |
| Aislamiento de datos | Scoping por organizationId en TODA consulta (probado negativamente) | org en cada fila/consulta; '__legacy__' reservado inalcanzable | campañas/credenciales por org; cuarentena null-org |
| Credenciales de canal | Cifradas AES-256-GCM, jamás en respuestas | resolución por org vía endpoint interno (ids sin tokens) | resuelve por org vía CRM (fail-closed sin mapa) |
| Webhooks | Firma HMAC por org + anti-replay durable + dedup waMessageId | HMAC por org + timestamp ±5 min + anti-replay durable | firma + anti-replay + uncertain fail-safe |
| Rate limiting | Durable por IP/org (auth, demo, registro, credenciales internas) | Durable por IP (inbound 120/min, pagos 60/min) | login timing-safe; paginación obligatoria |
| Operaciones destructivas | Rol admin exigido; timeline del cliente en transacción | rol admin en adminOnly; locks con lease | transacción única de creación; claim atómico |
| Auditoría | ActivityLog + Timeline + security-log por evento | automation_events + sentLog acotado | journal de efectos + eventos UNCERTAIN |
