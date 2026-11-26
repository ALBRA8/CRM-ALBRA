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

## A-007 — Auditoría de producción consolidada de los 3 repositorios (2026-11-17)

**Fecha:** 2026-11-17. **Ramas:** `repair/produccion-real` en los tres repositorios — CRM-ALBRA (base `9f2c41a` → head `d7ad0bb`), WHATSPOWER (base `d6a7ee6` → head `4b06118`) y WHATSPOWER-ULTRA (base `7dc7bbc` → head `56a0653`). **Método:** TDD (cada reparación precedida de una prueba que falla y pasa después) + verificación real (suites completas, `tsc`, escáner de secretos árbol/historial, simulación E2E de los 3 servicios con `ALLOW_REAL_DISPATCH=false`). **Reglas del encargo respetadas:** `main` intacto en los tres, sin force-push, sin reescritura de historial, cero datos reales (solo `+573000000000`, `user@example.com`, `org_test`), sin escanear QR ni tocar `.wa-auth`, y Baileys se mantiene como canal principal (NO se migró a Meta Cloud API; adaptadores existentes intactos).

### Puertas de calidad ejecutadas al cierre
| Repositorio | Suite | TypeScript | Escáner secretos | E2E cruzado |
|---|---|---|---|---|
| CRM-ALBRA | 764/764 (93 archivos, vitest) | 0 errores | árbol limpio; historial sin hallazgos NUEVOS | simulación 3 servicios 18/18 (sesión previa) |
| WHATSPOWER | 316/316 (`npm test`) | 0 errores (sin cambios de tipos) | árbol limpio | 18/18 (sesión previa) |
| WHATSPOWER-ULTRA | 269/269 (50 suites, node:test) + seguridad 2/2 | 0 errores | árbol limpio | **7/7 nueva** `tests/e2e-cross-flow.test.ts` (`SENT=0`) |

### Hallazgos y estado (consolidado; detalle por commit en AUDIT_REPORT.md de cada repo)
| ID | Repo | Severidad | Hallazgo | Estado | Evidencia |
|---|---|---|---|---|---|
| H-C1 | CRM | ALTO | daemon de WhatsApp en `0.0.0.0`, secreto con `!==` y origen con `.startsWith()` (bypass `crm.albra.co.attacker.com`) | RESUELTO `4284687` | `daemon-security.test.ts` (6; bind no-loopback contra IP real) |
| H-C2 | CRM | ALTO | OAuth social, team, knowledge, custom-fields y `/api/internal/*` sin suite de aislamiento dedicada | RESUELTO `057511b` | `tenant-route-hardening.test.ts` (22; 401/403/404, efecto cero) |
| H-C3 | CRM | MEDIO | mutaciones por id sin `organization_id` en el `WHERE` | RESUELTO `057511b` | `WHERE id AND organization_id` en 5 módulos + auditoría de 122 rutas `[id]` |
| H-C4 | CRM | INFO | matriz de paridad declaraba "Rotación multi-cuenta automática 100%" sin código | RESUELTO `5089356` | matriz sincerada a "No implementada" |
| H-W1 | WP | MEDIO | IA podía transmitir conversaciones a terceros sin gate explícito | RESUELTO `53cb61f` | `ai-disabled-by-default.test.ts` (6; CERO HTTP sin credencial) |
| H-W2 | WP | INFO | motor de automatización (`automation_rules/events`, `stage_change_dedup`) sin documentar | RESUELTO `acd532f` | `FICHA.md` §7.b |
| H-1 | ULTRA | CRÍTICO | `BroadcastEngine` se construía SIN `ConsentStore`: el chequeo JIT de consentimiento se saltaba y las bajas no revocaban | RESUELTO `4794444` | `worker-consent.test.ts` (5; fail-closed `CONSENT_STORE_REQUIRED`) |
| H-2 | ULTRA | ALTO | `/studio/login-demo` daba sesión admin en producción con `DEMO_MODE=true`; rate limiter borraba contador tras cada éxito; IP de `x-forwarded-for` crudo | RESUELTO `ab524ce` | `login-demo-hardening.test.ts` (6) |
| H-3 | ULTRA | ALTO | `WORKER_DISABLE_PACING` desactivaba el throttling anti-baneo sin restricción | RESUELTO `df13523` | `pacing-guard.test.ts` (4; proceso hijo real, exit 1) |
| H-4 | ULTRA | MEDIO | rastreo de clics sin suite dedicada de privacidad de IP | RESUELTO `4ac7996` | `tracking-ip-hash.test.ts` (6; jamás IP cruda, solo `sha256(ip+salt)`) |
| H-5 | ULTRA | MEDIO | baja `+57…` no coincidía con contacto `573…` en el guardia JIT anti-baja | RESUELTO `9cbd4d0` | `e2e-cross-flow.test.ts` (7) |
| H-6 | WP/ULTRA/CRM | INFO | aviso de canal no oficial Baileys ausente en README/UI | RESUELTO `aa81718`/`2ae7f9f`/`acd532f` | aviso en README y UI de transporte |
| H-7 | ULTRA | INFO | sin decisión documentada de runtime ni procedimiento de respaldo | RESUELTO `b261f5f` | `DOCS/DECISION_SQLITE_TYPES.md`; `backup-db.ts`/`restore-db.ts` probados con datos ficticios |

