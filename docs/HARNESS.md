# CHALECO CRM — Contrato para hosts (CRM ALBRA)

> **El CRM ya no depende de un agente propietario.**
> Este documento describe el puesto de trabajo: qué contiene el CRM, qué capacidades expone, qué contratos habla, qué permisos exige y cómo consumirlo. La inteligencia que lo opera la aporta un **host externo** — un agente general (AGENTE-GENERAL u otro compatible), un servicio automatizado o un proceso programático autorizado. Esta fase NO incluye la integración con ningún host concreto.

---

## 1. Qué es el chaleco

El chaleco CRM es todo lo que permite que otro agente ocupe el puesto de vendedor/operador sin reconstruir nada:

```
FUTURO HOST (inteligencia)
      ↓  interfaz/contrato (REST · MCP · memoria canónica)
CHALECO CRM (conocimiento + capacidades + workflows + conectores + seguridad)
      ↓
ENGINE CRM (Next.js + Prisma + SQLite + daemon WhatsApp)
```

Principio aplicado: **el conocimiento operativo pertenece al puesto (CRM/chaleco), no al trabajador (agente) que hoy lo utiliza.** El antiguo agente de chat (`/api/chat`, `/components/chat`, persona y ciclo cognitivo) fue **eliminado** del repositorio; sus capacidades de negocio fueron **extraídas** a la capa de acciones del chaleco.

## 2. Qué contiene

| Capa | Contenido | Ubicación |
|------|-----------|-----------|
| Conocimiento | Base de conocimiento por organización (catálogo, términos, FAQ, políticas), contexto de nicho (marca, rubro, personalidad, tono, horario, servicios, reglas de oro), memoria comercial (hechos, preferencias, observaciones, aprendizajes, lecciones de estilo del vendedor) | `src/lib/knowledge.ts`, `src/lib/integrations.ts (buildNichoContext)`, `src/lib/memory.ts`, modelos `Knowledge`, `AgentMemory`, `ConversationEmbedding`, `AgentCorrection`, `NichoConfig` |
| Capabilities | Acciones canónicas de negocio con validación zod y RBAC | `src/lib/capabilities/crm-actions.ts` |
| Workflows | Auto-respuesta de canales con handoff y kill-switch, motor de automatizaciones (trigger → condiciones → acciones, DELAY durable), sugerencias deterministas (follow-up, oportunidad estancada, reengagement), IA de cierre de deals | `src/app/api/whatsapp/auto-reply`, `src/lib/channel-autoresponder.ts`, `src/lib/workflow-engine.ts`, `src/lib/scheduler.ts`, `src/app/api/suggestions`, `src/lib/deal-ai.ts` |
| Conectores | WhatsApp (daemon Baileys + proxy fail-closed), Telegram, Instagram, email SMTP, Google (OAuth, Calendar, Sheets), LLM por organización (OpenAI/Groq/compatible con fallback del entorno) | `src/whatsapp-daemon/`, `src/app/api/whatsapp|telegram|instagram|email|google`, `src/lib/ai.ts` |
| Contratos | REST de acciones, servidor MCP (16 tools), memoria canónica MemoryDV, API keys | `src/app/api/crm/actions`, `src/app/api/mcp` + `src/lib/mcp/`, `src/lib/memory-contract.ts`, `src/lib/api-keys.ts` |
| Seguridad | JWT de sesión, RBAC granular server-side, aislamiento multi-tenant en toda la capa de datos, fail-closed en ownership de sesión WhatsApp, HMAC en webhooks, API keys con hash SHA-256, cifrado de credenciales por organización, auditoría (ActivityLog) y timeline como evidencia | `src/lib/auth.ts`, `src/lib/rbac.ts`, `src/middleware.ts`, `src/app/api/whatsapp/daemon-proxy` |
| Observabilidad | Timeline de clientes, ActivityLog, Doctor (`/api/doctor`), health (`/api/health`) | `src/lib/timeline.ts`, `src/app/api/doctor` |
| Recuperación | Sweeper de runs huérfanos (10 min → `failed` con error claro), claims atómicos del scheduler, backups (`scripts/sqlite-backup.cjs`, `scripts/backup-nightly.sh`) | `src/lib/scheduler.ts`, `scripts/` |

## 3. Contratos disponibles para un host

### 3.1 REST — `POST /api/crm/actions` (contrato `crm-actions/v1`)

Ejecuta una acción de negocio. Autenticación dual:

- **Usuario de la app**: `Authorization: Bearer <JWT>` → permisos por rol (RBAC).
- **Host programático**: `Authorization: Bearer albra_…` (API key de la organización) → acceso completo a las acciones de la org.

```
POST /api/crm/actions
{ "action": "create_client", "params": { "name": "Ana Martínez", "phone": "+57 300 000 0000" } }
→ 200 { "ok": true, "summary": "Cliente \"Ana Martínez\" creado", "data": {...}, "clientId": "..." }
→ 400 { "error": "Acción desconocida: …", "available": [...] }     | parámetro inválido (zod)
→ 401 { "error": "No autenticado" }                                 | sin auth
→ 403 { "error": "Sin permiso para esta acción (clients.write)" }   | RBAC (solo JWT)
```

