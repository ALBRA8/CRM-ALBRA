# Twenty CRM — Insights para CRM ALBRA

> Investigación de referencia sobre `twentyhq/twenty` (monorepo Nx) enfocada en
> `packages/twenty-server` (NestJS + TypeORM + PostgreSQL + BullMQ) y
> `packages/twenty-front` (React).
> Objetivo: extraer patrones CONCRETOS e importables para las 4 funcionalidades
> del plan de CRM ALBRA (Next.js 16 + Prisma + SQLite + API routes).
> Task ID: 1-b · Agent: Explore · Solo lectura del repo de referencia.

---

## 1. Workflows (motor de automatización)

### (a) Cómo lo hace Twenty

Estructura en `packages/twenty-server/src/modules/workflow/`:

| Carpeta | Responsabilidad |
|---|---|
| `common/standard-objects/` | Definición de las entidades: `workflow.workspace-entity.ts`, `workflow-version.workspace-entity.ts`, `workflow-run.workspace-entity.ts`, `workflow-automated-trigger.workspace-entity.ts` |
| `workflow-trigger/` | Detección de disparadores: listener de eventos de DB (`automated-trigger/listeners/workflow-database-event-trigger.listener.ts`), cron (`automated-trigger/crons/`), webhook, manual; encola el job `WorkflowTriggerJob` |
| `workflow-runner/` | `jobs/run-workflow.job.ts` (job BullMQ), `workflow-run-queue/` (cola, throttling, detección de runs estancados con crons de limpieza) |
| `workflow-executor/` | Corazón de la ejecución: `workspace-services/workflow-executor.workspace-service.ts` recorre el grafo de steps; `factories/workflow-action.factory.ts` resuelve `WorkflowActionType -> clase ejecutora`; cada acción en `workflow-actions/<tipo>/` |
| `workflow-builder/` | CRUD/validación de versiones (steps + edges), schemas de input/output por step (`workflow-schema/`), validación estructural (`workflow-validation/`) |

**Modelo de datos clave (3 niveles):**

1. **Workflow** — contenedor con `statuses: WorkflowStatus[]` (`DRAFT | ACTIVE | DEACTIVATED`) y `lastPublishedVersionId`.
2. **WorkflowVersion** — snapshot inmutable con dos columnas JSON: `trigger: WorkflowTrigger | null` y `steps: WorkflowAction[]`. Cada step tiene `id`, `name`, `type`, `settings`, `nextStepIds?: string[]` y `position {x,y}`. El **grafo es una lista adyacente por `nextStepIds`**, no una tabla de edges separada (las edges como entidad aparte existen solo para el builder visual). Estados de versión: `DRAFT | ACTIVE | DEACTIVATED | ARCHIVED`.
3. **WorkflowRun** — una ejecución con `status: NOT_STARTED | ENQUEUED | RUNNING | COMPLETED | FAILED | STOPPING | STOPPED`, `state` (copia del flow + `stepInfos` con estado por step: `NOT_STARTED | RUNNING | SUCCESS | FAILED | SKIPPED | STOPPED | AWAITING_RETRY`) y `stepLogs` (log estructurado por step, persistido aparte en `workflow-run-step-log.workspace-service.ts`).

**Ejecución (run-workflow.job.ts + workflow-executor.workspace-service.ts):**
- El listener de eventos de DB decora **todos** los objetos (`@OnDatabaseBatchEvent('*', CREATED|UPDATED|DELETED|DESTROYED|UPSERTED)`), consulta un **mapa cacheado de triggers activos** (`workflowAutomatedTriggerMaps` via `WorkspaceCacheService`) filtrando por `eventName`, evalúa **campos vigilados** (`settings.fields` para UPDATED: solo dispara si un campo watched cambió) y **filtros del trigger** (`evaluateStepFilters` con contexto `{ [TRIGGER_STEP_ID]: eventPayload }`), y recién entonces encola `{ workspaceId, workflowId, payload }` con `retryLimit: 3`.
- El executor NO es un for lineal: recorre el grafo por `stepIds`, ejecuta cada step vía factory, y usa utilidades de decisión puras (`should-execute-step`, `should-skip-step-execution`, `should-fail-safely`, `step-has-retry-attempts-left`, `get-step-retry-delay-ms`) para ramificar (IF_ELSE), iterar (ITERATOR), filtrar (FILTER) y reintentar. `MAX_EXECUTED_STEPS_COUNT = 20` por batch como cota de seguridad.
- **Reintentos**: cada step tiene retry config; el estado `AWAITING_RETRY` + delay por step (`StepRetryDelaysMs` en `twenty-shared/src/workflow/constants/StepRetryDelaysMs.ts`) y re-encolado del job con `stepIdsToRetry`.
- **DELAY**: el step Delay termina la ejecución actual y encola un job `resume-delayed-workflow` en una cola de delayed jobs con `lastExecutedStepId`; al despertar, el runner **resume** desde ese step (`resumeWorkflowExecution`). Dos modos: `DURATION` (d/h/min/s) y `SCHEDULED_DATE`.