### Límites de la auditoría
- No se ejecutó `docker compose build` (sin docker en el entorno de trabajo): Dockerfile/compose revisados estáticamente; tarea del PC del dueño.
- No se conectó ninguna sesión Baileys real, no se escaneó QR, no se accedió a `.wa-auth` ni se leyó ningún `.env` real.
- Sin merge a `main`, sin despliegue y sin validación en staging: la certificación de producción requiere el ciclo del dueño (OWNER_TODO de cada repo).
- El historial git NO se purgó (regla del encargo); escáner de historial en verde para hallazgos NUEVOS con baseline verificable.

### Publicación verificada
- Push por rama de `repair/produccion-real` a `origin` en los tres repositorios con PAT nuevo provisto por el dueño, verificado a continuación con `ls-remote` (SHA head remoto = SHA head local). Sin force-push.

## A-008 — Auditoría y verificación de pruebas en host local (2026-11-18)

**Fecha:** 2026-11-18. **Auditor:** Antigravity (rol estricto de solo pruebas / auditoría, sin modificación de código de aplicación ni commits).  
**Ramas y Commits analizados:** `repair/produccion-real` en los tres repositorios:
- **CRM-ALBRA:** commit `59b6c71`
- **WHATSPOWER:** commit `bd8e335`
- **WHATSPOWER-ULTRA:** commit `b5f5a1c`

**Entorno:** Windows 11 host, Node.js `v24.14.0`, PowerShell. Bases de datos temporales independientes en `$env:TEMP\audit-albra-temp`. Variables de seguridad activas: `ALLOW_REAL_DISPATCH=false` y `CHANNEL_AUTOREPLY_ENABLED=false`. Sesión real `.wa-auth` y bases reales aisladas.

### Resumen de Puertas de Calidad Ejecutadas
| Prueba / Repositorio | Resultado | Exit Code | Cifras y Evidencia Real |
|---|---|:---:|---|
| **CRM-ALBRA** `npm ci` (estándar) | **FALLA** | `1` | Fallo nativo de `better-sqlite3@13.0.3` en Node 24 (falta Visual C++ en host). |
| **CRM-ALBRA** `npm ci --ignore-scripts` | **OK** | `0` | 1,027 paquetes instalados. |
| **CRM-ALBRA** `prisma generate & migrate` | **OK** | `0` | 17 migraciones aplicadas en BD temporal `test-prisma.db`. |
| **CRM-ALBRA** `npx vitest run` | **OK** | `0` | **781/781 pruebas aprobadas** (96 archivos, 0 fallos). |
| **CRM-ALBRA** `npx tsc --noEmit` | **FALLA** | `2` | **4 errores TS2540** en `tests/integration/ecosystem-links.test.ts` (asignación a `process.env.NODE_ENV` readonly). |
| **CRM-ALBRA** `npm run lint` | **OK** | `0` | 0 errores y 0 avisos con `eslint.config.mjs` actual. |
| **CRM-ALBRA** `npm run build` | **FALLA** | `1` | Build cancelado por TypeScript en `tests/integration/ecosystem-links.test.ts`. |
| **CRM-ALBRA** `npm run security:scan` | **FALLA** | `1` | 1 secreto detectado en `tests/integration/ecosystem-links.test.ts:27` (requiere allowlist o `scan-secrets:allow`). |
| **CRM-ALBRA** `npm run check:pii` | **OK** | `0` | Árbol limpio. Con prueba negativa forzada: detecta violación y retorna exit code 1. |
| **WHATSPOWER** `npm ci` & `npm test` | **OK** | `0` | **324/324 pruebas aprobadas** (38 suites, 0 fallos) en Node 24. |
| **WHATSPOWER** `npm run check:pii` | **OK** | `0` | Árbol limpio, 0 violaciones. |
| **WHATSPOWER** `ecosystem-login.test.ts` | **OK** | `0` | 14/14 pruebas aprobadas (SSO 403 en producción y sin demo, anti-replay). |
| **WHATSPOWER-ULTRA** `npm ci` & `npm test` | **OK** | `0` | **283/283 pruebas aprobadas** (50 suites, 0 fallos) en Node 24. |
| **WHATSPOWER-ULTRA** `npm run check:pii` | **OK** | `0` | Árbol limpio, 0 violaciones. |
| **WHATSPOWER-ULTRA** Guards producción | **OK** | `1` | Servidor y worker abortan (exit 1) con `DEMO_MODE=true` o `WORKER_DISABLE_PACING=1` en producción. |
| **WHATSPOWER-ULTRA** Consent & Bajas | **OK** | `0` | Sin consentimiento: `SKIPPED_NO_CONSENT`. Con baja: `SUPPRESSED`. Total despachos: 0. |
| **Integración** `/api/health` en 3 capas | **OK** | `200` | CRM (:3000), WP (:3003) y ULTRA (:3004) responden HTTP 200 `{ok: true}`. |
| **Operación** Backup y Restauración | **OK** | `0` | `VACUUM INTO` generó snapshot consistente de 47 tablas. `PRAGMA integrity_check` ok. |
| **Observación Web (390px)** | **OK** | — | CRM, WP Studio y ULTRA Studio renderizan correctamente en viewport móvil. Botón demo en ULTRA responde HTTP 403 con `DEMO_MODE=false`. |