`GET /api/crm/actions` devuelve el catálogo auto-descriptivo (`kind`, `permiso`, `params`, `description`).

**Catálogo de acciones:**

| Acción | Kind | Permiso RBAC | Efecto |
|--------|------|--------------|--------|
| `create_client` | write | `clients.write` | Crea cliente prospect, entra al round-robin de leads, dispara workflow `client_created`, registra timeline+auditoría |
| `create_opportunity` | write | `opportunities.write` | Crea oportunidad abierta en la primera etapa del pipeline |
| `schedule_reservation` | write | `reservations.write` | Agenda cita (`scheduled`), dispara workflow `reservation_created` |
| `add_note` | write | `clients.write` | Añade nota al timeline del cliente |
| `quote_summary` | read | `quotes.read` | Resume las últimas 10 cotizaciones del cliente con total |
| `list_recent_clients` | read | `clients.read` | Lista los últimos 10 clientes con ids |

Por diseño **NO existen** acciones destructivas ni sensibles en este contrato: sin borrado, sin envío masivo, sin movimientos de dinero. Las operaciones destructivas del CRM (eliminar clientes/cotizaciones, borrar sesión de WhatsApp) quedan en las rutas de la UI con sus gates RBAC de admin y NO forman parte del contrato de hosts.

### 3.2 MCP — `POST /api/mcp` (servidor MCP, transporte Streamable HTTP stateless)

JSON-RPC 2.0; `Authorization: Bearer albra_…` (API key). Versiones de protocolo soportadas: ver `SUPPORTED_PROTOCOL_VERSIONS` en `src/lib/mcp/protocol.ts`. Compatible con Claude Desktop/Code, Cursor, Windsurf y cualquier cliente MCP.

**Tools disponibles (16):** `list_clients`, `create_client`, `get_client`, `add_client_note`, `list_pipeline_stages`, `list_opportunities`, `create_opportunity`, `update_opportunity`, `schedule_reservation`, `list_quotes`, `get_quote`, `list_conversations`, `get_conversation`, `send_whatsapp`, `list_knowledge`, `get_dashboard_stats`.

Todas las tools están aisladas por organización (la API key determina la org) y registran auditoría con procedencia `integration`.

### 3.3 Memoria canónica — MemoryDV

`src/lib/memory-contract.ts` normaliza la memoria comercial existente (`AgentMemory`) al contrato MemoryDV: `agent_id · organization_id · domain · type (fact|preference|observation|learning|procedural) · content · source · evidence · provenance · confidence · truth_level · scope · status`. Endpoints: `GET /api/memory` y `GET /api/memory/vector` (recuperación vectorial por similitud). Aislamiento por `organizationId` (+ `clientId` opcional); nunca cruza organizaciones.

### 3.4 REST general del CRM

El host también puede consumir el resto de la API REST del CRM (clientes, oportunidades, pipeline, cotizaciones, productos, reservas, bandeja, reportes, exportaciones…) con JWT de usuario: ver `docs/API_CONTRACT.md` y `src/app/api/`.

## 4. Cómo consumirlo (guía rápida para el futuro host)

```bash
# 1) El admin de la organización crea una API key: Configuración → IA del CRM → Claves API
#    (la clave cruda albra_<48hex> se muestra UNA sola vez; en BD solo hay hash SHA-256)

# 2) Descubrir capacidades
curl -H "Authorization: Bearer albra_…" http://localhost:3000/api/crm/actions

# 3) Ejecutar una acción
curl -X POST -H "Authorization: Bearer albra_…" -H "Content-Type: application/json" \
  -d '{"action":"schedule_reservation","params":{"clientId":"…","title":"Demo","startsAt":"2026-10-20T10:00:00-05:00"}}' \
  http://localhost:3000/api/crm/actions

# 4) O por MCP (JSON-RPC)
curl -X POST -H "Authorization: Bearer albra_…" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_clients","arguments":{}}}' \
  http://localhost:3000/api/mcp
```

El host NO necesita conocer el código interno: el catálogo (`GET /api/crm/actions`, `tools/list` MCP) es auto-descriptivo.

## 5. Permisos, estados y errores

- **Permisos**: catálogo RBAC en `src/lib/rbac.ts` (roles `owner | admin | agent | member`; capacidades `<recurso>.<acción>` con comodín `.*`). Una API key actúa como token de la organización (equivalente a capacidades del negocio, sin identidad de usuario).
- **Estados que maneja el CRM**: clientes (`prospect/active/inactive`), oportunidades (`open/won/lost` + etapas del pipeline), cotizaciones (`draft/sent/accepted/rejected`), reservas (`scheduled/completed/cancelled`), conversaciones WhatsApp (`isAutoReply` on/off), runs de automatización (`running/waiting/failed/completed`).
- **Errores**: 401 sin auth · 403 permiso/aislamiento/ownership · 400 contrato inválido · 404 recurso de otra org o inexistente · 503 servicio interno caído. El ownership de la sesión WhatsApp es **fail-closed**: si no se puede verificar, se deniega (`DENIED…`).
- **Procedencia**: toda mutación registra `source`/`via` en timeline y auditoría (`crm-api`, `integration`/`mcp`, `agent` para automatizaciones IA de canal — etiqueta histórica que significa "enviado por la IA del CRM", no por un agente propietario).

