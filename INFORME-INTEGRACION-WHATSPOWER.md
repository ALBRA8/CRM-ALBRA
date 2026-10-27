# ALBRA — INFORME DE INTEGRACIÓN
# WHATSPOWER + WHATSPOWER-ULTRA + CRM-ALBRA
Fecha: 2026-10-27 · Sandbox: datos de prueba con prefijo E2E-WHATSPOWER-CRM-2026 · Sin envíos reales

## 1. ESTADO INICIAL DE CADA REPO
| Repo | Branch | HEAD inicial | Estado |
|---|---|---|---|
| WHATSPOWER | main | d854749 | limpio |
| WHATSPOWER-ULTRA | main | b7b5a5d | limpio |
| CRM-ALBRA | main | 397418d local / db95a5b remoto | 5 commits locales previos (sandbox/worklog + schema de misión anterior) |

## 2. ARQUITECTURA ENCONTRADA
- **WHATSPOWER (Nivel 2, :3003)**: motor conversacional estilo ManyChat (flows visuales, drip, locks JIT, supresión, round-robin). Contratos declarados: Inbound Bridge (POST /api/inbound, HMAC-SHA256 `X-Signature-SHA256` + `X-Timestamp` anti-replay 300s), CRM Actions Bridge (POST {CRM}/api/crm/actions con Bearer `albra_…` + X-Correlation-Id + X-Idempotency-Key), CRM Stage Triggers (POST /api/crm/stage-change), locks internos para ULTRA (/api/internal/locks/:phone).
- **WHATSPOWER-ULTRA (Nivel 3, :3004)**: difusión masiva estilo WhatsOn/WATI (spintax determinista, anti-ban de 5 capas: throttler con jitter, cooldown por lote, horario 08:00-18:00 Bogotá, fatiga 7 días, pre-dispatch JIT; lock-check a WHATSPOWER o standalone). Ingesta realtime de leads (POST /api/audiences/webhook-lead) y despacho al daemon de WhatsApp del CRM (:3002 /send con Bearer INTERNAL_API_SECRET — el daemon persiste el saliente en WhatsAppConversation/WhatsAppMessage del CRM). Guard físico ALLOW_REAL_DISPATCH.
- **CRM-ALBRA (Nivel 1, :3000)**: CRM multi-tenant Next.js+Prisma; /api/crm/actions con catálogo de 6 acciones (create_client, create_opportunity, add_note, schedule_, +2 reads) autenticado por API key `albra_…` con RBAC de capacidades; webhook Meta por organización (HMAC X-Hub-Signature-256); daemon Baileys :3002.

## 3-6. CAMBIOS REALIZADOS (motivo + archivos)
### WHATSPOWER — commit `9141484` (branch main)
| Archivo | Cambio | Motivo |
|---|---|---|
| src/server.ts | Instanciar `HttpCrmClient` real cuando hay `CRM_API_KEY` (antes SIEMPRE `MockCrmClient` en el server de producción) | Pieza faltante: los flujos nunca sincronizaban con el CRM real. Es el dueño del cliente CRM |
| src/server.ts | Secret dual: `AGENTIC_2A_WEBHOOK_SECRET` (documentado en README) > `WEBHOOK_SECRET` (legacy) | Config rota: runtime ignoraba la variable documentada |
| src/engine/router.ts | `correlationId` opcional → fallback `eventId` | Bug real demostrado: undefined llegaba a binds SQLite → 500 en /api/inbound con el payload del propio README |
| .env.example | Documentar CRM_BASE_URL / CRM_API_KEY | Contrato de config |
| tests/webhook-secret-config.test.ts (nuevo) | Regresión de prioridad de secrets | Protección del fix |

### WHATSPOWER-ULTRA — commit `4d99204` (branch main)
| Archivo | Cambio | Motivo |
|---|---|---|
| tests/plug-and-play.test.ts | Inyectar `businessDate` fija (10:00 Bogotá) como el resto de suites | Test flaky: fallaba de noche por el guard de horario (PAUSED_OFF_HOURS). Defecto de test demostrado |