### Hallazgos para Resolver por el Constructor (z.ai)
1. **TS2540 en `CRM-ALBRA/tests/integration/ecosystem-links.test.ts`**: Corregir asignación directa a `process.env.NODE_ENV` (líneas 44, 50, 150, 161) que rompe `npx tsc --noEmit` y `npm run build`.
2. **Allowlist de escáner en `CRM-ALBRA/tests/integration/ecosystem-links.test.ts:27`**: Agregar `// scan-secrets:allow` a la constante de prueba o incluir huella en `secret-allowlist.json`.
3. **Instalación nativa en Node 24**: `better-sqlite3@13.0.3` no tiene binarios precompilados en Node 24 para Windows; requiere documentar `--ignore-scripts` o actualizar dependencia.
4. **Runner E2E 3 servicios**: `scripts/e2e-3-servicios.mjs` depende de `boot-3-servicios.sh` y `/tmp/e2e3.env`, no versionados en git. Proveer script de entorno agnóstico.

### Verificación Post-Sincronización de Correcciones de z.ai (2026-11-18)
**Commits sincronizados:**
- **CRM-ALBRA:** `67f8a96` (*feat(e2e): E2E 3 servicios autocontenido y multiplataforma*)
- **WHATSPOWER:** `fe22890` (*feat(e2e): E2E 3 servicios autocontenido y BD configurable por entorno*)
- **WHATSPOWER-ULTRA:** `71871df` (*feat(e2e): E2E 3 servicios autocontenido y BD configurable por entorno*)

| Prueba Re-ejecutada | Resultado Anterior | Resultado Actual | Evidencia y Cifras |
|---|:---:|:---:|---|
| **CRM-ALBRA** `npx tsc --noEmit` | **FALLA (TS2540)** | **OK** | **Exit Code 0** (0 errores con `vi.stubEnv`). |
| **CRM-ALBRA** `npm run security:scan` | **FALLA (1 secreto)** | **OK** | **Exit Code 0** (0 secretos detectados; generado con `crypto.randomBytes`). |
| **CRM-ALBRA** `npm run build` | **FALLA (TypeScript)** | **OK** | **Exit Code 0** (124 rutas compiladas exitosamente en standalone). |
| **CRM-ALBRA** `npx vitest run ecosystem-links` | — | **OK** | **12/12 PASS** (Exit Code 0). |
| **WHATSPOWER** `npm test` | **OK (324)** | **OK (324)** | **324/324 PASS** en 38 suites (Exit Code 0). |
| **WHATSPOWER-ULTRA** `npm test` | **OK (283)** | **OK (284)** | **284/284 PASS** en 50 suites (incluye test 1.B.6 de render condicional del botón demo). |
| **Integración E2E 3 Servicios** (`npm run e2e:3`) | **NO EJECUTADO** | **OK (20/20)** | **20/20 aserciones PASS** (2026-11-26: E2 ahora envía `whatsappCloudToken` ficticio → conexión `connected`; antes 19/20 con E4a en 401), **SENT=0** absoluto, puertos efímeros y aislamiento SQLite. |

## A-009 — Auditoría técnica post-fusión de la integración maestra (2026-11-20)

**Fecha:** 2026-11-20. **Auditor:** Antigravity.  
**Rama:** `repair/produccion-real` en commit `c5e4aee` (fusión de los 44 commits de `impl/integracion-maestra-20261120`).  
**Punto de restauración previo:** `backup/repair-produccion-real-premerge` (`a72cc95`).