### (b) Catálogo de tipos

**Trigger types** (`workflow-trigger/types/workflow-trigger.type.ts`):

| Type | Settings |
|---|---|
| `DATABASE_EVENT` | `eventName` (p.ej. `person.created`, `opportunity.updated`), `filter { stepFilters, stepFilterGroups }`, y para UPDATED/UPSERTED `fields: string[]` (campos vigilados) |
| `MANUAL` | `objectType?`, `icon?`, `isPinned?`, `availability` (global / single record / bulk records) — permite "Ejecutar workflow" desde un registro |
| `CRON` | unión tipada: `DAYS {day,hour,minute}` \| `HOURS {hour,minute}` \| `MINUTES {minute}` \| `CUSTOM {pattern}` (cron crudo) |
| `WEBHOOK` | `GET {authentication: API_KEY\|null}` \| `POST {authentication, expectedBody, expectedOutputSchema?}` |

**Action types** (`twenty-shared/src/workflow/types/WorkflowActionType.ts`) — 20 tipos:
`CODE`, `LOGIC_FUNCTION`, `SEND_EMAIL`, `DRAFT_EMAIL`, `CREATE_CALENDAR_EVENT`, `CREATE_RECORD`, `UPDATE_RECORD`, `DELETE_RECORD`, `UPSERT_RECORD`, `FIND_RECORDS`, `PICK_RECORD`, `FORM`, `FILTER`, `IF_ELSE`, `HTTP_REQUEST`, `AI_AGENT`, `CLASSIFY`, `ITERATOR`, `EMPTY`, `DELAY`.

- **Control de flujo**: `IF_ELSE` (ramas con filtros por branch, `find-matching-branch.util`), `FILTER` (mata el run si no pasa), `ITERATOR` (loop sobre arrays, con `continueOnFailure`), `DELAY`.
- **Datos**: `CREATE/UPDATE/DELETE/UPSERT/FIND_RECORDS`, `PICK_RECORD` (elige 1 registro con load-balance opcional).
- **Salida**: `SEND_EMAIL`/`DRAFT_EMAIL`, `HTTP_REQUEST`, `CODE` (JS sandbox), `FORM` (espera input humano), `CREATE_CALENDAR_EVENT`.
- **IA**: `AI_AGENT` (delega a un Agent con prompt + tool-calling) y `CLASSIFY` (preguntas de evaluación → clasifica resultado).
- **Interpolación de variables**: `resolveInput(settings.input, context)` resuelve `{{stepId.field}}` contra el output de steps previos; el trigger es accesible con la clave especial `TRIGGER_STEP_ID` (`twenty-shared/src/workflow/constants/TriggerStepId.ts`).

**Condiciones/filtros de step** (`twenty-shared/src/types/StepFilters.ts`):
- `StepFilter { id, type, stepOutputKey, operand, value, stepFilterGroupId, positionInStepFilterGroup, compositeFieldSubFieldName? }`
- `StepFilterGroup { id, logicalOperator: AND|OR, parentStepFilterGroupId?, positionInStepFilterGroup? }` → **grupos anidables** (evaluación recursiva en `evaluate-filter-conditions.util.ts`).
- Tipos de campo evaluados: NUMBER, DATE/DATE_TIME, TEXT, SELECT, MULTI_SELECT, BOOLEAN, UUID, RATING, RELATION, CURRENCY, ACTOR, ARRAY, RAW_JSON, ADDRESS/LINKS/PHONES/EMAILS/FULL_NAME (compuestos con `compositeFieldSubFieldName`).

### (c) Ideas adoptables por CRM ALBRA