### CRM-ALBRA — commit `4c01528` (branch main)
| Archivo | Cambio | Motivo |
|---|---|---|
| src/lib/whatspower-bridge.ts (nuevo) | Bridge fire-and-forget: reenvío inbound firmado (HMAC-SHA256 hex + X-Timestamp, formato exacto que WHATSPOWER verifica) y notificación de stage-change. No-op sin `WHATSPOWER_ENABLED=true`; fail-closed sin `WHATSPOWER_WEBHOOK_SECRET` | Pieza faltante del contrato declarado por WHATSPOWER: el CRM no reenviaba nada (grep sin referencias) |
| src/app/api/whatsapp/webhook/route.ts | Reenvío del mensaje entrante tras el pipeline existente (round-robin, timeline, workflows) | Punto de integración declarado |
| src/app/api/opportunities/[id]/route.ts | Notificar cambio de etapa a /api/crm/stage-change | CRM Stage Triggers de WHATSPOWER |
| tests/integration/whatspower-bridge.test.ts (nuevo) | 9 tests: contrato HMAC, ventana anti-replay, no-op/fail-closed, contención de fallos de red/HTTP | Regresión |
| tsconfig.json | Excluir scripts ad-hoc E2E del typecheck | Build limpio |

**Trabajo previo NO eliminado (regla 16)**: `prisma/schema.prisma` (campo `agentLeadsSecretEnc` + tabla `AgentLeadEvent`, de la misión AGENTE-LEADS anterior) quedó absorbido por el auto-commit del sandbox `397418d` y viaja en la historia local pendiente de push. En AGENTE-LEADS quedan 5 archivos modificados + 2 tests SIN COMMIT de la misión anterior (working tree intacto, FUERA DE ALCANCE — no commiteado ni pusheado ni revertido).

## 7-8. TESTS EJECUTADOS Y RESULTADOS
| Suite | Resultado |
|---|---|
| WHATSPOWER `npm test` | 22/22 PASS |
| WHATSPOWER regresión secrets (nueva) | 2/2 PASS |
| WHATSPOWER-ULTRA `npm test` | 19/19 PASS (antes 18/19) |
| CRM-ALBRA `tsc --noEmit` | 0 errores |
| CRM-ALBRA `vitest run` | 386/390 (los 4 fallos son PRE-EXISTENTES — LLM del entorno responde eco del prompt; verificado con `git stash`: con código original fallan los mismos 4; NO son regresiones de esta misión) |

## 9. PRUEBAS E2E (37/37 PASS) — datos E2E-WHATSPOWER-CRM-2026
**Parte A — WHATSPOWER → CRM (6/6)**: flujo con nodo crm_action creado vía API → POST /api/inbound firmado → acción ejecutada con `crmSynced=true` → CRM creó Cliente real (`source=crm-api`) + ClientHistory (nota E2E) verificados por API y BD → idempotencia (mismo eventId → `deduplicated`) → sesión conversacional persistida en SQLite de WHATSPOWER (lock IN_FLOW_2A + inbox_messages).
**Parte B — CRM → WHATSPOWER (8/8)**: webhook Meta firmado con el App Secret de la organización → CRM valida firma (org match criptográfico) → procesa (timeline, cliente) → **bridge reenvía firmado a WHATSPOWER y el mensaje queda persistido en su BD** → creación de Oportunidad + PUT de etapa → log del CRM confirma entrega `[whatspower-bridge] stage-change entregado` → receptor /api/crm/stage-change de WHATSPOWER dispara trigger (`triggered:true, action:send_message` con la regla PROPUESTA_ENVIADA).
**Parte C — ULTRA → CRM (13/13)**: ingesta realtime de lead (persistido en realtime_leads) → teléfono inválido rechazado controlado → campaña con CSV duplicado → dedup 2→1 targets (idempotencia interna) → anti-ban del server real pausa de noche (PAUSED_OFF_HOURS, 0 envíos nocturnos) → **engine real con dispatcher HTTP real hacia stub fiel del daemon: Bearer INTERNAL_API_SECRET + {to,text} verificados, campaña COMPLETED sin dobles envíos** → guard productivo: dispatch a :3002 bloqueado (DISPATCH_BLOCKED_BY_SAFETY_GUARD) → daemon real offline → DAEMON_HTTP_401 controlado en 45 ms.
**Parte D — errores controlados (10/10)**: ver sección 10.