### Puertas de Calidad Verificadas en el Host Local
| Puerta de Calidad | Resultado | Cifras y Evidencia Real |
|---|:---:|---|
| **Prisma Generate** | **OK** | Prisma Client v6.12.0 generado con nuevas migraciones (`zzzzzz_tareas`, `zzzzzzz_quoteitem_org_backfill`). |
| **TypeScript (`npx tsc --noEmit`)** | **OK** | **0 errores de compilación** (Exit code 0). 100% tipado estricto. |
| **Volumen de Suites** | **OK** | Expandido de 96 a **128 archivos de prueba** (1,104 pruebas unitarias, de integración y de kits). |
| **Guardián PII (`npm run check:pii`)** | **OK** | 138 números ficticios de demo sectorial e integración en whitelist exacta (`FICTITIOUS_EXACT`). **0 violaciones, árbol limpio** (Exit code 0). |
| **Escáner de Secretos (`npm run security:scan`)** | **OK** | Marcador `// scan-secrets:allow` aplicado en fixture dummy de Meta en `wa-connections-panel.test.ts`. **0 secretos detectados** (Exit code 0). |

### Despliegue y Verificación de los 9 Kits Portables (2026-11-20)
Los 9 kits de integración preparados en `CRM-ALBRA/integration-kits/wp-ultra/` se trasladaron, adaptaron y verificaron en los 3 repositorios con 100% de éxito:

1. **CRM-ALBRA (Canónico)**:
   - Compatibilidad dual `node:sqlite` (`DatabaseSync`) y `better-sqlite3` en kits persistentes S4 y M4 (`0dbc31a`).
   - Suite canónica de kits (`tests/kits/`): **9 archivos, 51 passed, 0 failed**.
   - Higiene de seguridad CI (`ad09b99`): PII limpio y escáner de secretos limpio.

2. **WHATSPOWER (Capa 2A)**:
   - Kits aplicados: S3 (Org Bearer Auth), S4 (Durable Replay Cache), S7 (Org Credentials Crypto), M3 (Meta Dispatch Guard), I6 (Transport Policy), F6 (Payment Gateway Adapter).
   - 6 suites de prueba nativas Node 24 implementadas en `tests/`.
   - Commit: `66f36a3`.
   - Resultado de test suite: **41 archivos, 358 passed, 0 failed, 0 errors**.

3. **WHATSPOWER-ULTRA (Capa 2B)**:
   - Kits aplicados: S4 (Durable Replay Cache), S7 (Org Credentials Crypto), M2 (Bulk Consent Ley 1581), M3 (Meta Dispatch Guard), M4 (Durable Pacing & Leases), M6 (Destructive Guard), I6 (Transport Policy).
   - 7 suites de prueba nativas Node 24 implementadas en `tests/`.
   - Corrección de colisión de puerto en `tests/dashboard-parity.test.ts` (DP-19).
   - Commit: `eb5f89f`.
   - Resultado de test suite: **35 archivos, 324 passed, 0 failed, 0 errors**.

### Estado del Plan de 48 Tareas y Pendientes Restantes
- **Tareas construibles en CRM-ALBRA:** 100% completadas (30 construibles + D2 consolidada).
- **Kits externos en repositorios hermanos (WP / ULTRA):** 100% aplicados y verificados en verde (tareas S3, S4, S7, M2, M3, M4, M6, I6, F6 cerradas).
- **Acciones pendientes del propietario:**
  1. **S1:** Revocar PAT expuesto en historial de chat y rotar credenciales externas.
  2. **S2:** Autorizar y ejecutar ventana de purga de historial git (`git filter-repo`) según runbook `docs/actas/VENTANA-PURGA-HISTORIAL-S2.md`.
  3. **O1:** Validar despliegue con `docker compose` en máquina Windows o servidor.
  4. **E7:** Completar drill operativo formal con acta de backup/restore en staging.
  5. **A7:** PAT de lectura para CI.

---

## A-010 — Auditoría de Ejecución: Unificación Canónica de Canales y Simplificación del Esquema (2026-11-21)

**Fecha:** 2026-11-21. **Rama:** `repair/produccion-real`. **Commit:** `46f0210`.  
**Documentos rectores:** `AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION_FASE_POSTERIOR.md` e `INFORME_AUDITORIA_REDUNDANCIAS_Y_SIMPLIFICACION.md`.  
**Alcance:** 60 archivos modificados (+1,858 / -1,236 líneas).  
**Objetivo:** Consolidar las 3 generaciones de canales en la arquitectura universal canónica y eliminar las tablas legacy sin pérdida de datos ni regresiones.

### Verificación Técnica de las 4 Fases

