# Historial

## Alta de CONTEXTO CRM
- Fecha: 2026-10-31.
- Repositorio: ALBRA8/CRM-ALBRA.
- Rama predeterminada confirmada: main.
- Cambio: documentación del estado, arquitectura, decisiones, plan, auditorías y pendientes.
- No se modificó intencionalmente código de aplicación.

## Referencias históricas previas (no revalidadas aquí)
- ea87cc279aa04ca2fd0bfac56b1b06b307087830: corrección de routing del remitente Baileys para JIDs modernos, según revisión anterior.
- 9b32591aa73fc3c07c450509e1159de1a12354ab: puente WHATSPOWER con HMAC-SHA256/anti-replay y notificaciones de cambio de etapa, según revisión anterior.

Se mencionaron previamente ramas saas-development y stable-production; confirmar su existencia/estado antes de usarlas. Esta tarea no creó ramas. Registrar nuevos hitos con fecha, rama, commit, impacto y pruebas.

## Actualización de contexto — 2026-11-05
- Se recibió informe de implementación P0.1 para aislamiento multi-organización de WhatsApp Baileys.
- Commit y ramas reportados: c2f4001 en main y fix/saas-security-and-stabilization.
- stable-production reportada intacta en ea87cc2.
- Pruebas reportadas: 17 unitarias nuevas, suite 422/422, TypeScript 0 errores y smoke 13/13 con prueba de denegación entre organizaciones.
- Documentación de implementación reportada: docs/P0.1-aislamiento-whatsapp-multiorg.md.
- Estos datos se registran como reportados, pendientes de verificación independiente del código, remoto y despliegue.

## Registro de compatibilidad Windows — 2026-11-05
- Se informó de un commit local 658740b con correcciones de aislamiento de variables .env, encoding UTF-8 y mock de os.symlink.
- Se informó de 434/434 pruebas en tres escenarios.
- El push fue reportado como bloqueado por falta de credenciales en el sandbox.
- No se ha confirmado a cuál de los tres repositorios activos pertenece el commit; no atribuirlo a CRM-ALBRA ni integrarlo hasta verificar repositorio y rama.
- El trabajo simultáneo en CRM-ALBRA, WHATSPOWER y WHATSPOWER-ULTRA debe mantenerse separado, sin copiar patches ni alterar ramas entre proyectos.

## Cierre de seguridad CP-Sec-01 — 2026-11-06
- Rama: main (base 2cbae0c; remoto verificado con ls-remote antes y después del push). stable-production intacta en ea87cc2.
- **Eliminados del árbol** los 5 artefactos E2E con credenciales (e2e-token.txt, e2e-wp-token.txt, e2e-wp-apikey.json, e2e-apikey.txt, e2e-wp-key.txt) + reglas .gitignore preventivas. Valores históricos verificados MUERTOS (tabla ApiKey vacía; JWTs no firman con secretos vivos; daemon 401 al valor antiguo). Ver AUDITORIAS.md A-005.
- **Secreto de daemon antiguo purgado** de 5 scripts (e2e-wp-guard.ts, e2e-wp-ultra.mjs, e2e-wp-ultra-engine.ts, bootstrap-e2e-postpub.sh, bateria-rotacion.sh) → fail-fast por entorno.
- **Escáner de secretos nuevo** `scripts/scan-secrets.mjs` con 11 pruebas (`npm run security:scan` / `security:scan:history`); árbol LIMPIO al cierre.
- **Eliminado** `scripts/start-whatspower-detached.mjs` (código operativo de otro repositorio con ruta absoluta). Imports absolutos `/home/z/repos/...` corregidos a rutas relativas en scripts E2E.
- **P0.1–P0.4 verificados directamente** (commits en main; suites de aislamiento en verde). Suite completa 464/464 en 51 archivos (74s); tsc 0 errores; build OK; lint con baseline preexistente de 358 errores (0 en archivos de esta sesión).
- Servicios :3000 y :3002 operativos durante toda la sesión, sin interrupciones.

## 2026-11-06 — FUSIÓN de ramas de reparación (repair/integral + fix/b1)
Ambas líneas de trabajo se conservan en el historial:

### Línea repair/integral-20261106
## Reparación General Integral — 2026-11-06 (rama repair/integral-20261106, B1→B9)

- **B1**: JWT restringido fuera de URLs — `?token=` SOLO en endpoints de descarga con opt-in (`DOWNLOAD_AUTH_OPTS`), download-tokens de 5 min (purpose='download') y `Referrer-Policy: no-referrer`. Antes el JWT de 7 días se aceptaba por query en TODAS las rutas.
- **B2**: rate limiting transversal (login 10/min IP + 5/15min email, forgot 3/15min, reset 10/15min, register 5/h, demo 5/h, MCP 60/min, crm-actions 120/min, email/send 20/h + permiso admin; notifications/all con permiso de exportación).
- **B3**: tokens de reset hasheados con sha256 (un solo uso, 1 h) + revocación al resetear (tokenVersion).
- **B4**: revocación de sesiones — `User.tokenVersion`; logout, reset de contraseña y desactivación invalidan el JWT ya emitido. Caché en proceso con prewarm (instrumentation) y refresh con debounce. Tests REV-01/REV-02.
- **B5**: restauración de backup ATÓMICA (`db.$transaction`), tope 25 MB → 413, reporte `transactional:true` + restored/skipped por entidad; jamás introduce registros en otra organización. Tests BKP-01..03.
- **B6**: errores 500 genéricos (jamás `err.message` al cliente; HttpError 5xx también).
- **B7**: escáner de secretos reforzado (DUMMY_HINTS exactos, huellas sha256-12, allowlist `scripts/security/secret-allowlist.json` y baseline histórico `secret-baseline.json` VERIFICABLES, historial COMPLETO sin tope de 400 ni solo-líneas-añadidas; CI bloqueante solo para hallazgos NUEVOS) + lint con baseline de reducción progresiva (`npm run lint:baseline`, bloquea errores nuevos) + auditoría de dependencias en CI.
- **B8**: observabilidad de seguridad transversal (`auth.login_failed`, `rbac.denied` vía security-log).
- **B9**: puente CRM→WHATSPOWER actualizado al contrato HMAC v2 (`timestamp.body` — mismo timestamp firmado y enviado) coordinado con 2A y 2B; `docs/INTEGRATION_CONTRACT.md` v1.1.0.
- **Verificación**: suite local 501/506 (los 5 fallos restantes son del trabajo CONCURRENTE de terceros en archivos sin seguimiento — chat/agent WIP; en checkout limpio `harness-independence` pasa 4/4, verificado con worktree temporal). tsc limpio en el árbol versionado. `security:scan` y `security:scan:history` exit 0 (33 dummies en allowlist explícita; 78 hallazgos históricos en baseline con estado ROTACION-PENDIENTE).
- **NOTA de concurrencia**: durante la ejecución, un agente de terceros operaba el mismo repositorio (WIP sin seguimiento de chat/agent y checkouts de rama). La reparación se preservó íntegra en `repair/integral-20261106` sin tocar su trabajo.

### Línea fix/b1-dashboard-org-isolation (absorbida)
## Bloqueos B1–B4 publicados — 2026-11-06