1. **Copiar el modelo run/stepInfos/stepLogs.** Nuestro `AutomationRun` ya guarda `input/output/error`, pero Twenty demuestra el valor de `stepInfos` (estado por acción) y `stepLogs` (log por acción). Con Prisma/SQLite basta un campo `stepStates String?` (JSON: `{ [actionIndex]: { status, error, startedAt } }`) y `stepLogs String?` en `AutomationRun` — sin migración de tablas nuevas. Esto habilita la UI "¿por qué falló mi automatización?" (ya parcialmente cubierto: tenemos `status/failed/error`).
2. **Watched fields en el trigger `opportunity_stage_changed`.** El patrón `settings.fields` + comparar `properties.updatedFields` evita que una automatización se dispare en cada save del modelo. En ALBRA: en `triggerConfig` agregar `watchedFields: ['stageId']` y solo disparar cuando ese campo cambió (comparar before/after en el punto donde emitimos el evento). YA tenemos el evento `opportunity_stage_changed`; falta la semántica de "solo si cambió X".
3. **DELAY + resume para secuencias de seguimiento.** La secuencia típica de ventas ("si no respondió en 3 días → seguir") en Twenty se implementa con step DELAY + job de reanudación. En Next.js sin Redis: guardar el run en estado `waiting` con `resumeAt` y un cron (Vercel Cron o el daemon de WhatsApp ya existente) que cada minuto haga `automationRun.findMany({ where: { status: 'waiting', resumeAt: { lte: now } } })` y ejecute la acción siguiente. YA tenemos `nextRunAt` en `Automation` y `schedule` como trigger; falta el run-level "pausa y reanuda".
4. **Versionado ligero (draft vs activo).** Twenty nunca ejecuta el draft: se publica una versión y solo la versión ACTIVE recibe triggers. Para ALBRA basta `Automation.version Int` + `draftConfig String?` (edición en borrador, botón "Publicar" que copia a `triggerConfig/conditions/actions` e incrementa `version`) — evita que editar una automatización activa rompa runs a mitad.

---

## 2. Timeline / Activity (feed cronológico por registro)

### (a) Cómo lo hace Twenty

Estructura en `packages/twenty-server/src/modules/timeline/`:

- **Entidad única polimórfica** `timeline-activity.workspace-entity.ts`: `happensAt: Date` (¡no createdAt! — es el tiempo "de negocio" del evento), `timelineActivityTypeId` + `timelineActivityTypeSnapshot` (JSON con label/icono congelado al momento del evento), `properties: JSON` (**solo el diff**, ver abajo), `linkedRecordCachedName` (nombre cacheado del registro relacionado para no hacer joins al pintar), `linkedRecordId` + `linkedObjectMetadataId` (el registro "fuente"), y **columnas target polimórficas**: `targetPersonId`, `targetCompanyId`, `targetOpportunityId`, `targetNoteId`, `targetTaskId`, `targetWorkflowId`, ... (una columna FK por objeto "targeteable" + `custom` para objetos custom).
- **Poblado por eventos, no por escrituras manuales**: el job `jobs/upsert-timeline-activity-from-internal-event.job.ts` consume la cola `entityEventsToDbQueue` (batch de eventos de records) y `services/timeline-activity.service.ts` aplica **reglas de ruteo declarativas** (`timeline-activity-routing-plan.service.ts`): `TimelineActivityRule { sourceObjectMetadata, actions: created|updated|linked|unlinked, triggerFieldNames, happensAtFieldName, targetShape }`. Las reglas `source` cubren eventos del propio objeto; las `junction` cubren cambios en tablas de relación (p.ej. "persona vinculada a empresa" genera actividad en AMBOS timelines).
- **Solo se guarda el diff**: `keepDiffOnly(properties)` — el payload del evento contiene el record completo, pero a `properties` solo entra `{ diff: { campo: { before, after } } }` porque el record actual se lee live. `excludeNonAuditLoggedFieldsFromEvents` filtra campos ruidosos (p.ej. contadores).
- **Merge/idempotencia**: `build-timeline-activity-merge-key.util.ts` genera claves de merge (p.ej. mismo email + mismo registro) y el repository hace upsert con advisory locks para que los reintentos de la cola no dupliquen actividades.
- **happensAt sincronizado**: si el evento proveniente tiene campo de fecha de negocio (p.ej. `message.receivedAt`), la regla declara `happensAtFieldName` y un util posterior (`build-linked-timeline-activity-happens-at-sync-updates.util.ts`) re-sincroniza el `happensAt` de actividades ya escritas cuando el valor fuente cambia — la posición en el timeline siempre refleja la realidad.
- **Front** (`twenty-front/src/modules/activities/timeline-activities/`): hook `useTimelineActivities.ts` consulta `TimelineActivity` con filtro `{ target{Object}Id: { eq: recordId } }` y `orderBy [{ happensAt: 'DescNullsFirst' }]`; `EventList.tsx` aplica filtro por tipo de actividad (chips toggle) y agrupa con `groupEventsByMonth.ts` (grupo por año+mes, orden descendente); `EventsGroup.tsx` pinta separador de mes + barra vertical de timeline; los rows son **renderizadores por tipo** (`rows/main-object/EventRowMainObjectUpdated.tsx` pinta el diff campo a campo; `rows/message/EventCardMessage.tsx` etc.).