1. **Fase 1 — Daemon Baileys Canónico (`src/whatsapp-daemon/daemon.mjs`):**
   - Escribe directamente mediante `better-sqlite3` en las tablas canónicas `ChannelConversation` y `ChannelMessage`.
   - Registra la conexión canónica `ChannelConnection` (`channel='whatsapp'`, `provider='whatsapp_baileys'`, clave `whatsapp_baileys:<orgId>`) con status `connected`.
   - Vínculos con cliente comercial (`clientId`), flags de auto-respuesta (`isAutoReply`) y transferencias (`transferredTo`) persistidos en `metadata` (JSON) de la conversación.
   - Dedup estricto por `(conversationId, externalMessageId)`.

2. **Fase 2 — Google OAuth Desacoplado:**
   - Modelo nuevo `GoogleIntegration` en Prisma Schema (1:1 con `Organization`).
   - `src/lib/google.ts` y endpoints `/api/google/*` completamente migrados a la tabla dedicada.
   - Tokens existentes migrados mediante SQL determinista.

3. **Fase 3 — Backfill y Redirección Total:**
   - Script determinista `scripts/backfill-whatsapp-history-to-channel.mjs` con IDs reproducibles `cm_<legacyId>`.
   - `src/lib/inbox.ts` (`listInbox`) lee WhatsApp al 100% de `ChannelConversation` (prefijo `cc:*`).
   - `src/lib/integrations.ts` (`getIntegration`) convertido en vista ensamblada en memoria sin persistencia en tabla legacy.
   - `src/lib/wa-connections.ts` unificado sobre `ChannelConnection` como única fuente de verdad.

4. **Fase 4 — Eliminación Limpia (`DROP TABLE`):**
   - Migración Prisma `zzzzzzzz_canonical_channel_expand`: aditiva (`webhookSecretHash`, `ChannelConversation.metadata`, `Settings.agentLeadsSecretEnc`, `GoogleIntegration`).
   - Migración Prisma `zzzzzzzzz_drop_legacy_channel_models`: ejecuta backfill SQL nativo de todos los canales y ejecuta `DROP TABLE` formal de `Integration`, `WhatsAppConnection`, `WhatsAppConnectionEvent`, `WhatsAppConversation` y `WhatsAppMessage`.
   - Esquema simplificado de 47 a **43 modelos canónicos**.

### Resultados de Puertas de Calidad
- **Prisma Client (`npm run db:generate`):** v6.12.0 generado en 1.46s.
- **TypeScript (`npx tsc --noEmit`):** **0 errores** (Exit code 0).
- **Escáner de Secretos (`npm run security:scan`):** **0 secretos detectados** (Exit code 0).
- **Guardián PII (`npm run check:pii`):** **0 violaciones, árbol limpio** (Exit code 0).
- **Pruebas Automatizadas:** 128 suites de prueba; pruebas de canales canónicos, webhooks y outbox en verde.
- **Ecosistema:** WHATSPOWER y WHATSPOWER-ULTRA conservados intactos e independientes.

### Hallazgo y corrección post-cierre (2026-11-26) — migración destructiva con blobs cifrados

**Disparador:** el propietario y Antigravity revisaron la rama `repair/produccion-real` (@ `d3f34ff`) y la migración `zzzzzzzzz_drop_legacy_channel_models` **abortaba con «malformed JSON»** cuando existía una fila `Integration` con `facebookTokenEnc` o `tiktokTokenEnc` no nulos.

**Causa raíz (confirmada):** esas columnas guardan blobs cifrados AES-256-GCM en formato `v1:iv:tag:datos` (`encryptSecret`, `src/lib/crypto.ts`), **NO JSON**. Las sentencias 3e (Facebook) y 3f (TikTok) del backfill SQL usaban `json_extract(i."facebookTokenEnc", '$.pageId')` y `json_extract(i."tiktokTokenEnc", '$.openId'|'$.displayName')`, que abortan sobre texto no-JSON.

**Hallazgo adicional del mismo tipo — pérdida silenciosa:** la sentencia 3c (Telegram) escribía `externalAccountId = NULL` contra una columna `NOT NULL`; el `INSERT OR IGNORE` tragaba la violación y **la conexión Telegram nunca se migraba** (el bot se perdía al hacer DROP). La prueba automatizada con semilla realista la destapó.

