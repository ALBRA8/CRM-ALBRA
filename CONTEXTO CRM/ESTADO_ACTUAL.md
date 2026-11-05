# Estado actual

**Base revisada:** rama main; README, esquema Prisma, daemon Baileys, webhook Instagram y docs/HARNESS.md. Revisión selectiva, sin ejecutar pruebas ni inspeccionar el despliegue.

## Capacidades declaradas
CRM multi-tenant con organizaciones, usuarios, clientes, oportunidades, pipeline, reservas, cotizaciones, finanzas, reportes, equipo, automatizaciones, WhatsApp, Instagram, Telegram, Google, SMTP, contratos REST/MCP y memoria MemoryDV. Docker separa aplicación y daemon WhatsApp. Son declaraciones de documentación, no certificación de producción.

## Evidencia en código
- Organization es raíz del esquema Prisma y modelos comerciales usan organizationId.
- Integration.organizationId tiene restricción única: una configuración Integration por organización, no un registro N-a-N de cuentas por canal.
- daemon.mjs mantiene un socket, estado de conexión y linkedOrgId globales; la sesión Baileys se almacena en un directorio local. No acredita múltiples sesiones simultáneas.
- Webhook Instagram verifica HMAC, pero permite matching cuando instagramAccountId no está configurado. Se requiere resolución exacta y no ambigua.
- docs/HARNESS.md describe REST /api/crm/actions, MCP /api/mcp y MemoryDV.

## Actualización de seguridad — 2026-11-05

**Importante:** los siguientes avances provienen de informes de ejecución compartidos en la conversación. Se registran como resultados reportados; esta actualización documental no inspeccionó el código ni reprodujo las pruebas de forma independiente.

### P0.1 — WhatsApp Baileys multi-organización
**Estado reportado: implementado y probado; pendiente de verificación independiente del remoto y del código desplegado.**

- Sesiones independientes por organización mediante Map<orgId, sesión>.
- Credenciales separadas en .wa-auth/<orgId>/, con socket, QR, teléfono, reintentos y errores propios.
- Callbacks/eventos cerrados sobre orgId y validación estricta del identificador antes de acceder al disco.
- /connect, /disconnect, /send, /qr y /conversations requieren organización.
- Compatibilidad de /send sin orgId solo cuando existe exactamente una sesión conectada; con dos o más, responde 409.
- Proxy CRM deriva orgId del JWT y no confía en el body del cliente.
- Migración del layout legado reportada como no destructiva, conservando metadata .bak.
- Pruebas reportadas: 17 unitarias nuevas, suite 422/422, TypeScript 0 errores y smoke en vivo 13/13, incluyendo intento de acceso cruzado entre organizaciones con respuesta 403.
- Commit reportado: c2f4001 en main y fix/saas-security-and-stabilization.
- stable-production reportada intacta en ea87cc2.
- Documentación reportada: docs/P0.1-aislamiento-whatsapp-multiorg.md.

La revisión inicial de esta carpeta describía un socket y linkedOrgId globales. Ese hallazgo queda como antecedente histórico y debe considerarse supersedido por el cambio reportado, no como evidencia del estado actual del código.

### P0.2 — Aislamiento de ejecuciones del Doctor
**Estado histórico (2026-11-05): pendiente → SUPERADO.** Verificado directamente el 2026-11-06; ver la sección "Verificación independiente — 2026-11-06".

### P0.3 — Endpoint público /api/nicho
**Estado histórico (2026-11-05): pendiente → SUPERADO.** Verificado directamente el 2026-11-06; ver la sección "Verificación independiente — 2026-11-06".

### P0.4 — Secretos inseguros
**Estado histórico (2026-11-05): pendiente → SUPERADO.** Verificado directamente el 2026-11-06; ver la sección "Verificación independiente — 2026-11-06".

## Verificación independiente — 2026-11-06 (sesión de cierre CP-Sec-01)

**Método:** verificación directa sobre el árbol local (main @ remoto verificado con ls-remote), ejecución de la suite completa, TypeScript, build y escáner de secretos en el sandbox. Los estados cambian de "reportado" a "verificado directamente".