### (b) Catálogo de conceptos

- **Acciones que generan actividad**: `created`, `updated`, `linked`, `unlinked` (y destrucciones ignoradas o tratadas según regla).
- **Tipos de actividad** con snapshot inmutable (label + icono) y filtro de UI por tipo (toggle chips).
- **Ordenación**: `happensAt DESC NULLS FIRST`; paginación por cursor del front (`fetchMoreRecords`).
- **Componentes del row**: icono por tipo, autor (workspaceMember), fecha relativa, diff de campos, tarjeta expandible del contenido vinculado.

### (c) Ideas adoptables por CRM ALBRA

1. **Agregar `happensAt` + `metadata` con diff a TimelineEvent.** YA tenemos el modelo `TimelineEvent` polimórfico (clientId/opportunityId/quoteId/reservationId) y `@@index([organizationId, clientId, createdAt])` — muy cerca del patrón Twenty. Faltan dos cosas: (a) campo `happensAt DateTime` para poder backdated ("la llamada fue ayer"), usando `createdAt` como fallback; (b) escribir `metadata` como diff `{campo: {before, after}}` en los eventos `stage_change` generados desde las mutaciones de oportunidad.
2. **Nombre cacheado + snapshot de tipo.** Copiar `linkedRecordCachedName` como `title`/`entityLabel` congelado: si un cliente se renombra, las actividades viejas siguen teniendo sentido. Y el "snapshot de tipo" se traduce en guardar en `metadata` el `label` del tipo al crear (p.ej. `"Cambio de etapa"`), de modo que renombrar tipos en código no rompa el histórico.
3. **Agrupación por mes + diff visual en el front.** La utilidad `groupEventsByMonth` es 25 líneas importables tal cual (adaptando el tipo); el patrón de un renderizador por `type` de evento (switch en el row) con diff `before → after` para `stage_change`/`quote_status_changed` es exactamente lo que ALBRA necesita para el timeline unificado. YA cubierto: modelo polimórfico, índices y `source` (manual|agent|integration|automation) que mapea al `workspaceMember` actor de Twenty.

---

## 3. Vistas guardadas (Views)

### (a) Cómo lo hace Twenty

En `packages/twenty-server/src/engine/metadata-modules/` (nota: en Twenty las views son metadata del **core schema**, no objetos de workspace): `view/`, `view-field/`, `view-filter/`, `view-filter-group/`, `view-sort/`, `view-group/`, `view-permissions/`.

**`view/entities/view.entity.ts`** — campos principales:
`name`, `objectMetadataId` (a qué objeto aplica), `type` (ver catálogo), `key` (`INDEX` = vista por defecto del objeto), `icon`, `position`, `isCompact`, `isCustom`, `visibility` (`WORKSPACE` = compartida con todos | `UNLISTED` = accesible por link), `createdByUserWorkspaceId` (dueño), `anyFieldFilterValue` (búsqueda global de la vista), y config por tipo: kanban (`kanbanAggregateOperation`, `kanbanAggregateOperationFieldMetadataId`, `mainGroupByFieldMetadataId`, `kanbanColumnWidth`), calendario (`calendarLayout`, `calendarFieldMetadataId`, `calendarEndFieldMetadataId`), `shouldHideEmptyGroups`, `groupLoadLimit`.