**Corrección (v2 de la migración):**
1. **Cero `json_extract` sobre columnas cifradas.** Los únicos usos de JSON que quedan son `json_object` (constructor, nunca parsea entrada): no puede abortar. No quedó ningún `json_extract` que proteger con `json_valid`; la prueba añade una aserción estática (A12) que impide reintroducirlo.
2. **Facebook:** identidad SOLO por `Integration.facebookPageId` (columna plana). Si falta `facebookPageId` o falta el token, la fila NO se migra y se deja **constancia** en `ChannelConnectionEvent` (`type='migration_backfill_skipped'`, razón `missing_facebookPageId`/`missing_facebookTokenEnc`, `connectionId` NULL, sin secretos en el detalle). El blob cifrado jamás se lee en SQL.
3. **Telegram/TikTok:** clave estable que no depende del blob (`telegram:org:<organizationId>`, `tiktok:business:<organizationId>`), blob cifrado copiado tal cual a `credentialsEnc`, `externalAccountId` = organizationId como placeholder, `metadata.pendingDecrypt` declarado. El script TS de backfill rellena la identidad real (botId / openId / displayName) **descifrando con la clave de la app, nunca en SQL**.
4. **WhatsApp/Instagram/Google/agentLeads:** sin cambios (no leían blobs con `json_extract`).

**Prueba automatizada (`tests/integration/migration-drop-legacy-channels.test.ts`, 13 aserciones):** construye una base SQLite efímera con TODAS las migraciones hasta antes de las dos finales, siembra las 3 generaciones de datos legacy REALISTAS (WhatsApp Cloud, Baileys, Google, Telegram, Instagram, Facebook ×2 —con y sin `facebookPageId`— y TikTok, todos los tokens en formato `v1:...:...:...` no-JSON, 2 organizaciones para verificar aislamiento), aplica `zzzzzzzz_canonical_channel_expand` + `zzzzzzzzz_drop_legacy_channel_models` y verifica: migración OK, 5 tablas legacy eliminadas, conteos exactos de `ChannelConnection` (8) / `ChannelConversation` (2) / `ChannelMessage` (3), texto de mensajes intacto (acentos incluidos), blobs copiados byte a byte, constancia del skip Facebook y `PRAGMA integrity_check`/`foreign_key_check` limpios. **Demostración real: antes del fix falla con «malformed JSON» (13 tests abortados); después pasa 13/13.**

**Backfill TS v2 (`scripts/backfill-channel-connections.ts`):** las lecturas legacy se hacen por SQL crudo con guarda de existencia en `sqlite_master` — el cliente Prisma ya no expone `db.integration`/`db.whatsAppConnection` tras la unificación y el script quedó roto en runtime. Nuevo pase de **enriquecimiento Telegram/TikTok** idempotente (por `metadata.enrichedAt`): descifra el blob, rellena `externalAccountId` (botId/openId) y `displayName`, registra el evento `legacy_backfill_enriched`, reporta duplicados si el backfill TS ya creó la fila con clave por identidad real (sin modificarla) y jamás imprime identificadores ni secretos. Smoke verificado sobre BD migrada sintética: dry-run `wouldEnrich=2`, apply `enriched=2` (botId `1234567890` y openId/displayName TikTok rellenados), re-ejecución idempotente, `integrity_check=ok`.

**Puertas de calidad tras la corrección (2026-11-26):** `npx tsc --noEmit` 0 errores; suite completa **129/129 archivos, 1117/1117 pruebas** (incluye la nueva A-010 de migración); `npm run security:scan` 0 secretos; `npm run check:pii` árbol limpio. Bloque canónico de `PRODUCTION_READINESS.md` actualizado a `archivos_prueba: 129` por `scripts/verify-doc-figures.mjs`.

#### Runbook — migración destructiva en producción (corto)

```bash
# 0) RESPALDO PREVIO (obligatorio, con integridad verificada)
sqlite3 db/custom.db "VACUUM INTO 'backups/crm-pre-unificacion-$(date +%Y%m%d-%H%M).db'"
sqlite3 backups/crm-pre-unificacion-*.db "PRAGMA integrity_check;"   # debe responder: ok

# 1) Estado de migraciones
npx prisma migrate status

# 2) Aplicar (expand → drop; Prisma envuelve CADA migración en una transacción:
#    un abort revierte TODA la migración, sin backfill parcial)
npx prisma migrate deploy

# 3) Post-migración: enriquecimiento de identidades (Telegram botId, TikTok openId/displayName)
DATABASE_URL=file:db/custom.db bun run scripts/backfill-channel-connections.ts           # dry-run
DATABASE_URL=file:db/custom.db BACKFILL_CHANNEL_CONNECTIONS_CONFIRM=1 \
  BACKFILL_CHANNEL_CONNECTIONS_ALLOW_PRODUCTION=1 bun run scripts/backfill-channel-connections.ts --apply

# 4) Verificación
npx prisma migrate status          # sin pendientes ni fallos
node scripts/verify-unification.mjs # 0 tablas legacy, paridad de conteos
```

**Si una migración falla:**
```bash
npx prisma migrate status                                   # la muestra en "failed"
npx prisma migrate resolve --rolled-back "zzzzzzzzz_drop_legacy_channel_models"
# Corrige la causa (esta rama ya trae la v2 corregida) y reintenta:
npx prisma migrate deploy
```
Gracias a la transacción por migración no queda backfill parcial tras un abort; no es necesario restaurar respaldo por el solo hecho de abortar.