## 10. ERRORES CONTROLADOS
| Caso | Resultado |
|---|---|
| CRM /api/crm/actions sin auth | 401 |
| API key inválida | 401 |
| Acción desconocida | 400 + catálogo de acciones disponibles |
| Endpoint inexistente CRM | 404 |
| WHATSPOWER /api/inbound firma inválida | 401 |
| WHATSPOWER /api/inbound timestamp expirado (replay) | 401 |
| Payload incompleto | 400 |
| Webhook Meta con firma inválida | 401 (no llega a WHATSPOWER) |
| CRM CAÍDO → WHATSPOWER | fail-open controlado: responde 200, `crmSynced=false`, latencia 10 ms, y el siguiente evento funciona (proceso vivo) |
| Teléfono inválido en ingesta ULTRA | rechazo controlado (INVALID_PHONE_FORMAT) |
| Envío real sin autorización | bloqueado por guard físico |
| Evento duplicado | deduplicated (idempotencia WHATSPOWER) + dedup de targets en campaña |
Ningún proceso colgado; ninguna corrupción de datos.

## 11. INTEGRACIONES (resultado funcional, no solo HTTP 200)
- **WHATSPOWER → CRM**: FUNCIONAL — evento conversacional → flujo → `create_client` + `add_note` en el CRM con API key `albra_…` → persistencia verificada en BD y API (Cliente + ClientHistory + timeline `source=crm-api`).
- **CRM → WHATSPOWER**: FUNCIONAL — mensaje entrante firmado HMAC llega y persiste en WHATSPOWER; cambios de etapa disparan los CRM Stage Triggers.
- **ULTRA → CRM**: FUNCIONAL — contrato del daemon (/send, Bearer INTERNAL_API_SECRET) verificado con receptor fiel; la persistencia del saliente en el CRM es código real del daemon (revisado: guarda WhatsAppConversation/WhatsAppMessage con linkedOrgId); guard productivo y manejo de daemon offline controlados.
- **WHATSPOWER → ULTRA (locks)**: sin cambios; cubierta por suites plug-and-play del repo.

## 12. PROBLEMAS RESTANTES
1. **PUSH BLOQUEADO en los 3 repos** — sin credenciales en el entorno (detalle en sección 14-17).
2. CRM: 4 tests pre-existentes fallan por el LLM del entorno (eco del system prompt); ajenos a esta integración.
3. ULTRA: `POST /api/campaigns` sin `organizationId` devuelve 400 críptico ("Provided value cannot be bound to SQLite parameter 2") — controlado pero poco descriptivo; NO modificado (fuera del alcance mínimo).
4. WHATSPOWER: `tests/allowlist-and-timeout.test.ts` (fuera del `npm test` oficial) importa `../../../audit_repos/CRM-ALBRA/src/lib/agentic-2a-bridge.ts`, ruta inexistente fuera del entorno original (ese módulo no existe en el CRM actual). NO modificado (huérfano; no rompe la suite oficial).
5. WHATSPOWER: el transporte de envío del server default sigue siendo `MockTransportSender` (el envío real de WhatsApp lo hacen el daemon del CRM y ULTRA); wiring de transporte no requerido por la integración pedida — NO modificado.

## 13. FUNCIONALIDADES NO IMPLEMENTADAS (decisión técnica)
- **CRM → ULTRA directo** (notificación de leads/campañas del CRM a ULTRA): no existe contrato real declarado ni es necesario para el flujo definido (ULTRA ingesta leads por su propio webhook; la salida de WhatsApp es el daemon del CRM). No se inventó arquitectura.
- **Registro de resultados de difusión ULTRA → timeline del CRM**: la trazabilidad de envíos queda por el canal daemon → WhatsAppMessage. Extenderlo implicaría un contrato nuevo no exigido por el flujo actual.