**Hijos de la vista (composición):**
- `ViewFilter`: `fieldMetadataId`, `operand`, `value` (JSON), `subFieldName?` (subcampo compuesto, p.ej. `firstName` de fullName), `relationTargetFieldMetadataId?` (filtrar por campo del registro relacionado), y `viewFilterGroupId` + `positionInViewFilterGroup` para agruparse.
- `ViewFilterGroup`: `logicalOperator` (AND|OR|NOT), `parentViewFilterGroupId` (anidamiento recursivo), `positionInViewFilterGroup`.
- `ViewSort`: `fieldMetadataId`, `direction` (ASC|DESC), `subFieldName?` — con **unique `(fieldMetadataId, viewId) where deletedAt IS NULL`** (un solo sort por campo).
- `ViewField`: `fieldMetadataId`, `isVisible`, `size`, `position`, `aggregateOperation` (COUNT/SUM/AVG... por columna) — define columnas visibles y orden.

**Compartición**: `visibility: WORKSPACE|UNLISTED` + `createdByUserWorkspaceId`; los objetos view son `SyncableEntity` (se sincronizan con apps/snapshots). Índices compuestos por `(workspaceId, viewId)` en todos los hijos.

### (b) Catálogo de tipos/operadores

**ViewType**: `TABLE`, `KANBAN`, `CALENDAR`, `LIST` (+ variantes `_WIDGET` para embeber en dashboards).

**ViewFilterOperand** (`twenty-shared/src/types/ViewFilterOperand.ts`):
`IS`, `IS_NOT`, `IS_NOT_NULL`, `LESS_THAN_OR_EQUAL`, `GREATER_THAN_OR_EQUAL`, `IS_BEFORE`, `IS_AFTER`, `CONTAINS`, `DOES_NOT_CONTAIN`, `IS_EMPTY`, `IS_NOT_EMPTY`, `IS_RELATIVE` (fechas relativas tipo "últimos 7 días" — `parse-and-evaluate-relative-date-filter.util.ts`), `IS_IN_PAST`, `IS_IN_FUTURE`, `IS_TODAY`, `VECTOR_SEARCH` (búsqueda semántica).

**ViewFilterGroupLogicalOperator**: `AND`, `OR`, `NOT`. **ViewSortDirection**: `ASC`, `DESC`.

Semántica de evaluación en memoria (la misma máquina que usan los filtros de workflow): `evaluateFilterConditions` en `src/modules/workflow/workflow-executor/workflow-actions/filter/utils/evaluate-filter-conditions.util.ts` — switch por tipo de campo con conversión de operandos deprecated; fecha usa `Temporal` (IS_BEFORE/IS_AFTER comparan instantes; IS compara PlainDate).

### (c) Ideas adoptables por CRM ALBRA

1. **Partir `SavedView.filters` en operandos con nombre veinte-style.** YA tenemos `SavedView { filters JSON [{field, operator, value}], sort JSON {field, direction}, isShared, isDefault }` — el gap es el catálogo de operadores: ampliar `operator` a `is | is_not | contains | not_contains | gt | gte | lt | lte | is_empty | is_not_empty | in | is_before | is_after | is_relative` y **tipar el JSON** con una interfaz compartida `src/lib/view-filters.ts` (misma fuente de verdad para front y API routes). El evaluador en memoria de Twenty (`evaluateFilterConditions`) es el molde exacto para una función `applyViewFilters(records, filters)` en `src/lib/` reutilizable por exports/kanban/tabla.
2. **ViewField implícito = columnas visibles + orden.** Twenty separa "qué columnas se ven y en qué orden" (ViewField) de "cómo se filtra/ordena" (ViewFilter/ViewSort). En ALBRA agregar `columns String?` (JSON: `[{ field, position, size }]`) a `SavedView` es una línea de schema y transforma la vista de "filtro guardado" a "espacio de trabajo guardado".
3. **`is_relative` para fechas + vista por defecto por entidad.** El operador relativo ("próximos 7 días", "vencidas") es oro para un CRM de reservas/quotes (`validUntil`, `expectedCloseDate`): se evalúa al renderizar, no al guardar, así la vista "Quotes por vencer esta semana" siempre está fresca. Además, adoptar `isDefault` como `key: INDEX` (una única vista default por entidad — enforce con partial unique index o en la lógica de guardado) y `visibility` workspace/unlisted ya cubierto por nuestro `isShared` + `userId`.

---

## 4. Multi-tenancy / Workspace

### (a) Cómo lo hace Twenty

