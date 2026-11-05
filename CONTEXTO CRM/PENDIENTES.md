# Pendientes

## Crítico — aislamiento y seguridad

### P0.1 — WhatsApp Baileys multi-organización
- [x] Implementación y pruebas reportadas: sesiones por org, credenciales aisladas, validación de orgId, rutas con alcance por organización y proxy CRM ligado al JWT.
- [x] Verificar independientemente el diff y el commit c2f4001 en ALBRA8/CRM-ALBRA — HECHO 2026-11-06 (commit ∈ main, código presente, tests en verde).
- [x] Confirmar que main y fix/saas-security-and-stabilization apuntan al commit esperado y que stable-production sigue intacta en ea87cc2 — HECHO 2026-11-06 (ls-remote local+remoto).
- [x] Repetir pruebas de aislamiento — HECHO 2026-11-06 (suite 464/464 incluye whatsapp-session-verdict, doctor-isolation, nicho-isolation).

### P0.2 — Ejecuciones del Doctor — CERRADO 2026-11-06
- [x] orgId derivado de identidad autenticada; escritura cross-tenant imposible (D1), lectura scoped (D2), roles 403 (D3), anónimo 401 (D4), sesión por org (D5), parámetros de cliente ignorados (D6) — todos en verde.

### P0.3 — Endpoint público /api/nicho — CERRADO 2026-11-06
- [x] GET lectura pura sin creación; orgId desde JWT (body/query ignorado y registrado); anónimo solo campos públicos; 400 traversal; 404 genérico sin oráculo; 429 rate-limit; PUT member 403 — N1–N10 en verde.

### P0.4 — Secretos inseguros — CERRADO 2026-11-06
- [x] Escáner de secretos `scripts/scan-secrets.mjs` + 11 pruebas + `npm run security:scan[:history]`; árbol LIMPIO.
- [x] 5 artefactos E2E con credenciales eliminados del árbol + .gitignore preventivo; valores históricos verificados MUERTOS (DB sin API keys, JWTs no firman con secretos vivos, daemon responde 401 al valor antiguo).
- [x] Secreto de daemon antiguo purgado de 5 scripts → fail-fast por entorno.
- [ ] PENDIENTE (requiere al propietario): purga del historial git (filter-repo/BFG + force-push) para borrar los valores muertos de commits antiguos; requiere ventana de congelación y re-clone de todos los clones.

### CP-Sec-01 — Higiene de repositorio (2026-11-06)
- [x] `scripts/start-whatspower-detached.mjs` eliminado (código operativo de otro repo con ruta absoluta).
- [x] Imports con ruta absoluta `/home/z/repos/...` corregidos a rutas relativas `repos/` en scripts E2E.
- [ ] PENDIENTE: limpiar baseline de lint (358 errores preexistentes, mayormente en scripts one-off E2E) sin tocar rutas de producción.

## Alto — multicuenta
- [ ] Diseñar entidad de conexiones multi-cuenta por organización.
- [ ] Migrar Integration uno-a-uno sin perder configuración.
- [ ] Revisar si la implementación P0.1 resuelve únicamente sesiones WhatsApp por organización o también el modelo general de múltiples cuentas/canales.
- [ ] Definir OAuth/renovación/revocación Instagram.
- [ ] Adaptar WhatsApp Cloud y Telegram al modelo multi-cuenta.
- [ ] Evaluar Facebook Messenger si continúa en alcance.

## Alto — SaaS y operación
- [ ] Elegir motor de producción y ensayar migración desde SQLite.
- [ ] Definir onboarding, invitaciones y recuperación.
- [ ] Definir planes, cuotas, medición y facturación.
- [ ] Definir retención, exportación y eliminación.
- [ ] Definir observabilidad, alertas, SLO, RPO y RTO.
- [ ] Ejecutar restauraciones y pruebas de carga reproducibles.

## Medio — calidad/ecosistema
- [ ] Inventario de endpoints, modelos y permisos.
- [ ] Matriz de capacidades por canal.
- [ ] Revisar idempotencia, reintentos y dead-letter queue.
- [ ] Contratos versionados entre productos ALBRA.
- [ ] Confirmar estado de ramas de evolución.

## Trabajo de tests Windows/.env — RESUELTO 2026-11-06
- [x] 658740b localizado y verificado en ALBRA8/YOUTUBE-AUTOMATION (cuarto repositorio del ecosistema, confirmado por el propietario).
- [x] Las correcciones están en main de ese repositorio (posteriores a 658740b); no corresponden a CRM-ALBRA.
- [ ] Verificación en Windows real con el .env local: requiere la máquina del propietario (ver informe de cierre YT-AUTOMATION).

Cerrar cada pendiente con commit/PR, evidencia de pruebas y revisión de seguridad; no basta con código parcial. No desplegar sin autorización expresa.