## 6. Workflows que el chaleco ejecuta sin host

Estos workflows corren dentro del CRM de forma autónoma (no requieren host):

1. **Auto-respuesta de canales** (WhatsApp/Telegram/Instagram): mensaje entrante → kill-switch (`NichoConfig.autoReplyEnabled`) → handoff por keywords (pausa + notifica + timeline) → respuesta de negocio con KB + memoria + estilo.
2. **Motor de automatizaciones**: triggers (`client_created`, `reservation_created`, `schedule`, …) → condiciones → acciones (email, WhatsApp, delay durable, webhooks) con claims atómicos y sweeper de recovery.
3. **Sugerencias**: reglas deterministas con caché (follow-up >14 días, oportunidad estancada >21 días, reengagement).
4. **Scheduler durable**: `runDueJobs()` idempotente, invocado por `instrumentation.ts` y `POST /api/cron/run` (cron externo).

El host puede **añadir inteligencia** sobre estos workflows (decidir cuándo y qué) sin reemplazarlos.

## 7. Qué fue eliminado y por qué

| Eliminado | Razón |
|-----------|-------|
| `src/app/api/chat/route.ts` | El agente de chat propietario: persona ("AGENTE COMERCIAL de CRM ALBRA"), ciclo cognitivo tool-calling (máx. 3 iteraciones) y su system prompt. Era el trabajador, no el puesto. Sus acciones de negocio viven ahora en `src/lib/capabilities/crm-actions.ts` |
| `src/app/chat/` + `src/components/chat/` | UI del agente de chat (módulo "Chat AI" del sidebar) |
| `src/app/api/agent/` | Endpoint `agent/corrections` re-ubicado como capability del CRM: `src/app/api/suggestions/corrections` |
| `sendChatMessage` en `src/lib/api.ts` | Cliente HTTP del agente eliminado |
| Nav "Chat AI", matcher `/chat/:path*` del middleware | Entradas del agente en navegación y borde de seguridad |
| `crm_albra_mirrored/` y `crm_albra_recovered/` | Espejos de sesión perdida que contenían una **copia del agente eliminado** (clasificados REMOVE en la auditoría) |

**NO se creó ningún sustituto** (no hay "CRM Agent V2", ni mini-agentes, ni proxy-agentes). No se tocó ningún repositorio externo (AGENTE-GENERAL no fue clonado, copiado ni modificado; no existe código de integración con él).

## 8. Cómo ejecutar y probar

```bash
npm install
cp .env.example .env          # APP_SECRET, APP_ENCRYPTION_KEY, INTERNAL_API_SECRET
npx prisma db push
npm run dev                   # http://localhost:3000
node src/whatsapp-daemon/daemon.mjs   # opcional (puerto 3002)

npx vitest run        # suite completa (incluye gates de independencia)
npm run lint && npx tsc --noEmit && npm run build
```

Tests de independencia: `tests/unit/harness-independence.test.ts` (GATE-A sin referencias al agente eliminado · GATE-B sin sus directorios · GATE-C capabilities del chaleco presentes · GATE-C2 catálogo completo). Contrato de acciones: `tests/integration/crm-actions.test.ts`. Auto-respuesta de canal: `tests/integration/channel-autoresponder.test.ts`.

## 9. Cómo extenderlo

1. **Nueva acción de negocio**: añádela a `CRM_ACTIONS` en `src/lib/capabilities/crm-actions.ts` (kind + permiso RBAC + schema zod + implementación en `executeCrmAction`) y al catálogo `crmActionsCatalog()`. Queda expuesta automáticamente en `POST /api/crm/actions`.
2. **Nueva tool MCP**: añádela a `src/lib/mcp/tools.ts` y al registro `CRM_TOOLS`.
3. **Nuevo conector de canal**: replica el patrón de `src/lib/channel-autoresponder.ts` (kill-switch + handoff + KB + memoria) y registra el webhook.
4. Regla de oro: el conocimiento y las capacidades van al chaleco; la personalidad y el razonamiento van al host. Nunca al revés.

## 10. Preparación para AGENTE-GENERAL (no integrado)

Queda preparado y documentado: el host podrá descubrir capacidades (`GET /api/crm/actions`, `tools/list` MCP), autenticarse (API key de la org o JWT de usuario), ejecutar acciones con procedencia auditada, leer memoria canónica MemoryDV y operar el CRM completo respetando RBAC y aislamiento multi-tenant. La especialización/conexión del host es una fase posterior y no forma parte de este repositorio.