- **Modelo híbrido de dos planos** (en PostgreSQL):
  - **Schema `core`** (compartido): usuarios, workspaces, userWorkspaces, views, agents, feature flags — entidades con columna `workspaceId` + índices `(workspaceId, ...)`.
  - **Esquema por workspace**: cada workspace tiene su propio schema PostgreSQL `workspace_<base36(uuid)>` (`engine/workspace-datasource/utils/get-workspace-schema-name.util.ts`) con las tablas de records (person, company, opportunity, workflow, timelineActivity...). Aislamiento físico total de datos de negocio.
- **Contexto de workspace via AsyncLocalStorage**: `engine/twenty-orm/storage/orm-workspace-context.storage.ts` define `workspaceContextStorage = new AsyncLocalStorage<ORMWorkspaceContext>()` con `withWorkspaceContext(context, fn)` y `getWorkspaceContext()` que **lanza si no hay contexto**. El `ORMWorkspaceContext` carga (y cachea) metadata del workspace: object/field maps, feature flags, permisos por rol. Cualquier servicio hace `workspaceOrmManager.executeInWorkspaceContext(fn, authContext)` y dentro el repositorio resuelve schema + permisos automáticamente.
- **Enforced en repositorio, no en cada query**: `WorkspaceRepository` (engine/twenty-orm/repository) y `WorkspaceScopedRepository` (para entidades del core) **inyectan `workspaceId` en el `where` de todas las operaciones** (`mergeWorkspaceIdIntoWhere`) y hace `assertWorkspaceId` (falla si falta). Es imposible olvidar el filtro porque el API del repo lo exige como primer parámetro: `findOne(workspaceId, options)`.
- **Permisos por rol aplicados al resolver queries**: `resolveObjectRecordsPermissions` + `ObjectsPermissionsByRoleId` filtran columnas/filas según el rol del actor dentro del contexto; los triggers/workflows usan `buildSystemAuthContext(workspaceId)` (actor system) para eventos internos.
- **Jobs en cola siempre llevan `workspaceId` en el payload** (`WorkflowTriggerJobData`, `RunWorkflowJobData`) y re-establecen el contexto al procesar — nunca confían en variables globales.

### (b) Catálogo de mecanismos

1. Columna `workspaceId` + índice compuesto en toda entidad de negocio (convención `@Index('IDX_..._WORKSPACE_ID', ['workspaceId', ...])`).
2. Contexto implícito AsyncLocalStorage + guardas que fallan rápido si falta.
3. Repositorios que fuerzan `where.workspaceId` (defensa en profundidad).
4. Actor metadata en cada write (`createdBy/updatedBy: ActorMetadata { source, name, workspaceMemberId }`) para auditoría.
5. Jobs con `workspaceId` explícito + `buildSystemAuthContext`.

### (c) Ideas adoptables por CRM ALBRA

1. **YA CUBIERTO en esencia**: nuestro `organizationId` en todos los modelos + índices compuestos es el patrón "columna tenant" de Twenty (nuestra versión del schema-per-workspace, correcta para SQLite/una sola DB). 
2. **Falta la defensa en profundidad del repositorio**: crear `src/lib/tenant.ts` con helpers `tenantFindFirst(orgId, args)`, `tenantUpdate(...)`, `tenantDelete(...)` que envuelvan `db` e **inyecten `organizationId` en where/create** y lancen si falta — mismo espíritu que `WorkspaceScopedRepository` (Prisma no tiene middleware global recomendado desde client extensions; un wrapper o `Prisma.$extends` es el equivalente directo). Esto elimina la clase entera de bugs de fuga entre organizaciones en API routes.
3. **Actor metadata en timeline/logs**: Twenty estampa `ActorMetadata { source: MANUAL|SYSTEM|API|AGENT, workspaceMemberId }` en cada write. Nuestro `TimelineEvent.source` ya lo hace para timeline; extender el patrón a `ActivityLog` (quién: userId vs 'agent' vs 'automation') da auditoría homogénea.
4. **Jobs asíncronos siempre con orgId en payload y re-contextualizados**: verificar que cualquier procesamiento diferido (daemon WhatsApp, crons de automation) reciba `organizationId` y re-resuelva settings/de DB por tenant en cada ciclo — patrón `buildSystemAuthContext` de Twenty.

---

## 5. AI agents / tools sobre registros

### (a) Cómo lo hace Twenty

