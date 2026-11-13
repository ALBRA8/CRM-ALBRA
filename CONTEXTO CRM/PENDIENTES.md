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

## Reparación General Integral 2026-11-06 — pendientes del operador

1. **ROTACIÓN DE SECRETOS HISTÓRICOS (prioridad alta)**: el historial git contiene secretos reales publicados antes de la reparación (baseline verificable en `scripts/security/secret-baseline.json`, 78 huellas en commits 23c945e, d646cf9, 541d9b2, ab23795, f2e98c0, ff8b184e, 8d01287, c54f5c1: JWTs, APP_SECRET/CONFIG_SECRET, token de Slack). Acción: rotar APP_SECRET, secretos de integraciones y el token de Slack; opcionalmente purgar el historial con `git filter-repo` (requiere force-push — decisión explícita del operador; la rama `stable-production` NO debe reescribirse).
2. **Lint**: baseline heredado de 331 errores registrado en `scripts/security/eslint-baseline.json` (solo puede BAJAR; `npm run lint:baseline` bloquea errores nuevos en CI). Reducción progresiva pendiente.
3. **`npm audit --omit=dev`**: paso de CI no bloqueante; hacer triage y elevar a bloqueante tras revisar hallazgos.
4. **Trabajo concurrente de terceros**: existe WIP sin seguimiento (chat/agent) que incumple el gate de independencia del chaleco (`tests/unit/harness-independence.test.ts` falla con ese WIP presente y pasa 4/4 en checkout limpio). Coordinar con su autor: o se integra correctamente o se retira.
5. **Migración Prisma**: `User.tokenVersion` se aplica con `prisma db push` (BD actual ya la tiene). Si se adoptan migraciones formales, crear la migración correspondiente (reversible: DROP COLUMN).


## Plan de cierre y evolución — 2026-11-12

**Propósito:** continuar desde la base existente y cerrar brechas verificables. Esta sección complementa el inventario anterior; no sustituye ni elimina entradas históricas.

### Base que se conserva
- Multiusuario en CRM-ALBRA: usuarios, roles y permisos por organización. No reconstruir.
- Multiempresa/multi-tenant: organización como límite de propiedad y aislamiento en los tres repositorios. No reconstruir; mantener pruebas negativas entre organizaciones.
- Capacidades conversacionales, campañas e integraciones existentes: reutilizar y ampliar solo donde la evidencia demuestre una brecha.

### Plan priorizado
1. **Línea base común de los tres repositorios.** Registrar SHA de cada rama objetivo, PR/ramas de evolución, CI y pruebas reproducibles. Distinguir explícitamente `main`, ramas repair/fix y `stable-production`; no asumir que cambios en ramas están integrados o desplegados.
   - Aceptación: matriz por repositorio con commit, estado de CI, pruebas ejecutadas, alcance (mock/real) y estado de integración/despliegue.
2. **Contratos e integración CRM-ALBRA ↔ WHATSPOWER ↔ WHATSPOWER-ULTRA.** Verificar identidad de organización, autorización, eventos, webhooks, bajas/supresiones, reintentos e idempotencia de extremo a extremo.
   - Aceptación: pruebas reproducibles con procesos reales separados para los flujos críticos; mocks identificados como tales. Cerrar especialmente la ventana de duplicación del envío WhatsApp señalada en la revisión B2: si no puede demostrarse deduplicación externa, mantener el resultado UNCERTAIN y prohibir reenvío automático sin reconciliación.
3. **Seguridad y cierre operativo.** Unificar política de contraseñas y permisos; revisar/rotar secretos históricos según el procedimiento aprobado; resolver baseline de lint; formalizar migraciones y respaldos/restauración.
   - Aceptación: evidencias de escaneo, pruebas de autorización, rotación confirmada, migración ensayada y restauración comprobada. Las acciones que reescriban historial Git o requieran force-push necesitan autorización expresa del propietario.
4. **Multicuenta y multicanal.** Diseñar y migrar sin pérdida desde la configuración actual uno-a-uno hacia conexiones múltiples por organización y canal. Cada conexión debe tener credenciales, OAuth/sesión, webhook, estado y ciclo de revocación propios. Validar resolución inequívoca de cuenta entrante y selección explícita de cuenta saliente.
   - Aceptación: pruebas de dos o más cuentas del mismo canal en una organización, sin cruces de mensajes, credenciales ni eventos. WhatsApp multi-sesión reportado/verificado en ramas concretas no equivale por sí solo a multicuenta general para todas las plataformas.
5. **Identidades virtuales y memoria aislada.** Definir una entidad de perfil/persona/marca dentro de la organización (sin confundirla con usuario humano ni crear organizaciones artificiales por defecto). Vincular a cada perfil sus cuentas de canal, número, correo, clientes, conversaciones, preferencias y memoria.
   - Aceptación: pruebas con al menos dos perfiles que demuestren aislamiento de clientes, historial, memoria, credenciales y respuestas; permisos administrativos y trazabilidad de cambios.
6. **Preparación SaaS/producción.** Decidir base de datos de producción y estrategia de despliegue; evaluar migración desde SQLite, concurrencia, observabilidad, cuotas/onboarding, retención, exportación/eliminación, SLO, RPO/RTO y carga.
   - Aceptación: entorno de staging reproducible, migración y rollback ensayados, backup/restauración y pruebas de carga; no declarar producción lista solo por CI verde.

### Reglas de ejecución
- No reescribir módulos funcionales ni reconstruir multiusuario/multiempresa sin evidencia de defecto.
- Antes de modificar, identificar repositorio, rama, archivos y pruebas afectadas; preservar cambios ajenos y el historial.
- Cada tarea se cierra con commit/PR, evidencia de pruebas y revisión; separar implementado, probado, integrado y desplegado.
- No desplegar, activar envíos reales ni reescribir historial sin autorización expresa.
- Actualizar este documento y ROADMAP.md con fecha, SHA y evidencia al cerrar cada bloque.

### Criterio de estado
La base multiusuario y multiempresa está implementada según el contexto y las auditorías registradas. La preparación de producción, la integración real de extremo a extremo, la multicuenta general y la gestión de identidades virtuales permanecen sujetas a los criterios de aceptación anteriores. No se declara ninguna de estas últimas como terminada por el mero hecho de existir modelos, documentación, mocks o CI satisfactorio.
