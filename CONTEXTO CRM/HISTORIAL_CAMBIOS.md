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
