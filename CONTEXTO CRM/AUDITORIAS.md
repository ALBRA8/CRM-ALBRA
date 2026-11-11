# Auditorías

## A-001 — Revisión selectiva de código y documentación
**Fecha:** 2026-10-31. **Rama:** main. **Alcance:** README, prisma/schema.prisma, daemon Baileys, webhook Instagram y docs/HARNESS.md. Sin ejecución de tests/build ni inspección del despliegue.

### Hallazgos
1. README presenta CRM multi-tenant y enumera módulos y conectores.
2. Esquema define Organization y organizationId en entidades principales.
3. Integration.organizationId es único: configuración uno-a-uno por organización.
4. daemon.mjs mantiene socket/estado/organización globales y auth state local: no acredita varias sesiones simultáneas.
5. Webhook Instagram valida HMAC, pero permite entrada si instagramAccountId no está configurado; riesgo de asociación ambigua.
6. HARNESS documenta REST, MCP y MemoryDV.

### Límites
No se ejecutaron lint, TypeScript, tests, build, health checks, carga, migración, backup ni restauración. No certifica producción ni revisa todas las rutas.

## A-002 — Resultados reportados anteriormente, pendientes de reproducir
Un informe previo fechado 2026-10-21 reportó TypeScript/ESLint sin errores, Prisma válido, 376 tests en 40 archivos, build con 94 rutas, health 200, DB disponible, ejercicio backup/restauración y carga de 380 solicitudes con 0% errores. No se reprodujo en esta revisión; no tratarlo como estado actual sin repetirlo contra commit y entorno concretos.

## A-003 — Aislamiento WhatsApp Baileys por organización (resultado reportado)
**Fecha del informe:** 2026-11-05. **Repositorio declarado:** ALBRA8/CRM-ALBRA. **Ramas/commit reportados:** main y fix/saas-security-and-stabilization en c2f4001. **stable-production:** reportada intacta en ea87cc2.

### Cambios reportados
- Sesiones y credenciales independientes por orgId, bajo .wa-auth/<orgId>/.
- Validación estricta de orgId antes de operaciones de disco.
- Alcance por organización para connect, disconnect, send, qr y conversations.
- Compatibilidad sin orgId en /send limitada a exactamente una sesión conectada; 409 con 2+ sesiones.
- Proxy CRM deriva orgId del JWT y sobreescribe el valor enviado por el cliente.
- Migración del layout legado reportada como no destructiva y con metadata .bak conservada.

### Pruebas reportadas
17 unitarias nuevas; suite 422/422 en 46 archivos; tsc sin errores; smoke en vivo 13/13. En el smoke se creó una organización B y se reportó respuesta 403 al intentar enviar/desconectar desde el contexto no autorizado; después se eliminó la organización de prueba.

### Límite de esta entrada
Los resultados anteriores son declaraciones del informe recibido, no una reproducción independiente de esta auditoría. Antes de certificar el cierre, contrastar el commit c2f4001, revisar el diff y repetir pruebas relevantes. La revisión A-001 había observado una sesión global; ese hallazgo es antecedente y queda supersedido solo si el cambio reportado se confirma en la rama evaluada.

## A-004 — Correcciones de tests relacionadas con .env y Windows (repositorio por confirmar)
**Fecha del informe:** 2026-11-05. **Commit local reportado:** 658740b. **Push:** bloqueado por falta de credenciales en el sandbox, según el informe.

Cambios reportados en siete archivos: aislamiento de FLOW_MCP_ENABLED/FLOW_MCP_VIDEO_ENABLED, aislamiento de AVATAR_V2V_SPACES y variables NOTEBOOKLM_PROBE_TOOL/NOTEBOOKLM_CONTEXT_TOOL, encoding UTF-8 explícito en lecturas de texto y mock de os.symlink para no depender de privilegios del sistema operativo.

Pruebas reportadas: 434/434 con .env de producción simulado, 434/434 sin .env y prueba de encoding con locale ASCII. Se reportó que se reprodujeron seis fallos de los originales; tres de los 17 fallos originales no quedaron individualmente identificados en el informe.

**No se ha confirmado que 658740b pertenezca a ALBRA8/CRM-ALBRA.** No atribuir ni integrar ese commit aquí hasta verificar el repositorio, rama, árbol y remoto. La simulación Linux no sustituye la ejecución en Windows real con el .env local.

## A-005 — Auditoría de seguridad CP-Sec-01 (orden de cierre 2026-11-06)
**Fecha:** 2026-11-06. **Rama:** main @ 2cbae0c (remoto verificado con ls-remote antes y después). **Método:** inspección directa, comparaciones por hash contra la DB viva, ejecución de suites.