**Entidades** (`engine/metadata-modules/ai/`):
- `ai/ai-agent/entities/agent.entity.ts`: `Agent { name, label, description, prompt (system prompt), modelId, responseFormat (JSON, default {type:'text'}), modelConfiguration (JSON: temperatura etc.), isCustom, evaluationInputs }`.
- `ai-chat/`: threads/turnos/mensajes (`AgentChatThread`, `AgentTurn`, `AgentMessage`, `AgentMessagePart` con partes de tool-call persistidas), streaming SSE con heartbeat y recuperación de streams, contadores de tokens/créditos por thread.
- `ai-agent-execution/`: ejecutor asíncrono reutilizado por el workflow action `AI_AGENT` (`modules/workflow/workflow-executor/workflow-actions/ai-agent/ai-agent.workflow-action.ts`).

**Arquitectura de tools — dos capas:**

1. **Capa de tools estáticas** (`engine/core-modules/tool/`): cada tool es una clase inyectable que implementa la interfaz **`Tool { description, inputSchema (FlexibleSchema de @ai-sdk), execute(input, context: {workspaceId, userId, threadId}), flag?: PermissionFlagType }`** (`types/tool.type.ts`). Ejemplos: `http-tool`, `send-email-tool`, `draft-email-tool`, `create-calendar-event-tool`, `code-interpreter-tool`, `navigate-tool`, `file-upload-tool`.
2. **Capa de providers que GENERAN tools dinámicos** (`engine/core-modules/tool-provider/`): `ToolRegistryService` agrega `ToolProvider`s por categoría; el `DatabaseToolProvider` (`providers/database-tool.provider.ts`) es el patrón estrella:
   - Por **cada objeto del workspace** al que el rol del agente tiene permiso, genera herramientas con **nombres convencionales**: `find_many_{plural}`, `find_one_{singular}`, `group_by_{plural}`, `create_one_{singular}`, `create_many_{plural}`, `update_one_{singular}`, `update_many_{plural}`, `upsert_many_{plural}`, `delete_one_{singular}`, `delete_many_{plural}`.
   - El **inputSchema se genera desde la metadata de campos** del objeto (zod → JSON Schema via `toToolJsonSchema`, respetando `restrictedFields` del permiso) — el LLM ve descripciones de campo reales.
   - Cada descriptor lleva `executionRef { kind: 'database_crud', objectNameSingular, operation }` — el schema describe, un executor central despacha (nada de closures por objeto).
   - Descripciones de tool largas y con reglas de uso (paginación con `hasNextPage`, advertencias de update_many/delete_many masivos).
   - `ToolProvider` interface: `{ category, isAvailable(ctx), generateDescriptors(ctx, {includeSchemas}), executeStaticTool(...) }` — los providers por objeto solo existen si hay permisos (`canReadObjectRecords` etc.).
3. **Registro + ejecución**: `ToolRegistryService.getCatalog()/resolveSchemas()` produce el catálogo (con lazy schemas: el system prompt incluye el catálogo SIN schemas para ahorrar tokens, y los schemas se resuelven on-demand); `ToolExecutorService` ejecuta con error wrapping y **transforms de salida** (`output-transforms/compact-tool-output.util.ts`, `normalize-tool-output-to-json-values.util.ts`) para no reventar la ventana de contexto.
4. **Loop de chat**: `services/chat-execution.service.ts` usa **`streamText` del Vercel AI SDK** con `tools: activeTools` y `stopWhen` para forzar pasos; sistema de prompt **por secciones con presupuesto de tokens** (`system-prompt-builder.service.ts`: Base Instructions + Response Format + Workspace Instructions + User Context + **Tool Catalog** + Skill Catalog, cada sección con `estimatedTokenCount`).
5. **Meta-pattern: el agente construye workflows**: `modules/workflow/workflow-tools/tools/*.tool.ts` expone al agente herramientas `create_complete_workflow`, `update_workflow_version_trigger`, `validate_workflow`, `activate_workflow_version`... con **schemas zod que reusan `workflowTriggerSchema`/`workflowActionSchema`** y descripciones con las trampas del schema ("NEVER use RECORD_CREATED, use DATABASE_EVENT") — es decir, el mismo catálogo de tipos del motor se expone como tool-calling.
6. **Workflow action AI_AGENT**: el step trae `{ agentId, prompt }`; resuelve el prompt contra el contexto (`resolveInput(prompt, context)` para interpolar outputs de steps previos) y delega al mismo executor de agentes con tool-calling completo → los workflows y el chat comparten el mismo agente con las mismas tools.

### (b) Catálogo de tools sobre records

