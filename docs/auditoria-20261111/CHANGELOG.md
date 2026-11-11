# CHANGELOG — Oleada de auditoría y endurecimiento (2026-11-11)

## CRM-ALBRA — `impl/audit-20261111`
- `502dcf6` lote A (seguridad+bridge): eventId determinista A4-01, A1-06 bearer, errorResponse enmascarado, CSV injection, nicho session-state, demo gate, register rate-limit+pwd8, registro atómico, credenciales dbRateLimit, legacy secret condicionado.
- `30cc6be` lote B (integridad): claim condicional won A4-03, dedup webhook A4-02, multi-entry A1-09, unicidad cliente A4-04 (migración 4), índices A4-08, timeline A4-09, import pre-dedup A4-12, verify-token timing-safe A2-12, telegramSecret cifrado A2-07, nonce signup A1-11, retirada arqueología A2-14 (16 MB).
- `8baba22` dependencias: next 16.4.6, sharp 0.35.5, zod 4.6.7, js-yaml 5.5 (override), nodemailer 10.1.4 — 0 críticas/0 altas.
- `6ad60c0` higiene .env.example.
- `384305d` lote C: gate ATÓMICO de conexiones §2.1, pestaña Inventario retirada A3-01, /api/email/test real A3-02, fixes UI A3-04..A3-11.
- Pruebas: 569/569 · tsc limpio.

## WHATSPOWER — `impl/audit-20261111`
- `9434734` ciclo 1: ring buffer A1-02, dedup estricto A1-03, guard __legacy__ A1-04, SKIPPED_NO_PHONE A1-05, verifyHmac timing-safe A2-10, rate limit durable A2-11, journal+release+purga A4-06, 400 genéricos A4-14, env docs A5-06, Docker A5-07, handlers A5-08, devDeps A5-11.
- Pruebas: 197/197 · tsc limpio.

## WHATSPOWER-ULTRA — `impl/audit-20261111`
- `0976855` ciclo 1: clasificación UNCERTAIN A1-01 (+3 pruebas de regresión), ring buffer A1-02, parseAdminKeys A1-07, login timing-safe A2-04, paginación A4-10, createCampaign transaccional A4-11, 201 Created A4-15, TS de tests A5-02, env docs A5-06, Docker+compose A5-07, handlers A5-08.
- `621488a` `npm run test:security` (§4.11).
- Pruebas: 148/148 · tsc exit 0.
