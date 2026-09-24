# CRM ALBRA — Contrato de API y Convenciones (fuente de verdad para rutas)

El contrato completo de endpoints está definido por el cliente `src/lib/api.ts`
(597 líneas). **Léelo antes de escribir cualquier ruta.** Las formas de respuesta
están determinadas por los componentes que consumen la API en `src/components/**`
— **busca el componente consumidor antes de implementar cada endpoint.**

## Convenciones obligatorias

### Respuestas (extraídas del código frontend real)
- Listas: `json({ <entidadPlural>: [...], pagination? })` — ej. `{ clients, pagination }`, `{ quotes }`, `{ reservations }`, `{ automations }`, `{ opportunities, stages }`, `{ transactions }`, `{ templates }`, `{ notifications }`, `{ members }` (team), `{ logs }` (activity), `{ suggestions }`
- Único: `json({ client } | { quote } | { opportunity })`
- Dashboard: `json({ stats: {...}, pipeline: [...], revenue: [...], upcomingReservations: [...], clientsToContact: [...], inactiveClients: N })` — **verificar contra `dashboard-page.tsx`**
- Errores: `json({ error: "mensaje" }, { status: 4xx|5xx })`

### Seguridad (NO negociable — corrige los bloqueadores de la auditoría)
1. **Toda ruta** de negocio exige sesión: `requireAuth(req)` (lanza 401). Config sensible (nicho PUT, settings PUT, team, integraciones): `requireAdmin(req)` (403).
2. **Aislamiento multi-tenant**: TODA query filtra por `auth.orgId` del schema. Nunca confiar en ids del body para org.
3. **Secretos**: cifrar con `encryptSecret()` de `src/lib/crypto.ts` antes de guardar; leer con `decryptSecret()`.
4. **Webhooks**: validar firma — Meta/WhatsApp `X-Hub-Signature-256` (HMAC-SHA256 del body crudo con el app secret); Telegram `X-Telegram-Bot-Api-Secret-Token` comparación estricta. Rechazar con 401 si falla.
5. **Rutas públicas permitidas SOLO**: `POST /api/auth/*`, `GET /api/nicho` (solo branding público, sin secretos), `GET /api/push/vapid` (clave pública), `POST /api/whatsapp/webhook` y `POST /api/telegram/webhook` (con validación de firma), `GET /api/health`.

### Registro obligatorio en cada mutación
- Usar `auditAndTimeline()` de `src/lib/api-helpers.ts` (crea ActivityLog + TimelineEvent en un paso).
- Eventos de negocio disparan workflows: `runWorkflowsForTrigger({ orgId, type, payload })` de `src/lib/workflow-engine.ts`:
  - `client_created` (payload: el cliente creado: id, name, phone, email, source, status...)
  - `opportunity_stage_changed` (payload: opportunityId, clientId, fromStage, toStage, title, amount)
  - `quote_status_changed` (payload: quoteId, clientId, status, number)
  - `reservation_created` (payload: reservationId, clientId, title, startsAt)
  - `message_received` (payload: channel, from, text, conversationId)
- Tipos de timeline: `note|call|meeting|whatsapp|telegram|instagram|email|quote|stage_change|system|transaction`

### IA (servidor solamente)
- `llmChat(orgId, messages, opts)` de `src/lib/ai.ts` — usa LLM configurado por org o fallback z-ai-web-dev-sdk. **Nunca** importar el SDK en código cliente.
- Config: `Settings.llmProvider|llmBaseUrl|llmModel|llmApiKeyEnc`.

### Autenticación interna
- `signToken({ userId, orgId, role, email })` / `verifyToken` en `src/lib/auth.ts`
- Hash de password: `hashPassword` / `verifyPassword` (scrypt)

### Estilo de código
- Handler pattern: `export async function GET(req: NextRequest) { return handle(async () => { ... }) }`
- Prisma: `import { db } from '@/lib/db'`
- Sin dependencias nuevas salvo acuerdo explícito (pdfkit/exceljs permitidos para reportes).