**Verificación empírica del runbook (2026-11-26, motor real de Prisma sobre SQLite):**
1. `prisma migrate deploy` con la cadena completa (21 migraciones) sobre BD vacía → aplicadas todas; `integrity_check=ok`, `foreign_key_check` vacío, 0 tablas legacy.
2. Con la migración ORIGINAL (d3f34ff) y una fila `Integration` con `facebookTokenEnc`/`tiktokTokenEnc` en formato `v1:...`: el deploy **aborta con el error exacto** `Database error code: 1 — malformed JSON`.
3. Tras el abort: `Integration` y `WhatsAppConversation` SIGUEN existiendo con sus filas intactas, `ChannelConnection` en 0 (sin backfill parcial) y `_prisma_migrations` registra la migración con `finished_at NULL` y el error en `logs`.
4. `prisma migrate resolve --rolled-back zzzzzzzzz_drop_legacy_channel_models` → marcada como rolled back; `migrate status` vuelve a estar operativo.
5. Redeploy con la migración v2 corregida sobre la MISMA BD que antes abortaba → aplicada con éxito: TikTok migrado con clave estable `tiktok:business:<orgId>`, Facebook sin `facebookPageId` NO migrado con constancia en `ChannelConnectionEvent` (`reason=missing_facebookPageId`), `integrity_check=ok`.

**Plan de reversión:** la migración es destructiva y no tiene inversa automática. Si tras aplicarla hay que volver atrás por un incidente: detener CRM y daemon, restaurar el respaldo del paso 0 en `db/custom.db` (procedimiento estándar de `scripts/backup-restore-drill.sh`) y NO volver a ejecutar `prisma migrate deploy` hasta reployar el código compatible con ese estado de `_prisma_migrations`. Las filas Facebook sin `facebookPageId` no son recuperables tras el DROP (así lo acepta el diseño); si existieran, rescatarlas ANTES del deploy con el dry-run del backfill TS, que las reporta.

**Nota de verificación (2026-11-26):** esta corrección se validó en sandbox Linux con Node 24 y `node:sqlite` (SQLite 3.54.1). El fallo `spawn node_modules/.bin/vitest ENOENT` de `scheduler-multiprocess.test.ts` observado en el sandbox es artefacto del entorno (clon con `node_modules` parcial), no del repo: con el binario disponible el test pasa 1/1.



## A-011 — Auditoría de ejecución en Windows real: 5 hallazgos multiplataforma (2026-11-26)

**Fecha:** 2026-11-26. **Auditor:** Antigravity (PC Windows real). **Constructor:** z.ai.
**Base auditada:** rama `repair/produccion-real` @ `ea9881b` (CRM), `66f36a3` (WHATSPOWER), `eb5f89f` (WHATSPOWER-ULTRA).

### Hallazgos y correcciones

1. **E2E 3 Servicios: E2 sin `whatsappCloudToken` → conexión `disconnected` → webhook 401.**
   El PUT `/api/whatsapp/config` solo marca la `ChannelConnection` como `connected` cuando recibe un token Cloud; el paso E2 de `scripts/e2e-3-servicios.mjs` no lo enviaba, así que E4a (webhook Meta firmado) caía en 401 («Firma inválida o destinatario desconocido») y la suite quedaba 19/20. **Corrección:** E2 envía `whatsappCloudToken` FICTICIO (`E2E-FAKE-CLOUD-TOKEN-<hex>`, generado en runtime, jamás contacta a Meta) y el CRM del E2E arranca con `CHANNEL_AUTOREPLY_ENABLED=false` explícito (invariante). Resultado verificado: **20/20 PASS con SENT=0** (sección «Evidencia real»). Cifra `19/20` corregida en esta tabla (A-009/2026-11-18), en `ESTADO_ACTUAL.md` y en `PENDIENTES.md`.

2. **`scheduler-multiprocess.test.ts` no multiplataforma.** Invocaba `node_modules/.bin/vitest` con `execFile`; en Windows ese path es un shell script de bash (el wrapper `.cmd`/`.ps1` no sirve para `execFile`) → `ENOENT`. **Corrección:** se invoca el punto de entrada real del paquete con el MISMO Node del proceso padre: `execFileAsync(process.execPath, [node_modules/vitest/vitest.mjs, ...args])`.

3. **`scripts/verify-doc-figures.mjs` dependía de POSIX (`find`, `wc`, `ls`, `grep`).** En Windows `find`/`sort` colisionan con los ejecutables nativos de MS-DOS y `wc` no existe. **Corrección:** conteo 100% Node (caminante recursivo `fs.readdirSync` con `withFileTypes`), mismas reglas de conteo y cifras idénticas (`rutas_api=128, archivos_prueba=129, modelos_prisma=43, migraciones=21, componentes_ui=106`). La prueba negativa en directorios sin `src/`/`prisma/` sigue devolviendo 0.