- CRM-ALBRA: rama `fix/b1-dashboard-org-isolation`, commit `f9e36f2f7dbe02f22809615910be1f5c8f3af7cf`; saneamiento de clientes ajenos invocado en dashboard. CI [42314688847](https://github.com/ALBRA8/CRM-ALBRA/actions/runs/42314688847): success.
- WHATSPOWER: rama `fix/b2-uncertain-b3-org-identity`, commit `618bcba95db95304ee2abf84f0458a76597393a0`; transporte ambiguo a UNCERTAIN y credencial interna vinculada a organización. CI [42314696590](https://github.com/ALBRA8/WHATSPOWER/actions/runs/42314696590): success.
- WHATSPOWER-ULTRA: rama `fix/b3-org-identity-b4-null-org`, commit `d6d0cc2dd28ad3c3dd86e7c73596a139add3264d`; identidad por organización y cuarentena/rechazo de ítems sin organización verificable. CI [42314700665](https://github.com/ALBRA8/WHATSPOWER-ULTRA/actions/runs/42314700665): success.
- Los tres heads y runs se verificaron directamente en GitHub. Los conteos de tests/build e integración 15/15 son resultados comunicados por la ejecución correctiva y quedan etiquetados como tales hasta revisión independiente de sus artefactos.
- Riesgo pendiente de confirmación: idempotencia realmente aplicada por el daemon Baileys; no se afirma exactly-once. Sin PR, merge ni despliegue; main y stable-production no se tocaron.
- Próximo hito: revisión independiente final de diffs y evidencias; después preparar tres PR para revisión humana, sin abrirlos hasta autorización expresa.


## Revisión independiente final — B2 sigue bloqueado (2026-11-06)

- CRM B1 y ULTRA B4 revisados en código y pruebas; CI success en sus SHA de código.
- WHATSPOWER B2 no queda cerrado: el daemon Baileys no consume ni persiste la clave de idempotencia que le transmite el transporte. El journal puede re-ejecutar un efecto PENDING tras expirar el lease; la reconciliación vuelve a ejecutar el pendiente. La prueba actual no simula aceptación externa seguida de pérdida de respuesta.
- B3 tiene validación por organización en el servidor 2A y credenciales por org en ULTRA, pero no se acreditó una prueba entre procesos reales en esta rama.
- `contracts-integration.test.ts` usa stubs para daemon y 2A; no es integración real de los tres servicios. No se certifica 15/15 real.
- Próximo paso: corregir B2 en daemon + journal con deduplicación durable scoped por org y comportamiento no-reenvío para PENDING/UNCERTAIN; agregar crash-window test y luego ejecutar integración real multi-proceso. No abrir PR hasta cerrar el bloqueo.

## 2026-11-13 — Selector multiempresa y auditoría de sesión superadmin (PR #3)

- Repositorio: `ALBRA8/CRM-ALBRA`.
- Rama de trabajo: `fix/migration-safety-audit`; destino previsto: `main`.
- Pull Request: [#3 — feat(super-admin): conectar selector de organizaciones](https://github.com/ALBRA8/CRM-ALBRA/pull/3). Estado registrado: abierta/en draft; no integrada.
- Autenticación (`src/lib/auth.ts`): se reforzó la validación de la sesión contra la base de datos, usuario activo, `tokenVersion`, rol vigente y organización activa. El contexto entre organizaciones queda reservado al superadmin.
- Endpoint (`src/app/api/super/switch-organization/route.ts`): se incorporó el cambio protegido de organización para superadmin y emisión de un token de sesión actualizado.
- Cliente API (`src/lib/api.ts`): se añadió `switchSuperOrganization(organizationId)`.
- Interfaz (`src/components/super/super-page.tsx`): se conectó la acción **Ingresar** en la tabla de organizaciones; sincroniza el token con el cliente API y el store, vuelve a consultar `/me`, actualiza el usuario y navega al dashboard. Se bloquea el cambio simultáneo y no se permite ingresar a organizaciones inactivas.
- Pruebas (`tests/integration/superadmin-organization-switch.test.ts`): se añadieron escenarios para cambio de organización, denegación a usuario normal y organización inexistente (404).
- La PR #3 incluye además cambios previos de esta rama: workflow CI, Docker/entrypoint, guardas de BD, documentación de migraciones e índices de auditoría, y pruebas de `db-guard`. El conjunto reportado en la PR fue de 15 archivos.
- Verificación de CI consultada para el SHA `27870abcc9b6c27e843ff17a48dde18068c0c0d6`: no se encontraron statuses ni ejecuciones de workflow asociadas en esa consulta. No equivale a una ejecución satisfactoria.
- **Estado de validación:** build y pruebas de esta versión aún no verificados de forma reproducible en esta sesión. No declarar funcionalidad al 100 %.
- **Estado de entrega:** cambios publicados en la rama y contenidos en la PR; no integrados en `main`, no desplegados en producción. No se modificó producción.
- Siguiente paso: verificar el head actual de la PR, ejecutar CI/build/pruebas, corregir fallos y revisar aislamiento positivo/negativo antes de integrar. No hacer merge ni despliegue sin validación y autorización.