## 14-18. GIT (por repositorio)
### WHATSPOWER
REPOSITORIO: ALBRA8/WHATSPOWER
BRANCH: main
HEAD INICIAL: d854749
CAMBIOS: src/server.ts, src/engine/router.ts, .env.example, tests/webhook-secret-config.test.ts
TESTS: 24/24 PASS
COMMIT: `9141484` fix(integration): CRM bridge production wiring + inbound robustness
PUSH: **BLOQUEADO** — `fatal: could not read Username for 'https://github.com': No such device or address` (no hay credenciales en el entorno; los PAT entregados previamente — ghp_8OTE…CMeV, ghp_Icm0…UQRO — están revocados)
SHA REMOTO: d854749 (sin cambios)

### WHATSPOWER-ULTRA
REPOSITORIO: ALBRA8/WHATSPOWER-ULTRA
BRANCH: main
HEAD INICIAL: b7b5a5d
CAMBIOS: tests/plug-and-play.test.ts
TESTS: 19/19 PASS
COMMIT: `4d99204` fix(tests): PNP-01 inject fixed businessDate — anti-ban clock dependency
PUSH: **BLOQUEADO** (mismo error de credenciales)
SHA REMOTO: b7b5a5d (sin cambios)

### CRM-ALBRA
REPOSITORIO: ALBRA8/CRM-ALBRA
BRANCH: main
HEAD INICIAL (local): 397418d · (remoto): db95a5b
CAMBIOS: src/lib/whatspower-bridge.ts, src/app/api/whatsapp/webhook/route.ts, src/app/api/opportunities/[id]/route.ts, tests/integration/whatspower-bridge.test.ts, tsconfig.json
TESTS: tsc 0 errores · vitest 386/390 (4 pre-existentes)
COMMIT: `4c01528` feat(integration): WHATSPOWER bridge — inbound forward + stage-change triggers (commit selectivo; NO incluye trabajo de la misión anterior)
PUSH: **BLOQUEADO** (mismo error de credenciales). Pendientes de subir 6 commits locales: 9b30f3e, 9437d54, 0353689, ab23795, 397418d (worklog/scripts sandbox + schema misión LEADS anterior) y 4c01528 (esta misión)
SHA REMOTO: db95a5b (sin cambios)

### QUÉ FALTA PARA HACER PUSH (exacto)
Un token GitHub con scope `repo` y permiso de escritura en ALBRA8. Configuración tras recibirlo:
```
git -C /home/z/repos/WHATSPOWER push origin main
git -C /home/z/repos/WHATSPOWER-ULTRA push origin main
git -C /home/z/my-project push origin main
# o, si el token se entrega como secreto: git remote set-url origin https://<TOKEN>@github.com/ALBRA8/<REPO>.git
```
No se hizo force push; no se sobrescribió trabajo ajeno; cada repo conserva su propia historia.

## 19. ESTADO FINAL DEL SISTEMA
**OPERATIONAL WITH PENDING REMOTE PUSH.**
- Circuito WHATSPOWER ↔ CRM bidireccional verificado E2E con autenticación (HMAC + API key), idempotencia, multi-tenancy (org determinada criptográficamente por secret) y trazabilidad (timeline CRM + inbox/locks WHATSPOWER).
- Circuito ULTRA → daemon → CRM verificado con guard anti-ban activo y fallos controlados.
- Regresión verde en las 3 suites oficiales; sin rotura de contratos existentes (crm-actions, MCP, pipeline, timeline intactos).
- Los 3 commits están creados y probados en sus repositorios; solo falta la autorización de escritura remota para completar LOCAL → COMMIT → **PUSH** → GITHUB → VERIFICACIÓN REMOTA.
EOF
mkdir -p /home/z/my-project/download && cp /home/z/my-project/INFORME-INTEGRACION-WHATSPOWER.md /home/z/my-project/download/ 2>/dev/null; ls /home/z/my-project/download/ | head -5