4. **ULTRA: `contracts-integration.test.ts` con puertos FIJOS (3991/3992/3995) bajo concurrencia de Windows.** `node --test` ejecuta los archivos en paralelo; en Windows un puerto fijo puede chocar con otro proceso o caer en un rango reservado por Hyper-V (EADDRINUSE/EACCES). **Corrección:** los 3 mock servers escuchan en puerto efímero (`listen(0, '127.0.0.1')` + lectura de `server.address().port`; los checkers 2A ya usaban `timeoutMs: 800` y el dispatcher 5 s de `AbortSignal.timeout`). Suite completa ULTRA @ `eb5f89f`: **324/324 PASS en 57 suites**. `dashboard-parity` ya usaba puerto efímero (DP-19 corregido upstream en `eb5f89f`).

5. **Migración `zzzzzzzzz_drop_legacy_channel_models` no toleraba bases creadas con `db push`.** Una base sin `_prisma_migrations` y con esquema vigente (sin tablas legacy, con `Quote_opportunityId_idx` e índices de `Task` ya creados por `db push`) abortaba: backfill sobre tablas inexistentes y `CREATE INDEX` a ciegas. **Corrección (v3 de la migración):** sombras `CREATE TABLE IF NOT EXISTS` para las 4 tablas legacy que lee el backfill + sombra de `Task` (con la forma histórica de `zzzzzzz_tareas`) antes del redefine → la migración **ya no depende de que `Task` exista**; `DROP INDEX/DROP TABLE IF EXISTS` en los 10 índices y 5 tablas legacy; `CREATE INDEX IF NOT EXISTS` en `Task ×3` y `Quote`; `new_Task` con `IF NOT EXISTS` + `INSERT OR IGNORE` (reintento tras abort parcial sin duplicar filas). La prueba A-010 (13 aserciones) sigue en verde con la v3.

### Documentación y prueba del procedimiento db push → baseline

`docs/MIGRACIONES.md` ahora trae la sección «Adopción de migraciones en una base creada con `db push`»: regla de oro (siempre sobre copia y con respaldo `VACUUM INTO` + `integrity_check`), cómo decidir hasta qué migración se marca el baseline (esquema vigente vs estado intermedio con legacy), pasos exactos en PowerShell para Windows (lista `$chain` de 20 entradas, `prisma migrate resolve --applied` por migración, `prisma migrate deploy`, `migrate status`, verificación) y la vía de reversión (`resolve --rolled-back` o restaurar respaldo). Script de evidencia `scripts/verify-db-push-baseline.mjs` (npm run `test:db-push-baseline`): repite el procedimiento con el motor REAL del CLI de Prisma sobre bases efímeras en 3 escenarios — (1) db push al esquema vigente (deploy no-op, filas de `Task` preservadas, índices sin duplicar), (2) db push sin tabla `Task` (la destructiva la recrea con la forma vigente NOT NULL + CASCADE), (3) db push con datos legacy en blobs `v1:iv:tag:datos` (backfill byte a byte a las tablas canónicas). **Resultado: 20/20 comprobaciones PASS** con `integrity_check=ok` y `foreign_key_check` vacío en los 3 escenarios.

### Documentación de instalación Windows

`README.md` añade «Instalar en Windows (Build Tools de Visual Studio)»: cuándo `better-sqlite3` necesita compilarse (falta de binario precompilado para la ABI, p. ej. Node 24, o descarga fallida), instalación de **Build Tools 2022 con el workload «Desarrollo para escritorio con C++»**, requisito de Python 3 para node-gyp y `npm rebuild better-sqlite3` como reintento; y la nota de que **en Linux/macOS funciona con binario precompilado** (sin gcc/make).

### Evidencia real (sandbox Linux, Node 24.22.3; los fixes son agnósticos de SO)

- `npm run e2e:3` → **20/20 PASS**, `SENT=0` (ver salida completa en la conversación de construcción).
- `npm test` (CRM) → **129/129 archivos, 1117/1117 pruebas** (mismas cifras canónicas del bloque FIGURAS-CANONICAS).
- ULTRA `npm test` @ `eb5f89f` → **324/324 en 57 suites**; WHATSPOWER `npm test` @ `66f36a3` → **358/358 en 44 suites**.
- `npm run test:db-push-baseline` → **20/20 comprobaciones PASS** (3 escenarios, CLI real).
- `npx tsc --noEmit` 0 errores; `npm run check:pii` árbol limpio; `npm run security:scan` 0 secretos.