### P0.1 — WhatsApp Baileys multi-organización — VERIFICADO DIRECTAMENTE
- Commit c2f4001 ∈ main confirmado con `git merge-base --is-ancestor`; código de sesiones por orgId presente (`src/lib/whatsapp-session-verdict.ts`, rutas `src/app/api/whatsapp/*` con proxy ligado al JWT).
- Pruebas de aislamiento ejecutadas localmente: `tests/unit/whatsapp-session-verdict.test.ts` dentro de la suite completa 464/464 (51 archivos) en 74s.

### P0.2 — Aislamiento de ejecuciones del Doctor — VERIFICADO DIRECTAMENTE
- `tests/unit/doctor-isolation.test.ts` ejecutándose en verde: D1 escritura cross-tenant imposible, D2 lectura scoped, D3 rol member/agent → 403, D4 anónimo → 401, D5 sesión por org, D6 parámetros del cliente no alteran alcance.

### P0.3 — Contrato público/privado de /api/nicho — VERIFICADO DIRECTAMENTE
- `src/app/api/nicho/route.ts`: GET lectura pura, orgId desde identidad (el del cliente se ignora y se registra), sin creación en GET.
- `tests/unit/nicho-isolation.test.ts` en verde: N1–N10 (401 anónimo, campos públicos, 404 genérico, 400 traversal, JWT manda, 429 rate-limit, 403 member, body orgId ignorado, 404 org inactiva, no crea filas).

### P0.4 — Secretos y arranque fail-fast — VERIFICADO DIRECTAMENTE
- `src/lib/env-guard.ts` + `tests/unit/env-guard.test.ts` en verde (secrets débiles/conocidos rechazados al arranque).
- Escáner `scripts/scan-secrets.mjs` (nuevo, con pruebas 11/11 y npm run security:scan): árbol LIMPIO.
- **Purga de artefactos de credenciales (CP-Sec-01):** eliminados del árbol `scripts/e2e-token.txt`, `e2e-wp-token.txt`, `e2e-wp-apikey.json`, `e2e-apikey.txt`, `e2e-wp-key.txt` (ya redactados desde bb8ec07; valores históricos verificados como MUERTOS: tabla ApiKey de la DB viva con 0 filas y JWTs que no firman con ningún secreto actual). Reglas .gitignore anti-reintroducción.
- **Secreto de daemon antiguo purgado de 5 scripts** (`e2e-wp-guard.ts`, `e2e-wp-ultra.mjs`, `e2e-wp-ultra-engine.ts`, `bootstrap-e2e-postpub.sh`, `bateria-rotacion.sh`): ahora fail-fast desde entorno. Verificado con el daemon vivo: el valor antiguo responde 401.

### Otros cambios de esta sesión
- Eliminado `scripts/start-whatspower-detached.mjs` (código operativo de otro repositorio con ruta absoluta; el launcher de WP vive en ALBRA8/WHATSPOWER desde 7f38030).
- TypeScript `tsc --noEmit`: 0 errores. Build de producción: OK (standalone generado). Lint: baseline preexistente del repo con 358 errores/5089 avisos NO introducidos por esta sesión (archivos modificados: 0 errores); limpiar el baseline queda como pendiente.
- stable-production: intacta en ea87cc2 (local y remoto).

## Compatibilidad Windows y aislamiento de tests — RESUELTA LA ATRIBUCIÓN
El commit 658740b fue **localizado y verificado en ALBRA8/YOUTUBE-AUTOMATION** (cuarto repositorio del ecosistema, confirmado por el propietario). No pertenece a CRM-ALBRA. Ver sección YT-AUTOMATION del informe de cierre; el caso queda cerrado para este repositorio.

## Conclusión
CRM multi-tenant con P0.1–P0.4 verificados directamente en código y con la suite completa en verde (464/464, tsc 0 errores, build OK, escáner de secretos limpio). El bloqueo de seguridad restante en ESTE repositorio es la exposición histórica de artefactos E2E en el historial git (valores muertos, verificados) que requiere purga con filter-repo y force-push autorizado por el propietario, y el baseline de lint preexistente.