Por objeto: `find_many` (filtros por campo con operadores `eq/ilike/...` combinables con and/or/not, limit/offset/orderBy), `find_one`, `group_by` (agregaciones COUNT/SUM/AVG/MIN/MAX), `create_one`, `create_many` (máx 20), `update_one`, `update_many`, `upsert_many`, `delete_one`, `delete_many` (soft-delete). Categorías adicionales de tools: metadata, views, dashboards, workflow, roles, webhooks, lógica embebida (logic functions), navegación, email/calendario, help-center.

### (c) Ideas adoptables por CRM ALBRA

1. **Generar tool schemas desde Prisma, no a mano.** El patrón `DatabaseToolProvider` se traduce 1:1: en `src/lib/ai/tools/records.ts`, iterar sobre los modelos Client/Opportunity/Quote/Reservation (desde el Prisma DMMF o un mapa estático de campos con labels en español) y producir `find_clients`, `update_opportunity`, `create_quote`... con JSON Schema generado del tipo de campo (`String→string`, `Float→number`, `DateTime→string date-time`) y descripciones de campo. YA tenemos `llmChat` (chat plano sin tools); el paso siguiente es un loop de tool-calling con el AI SDK (`streamText` + `tools` + `stopWhen`, igual que Twenty) o function-calling manual sobre nuestro proveedor configurable (`Settings.llmProvider`).
2. **Executor central con executionRef + whitelist de org.** Cada tool `execute(input, ctx)` debe recibir `ctx = { organizationId, userId }` y **todas** las queries Prisma dentro filtran por `organizationId` (conecta con la idea 4.2). El `executionRef` (op = find/update/create + objeto) permite despachar a un único switch con validación de permisos por rol (`User.role`) en un solo lugar — nada de lógica de negocio duplicada por tool.
3. **Agente con mismas tools dentro del workflow.** Nuestro `ai_followup` ya llama al LLM desde el motor; al tener tool-calling, la misma función `runAgent(orgId, prompt, tools)` debe servir tanto para el chat como para el step de workflow (patrón `AiAgentWorkflowAction`), interpolando `{{clientId}}`/`{{lastMessage}}` del payload del trigger antes de llamar. Complementar con un "catálogo de herramientas" en el system prompt sin schemas (ahorro de tokens) y salida compactada (`compactToolOutput`) para respuestas de WhatsApp.

---

## Recomendaciones priorizadas

1. **(Views) Tipar y ampliar operadores de filtro**: definir `ViewFilter` TS compartido (`is|is_not|contains|gt|gte|lt|lte|is_empty|in|is_before|is_after|is_relative`) en `src/lib/view-filters.ts` con evaluador en memoria estilo `evaluateFilterConditions` — reutilizable por tabla, kanban, exports y agente. (Base: ya tenemos `SavedView.filters`.)
2. **(Views) Agregar `columns` y `is_relative` a SavedView**: una migración pequeña (`columns String?`) convierte la vista en espacio de trabajo completo; `is_relative` da vistas siempre frescas ("quotes por vencer").
3. **(Workflows) Persistir estado por acción en AutomationRun**: `stepStates` + `stepLogs` (JSON) y acciones idempotentes, para debugging UI y reintentos parciales (patrón `WorkflowRun.state/stepInfos/stepLogs`).
4. **(Workflows) Implementar DELAY a nivel run** (`status: 'waiting'` + `resumeAt` + barrido por cron existente) para secuencias de seguimiento multi-día sin colas externas.
5. **(Workflows) Watched fields + draft/activo**: disparar `opportunity_stage_changed` solo si `stageId` cambió (comparar before/after), y editar automatizaciones en `draftConfig` con botón "Publicar" (patrón WorkflowVersion).
6. **(Timeline) `happensAt` + diff en `metadata`**: backdating de eventos y diffs `{before, after}` para `stage_change`/`quote_status_changed`; agrupación por mes en el front (copiar `groupEventsByMonth`).
7. **(Tenancy) Wrapper tenant-safe de Prisma** (`$extends` o helpers `tenantFind*` que inyecten `organizationId` y fallen si falta) — defensa en profundidad equivalente a `WorkspaceScopedRepository`.
8. **(AI) Loop de tool-calling con tools generadas del schema Prisma** (nombres `find_many_{plural}` etc., `executionRef` + executor central con `organizationId` forzado), compartido entre el chat del agente y el step `ai_followup` del motor de workflows.