### Credenciales versionadas (5 artefactos E2E)
- `scripts/e2e-token.txt`, `e2e-wp-token.txt`, `e2e-wp-apikey.json`, `e2e-apikey.txt`, `e2e-wp-key.txt`.
- El árbol los traía ya redactados desde `bb8ec07` (2026-10-27), pero los valores REALES permanecen en el historial (commits `d646cf9`, `23c945e`, `541d9b2`, `ab23795`).
- **Verificación de vitalidad (sin exponer valores):**
  - Tabla `ApiKey` de la DB viva (`db/custom.db`): **0 filas** → las claves `albra_*` históricas no autentican contra nada.
  - JWTs históricos: NO firman con `APP_SECRET` ni `INTERNAL_API_SECRET` actuales (HMAC-SHA256 comparado en memoria) → el secreto que los firmó fue rotado.
  - Daemon vivo (:3002) con el secreto antiguo `crm_albra_internal_secret_key_fixed_length_for_daemon_2026`: **401** → muerto.
- **Veredicto: credenciales MUERTAS** (no se requiere rotación de sistemas vivos). Artefactos eliminados del árbol + reglas .gitignore. Exposición en historial documentada en PENDIENTES (purga requiere filter-repo + force-push autorizado).

### Secretos conocidos en código
- El secreto de daemon antiguo estaba hardcodeado en 5 scripts del CRM (4 E2E + batería de rotación). Corregidos a fail-fast por entorno. El valor sigue forjable desde el historial de ESTE repo y del de WHATSPOWER (commit `2e23cbc`, borrado en `a94815d`); ya no es aceptado por ningún servicio vivo.
- Escáner nuevo `scripts/scan-secrets.mjs` (JWT, PATs GitHub/AWS/Slack/Google/Stripe/OpenAI/Anthropic/Meta, PEM, `albra_*`, secretos de config) + 11 pruebas + `npm run security:scan[:history]`. Triage de los 41 hallazgos iniciales: 1 real (secreto de daemon en scripts), 40 placeholders/dummies documentales verificados uno a uno. Árbol final: LIMPIO.

### Otros
- `scripts/start-whatspower-detached.mjs` eliminado: código operativo de otro repositorio con ruta absoluta `/home/z/...` (violaba las reglas de separación). El launcher canónico vive en WHATSPOWER.
- Lint del repo: 358 errores / 5089 avisos PREEXISTENTES (baseline; 0 errores en los archivos de esta sesión).
- Suite completa: 464/464 (51 archivos, 74s). tsc: 0 errores. Build: OK. Servicios :3000/:3002 sin interrupción.

## Próxima auditoría
1. Revisar todas las API routes, server actions, consultas Prisma, relaciones, cron/workers, exportaciones, webhooks, sesiones, credenciales, REST/MCP y API keys (parcialmente cubierto por A-005; ampliar a rutas de negocio).
2. ~~Resolver y probar P0.2, P0.3 y P0.4~~ — HECHO y verificado 2026-11-06 (ver ESTADO_ACTUAL).
3. ~~Verificar de forma independiente P0.1~~ — HECHO 2026-11-06 (commits en main, tests en verde).
4. ~~Confirmar el repositorio de origen/destino de 658740b~~ — RESUELTO: ALBRA8/YOUTUBE-AUTOMATION.
5. No certificar producción sin lint, TypeScript, tests, build, health checks, revisión de seguridad y pruebas de aislamiento reproducibles.

## A-006 — Auditoría de la Reparación General Integral (2026-11-06)

| Hallazgo original | Severidad | Estado |
|---|---|---|
| JWT aceptado por `?token=` en TODAS las rutas | P1 | RESUELTO (B1: solo descargas con opt-in + tokens de descarga 5 min) |
| Sin rate limiting en auth/MCP/crm-actions | P1 | RESUELTO (B2) |
| Tokens de reset en claro | P2 | RESUELTO (B3: sha256 + un solo uso) |
| Logout sin revocación (JWT 7 días) | P2 | RESUELTO (B4: tokenVersion) |
| Backup sin transacción ni tope | P2 | RESUELTO (B5) |
| `err.message` filtrado en 500 | P2 | RESUELTO (B6) |
| Secretos reales en historial (23 hallazgos/10 commits) | P1 | MITIGADO (B7: baseline verificable + CI bloqueante para NUEVOS; rotación y purga = operador) |
| Scanner con exclusiones por prefijo demasiado anchas | P2 | RESUELTO (B7: literales exactos + allowlist explícita) |
| CI lint continue-on-error sin control | P2 | RESUELTO (B7: lint:baseline bloqueante para errores nuevos) |
| security-log solo en /api/nicho | P2 | RESUELTO (B8: login_failed + rbac.denied) |
| Puente CRM→2A con firma v1 (incompatible con endurecimiento 2A) | P1 | RESUELTO (B9: HMAC v2 coordinado) |
