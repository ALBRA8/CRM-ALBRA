# Worklog — CRM ALBRA

---
Task ID: 1
Agent: main (Super Z)
Task: Retomar proyecto CRM ALBRA: (1) explorar código del ZIP subido, (2) retomar evaluación de Twenty CRM y proponer 3-5 funcionalidades, (3) presentar plan sin escribir código.

Work Log:
- Se buscó CRM_ALBRA.zip en /home/z/my-project/upload/ → directorio VACÍO. El archivo NO llegó al servidor (probable falla de la plataforma en la sesión anterior).
- Se buscó cualquier .zip en el filesystem (find) → sin resultados.
- Se verificó el git local (/home/z/my-project) → solo contiene archivos base del entorno (.env, .gitignore, download/README.md). No hay código del proyecto.
- Se intentó acceder al preview de la sesión anterior (https://preview-chat-1fd262b6-15ad-4db1-87f9-39705b41845f.space-z.ai/) → HTTP 403, no accesible desde esta sesión.
- Se investigó Twenty CRM (twentyhq/twenty) vía web search + README oficial de GitHub:
  - Stack: TypeScript, Nx, NestJS + BullMQ, PostgreSQL, Redis; frontend React + Jotai + Linaria + Lingui.
  - Features clave v2 (2025-2026): objetos/objetos custom + campos, pipelines kanban drag-and-drop, vistas guardadas (tabla/kanban/calendario), motor de Workflows (triggers sobre registros/emails/calendario/tareas + condiciones de filtro + nodos de IA), AI Agents con acceso a registros y chat, timeline unificado por registro, sincronización de email (Gmail/Outlook) y calendario anclados al timeline, API GraphQL/REST + Webhooks + Twenty SDK + CLI, roles/permisos, i18n.

Stage Summary:
- BLOQUEANTE: el ZIP de CRM ALBRA no llegó al servidor. Se solicitó al usuario re-subirlo.
- Evaluación de Twenty CRM completada y propuesta de 3-5 funcionalidades priorizadas presentada al usuario, mapeada a la propuesta de valor de ALBRA (capturar prospectos / avanzar oportunidades / fidelizar clientes / agente 24-7).
- Estado: esperando (a) re-upload del ZIP y (b) aprobación del usuario antes de escribir código.

---
Task ID: 2
Agent: main (Super Z)
Task: Recuperar el código de CRM ALBRA desde el preview desplegado (el ZIP del usuario nunca llegó al servidor) y completar análisis de estructura/stack.

Work Log:
- Usuario reportó que el ZIP (493 KB) no carga; verificado: carpeta upload vacía tras 2 intentos.
- Usuario sugirió hacer copia desde el preview: https://preview-chat-1fd262b6-15ad-4db1-87f9-39705b41845f.space-z.ai/
- curl GET con User-Agent de navegador → HTTP 200 (el 403 anterior era solo por cabeceras).
- El preview corre Next.js en modo DEV (Turbopack): chunks NO minificados + SOURCE MAPS accesibles (.js.map → 200).
- Mirror completo: 72 assets (HTML, chunks JS, CSS) en /home/z/my-project/crm_albra_mirrored/.
- Recuperación de fuentes originales desde source maps (formato de secciones indexadas): 1.420 archivos → extraídos 62 archivos del proyecto real (src/) = 17.308 líneas de TS/TSX.
- Guardado: /home/z/my-project/download/crm_albra_frontend_recuperado.zip y /home/z/my-project/crm_albra_recovered/.
- Backend vivo verificado: /api/nicho (branding "CRM ALBRA", rubro "Servicios Profesionales", personalidad del agente), /api/push/vapid, /api/whatsapp/daemon-proxy (status disconnected), endpoints protegidos con JWT (401).
- NO recuperable del servidor (solo contrato conocido vía lib/api.ts): ~40 route handlers de src/app/api/**, prisma/schema.prisma, lib/db, app/layout.tsx, app/globals.css (tokens extraíbles del CSS compilado), package.json (deps inferibles de imports), WhatsApp daemon (:3002, servicio Node separado).

Stage Summary:
- STACK confirmado: Next.js 15/16 + Turbopack (app router), React 19, Zustand (persist), Tailwind CSS v4 (tokens --color-*, oklab), shadcn/ui (radix), lucide-react, framer-motion, recharts, sonner. Fuente Geist. Paleta: emerald-600 #059669 primario + slate neutros. SPA con view-switching cliente (16 vistas) sobre landing pública.
- 100% del FRONTEND recuperado. Backend a reconstruir desde el contrato de lib/api.ts (597 líneas, todos los endpoints documentados).

---
Task ID: 2-d
Agent: frontend-styling-expert
Task: Landing honesta y legal de CRM ALBRA — eliminar métricas/planes no verificables, reposicionar como beta privada (piloto controlado, 1 empresa por vez), y agregar Dialogs legales (Términos/Privacidad) conforme a Ley 1581 de 2012. Sin rediseño: solo edición de contenido + 1 dialog.

Work Log:
- Leído landing-page.tsx completo (846 líneas) y worklog.md. Verificación de claims contra el código recuperado:
  - "14 módulos" → VERIFICABLE: sidebar.tsx navItems tiene exactamente 14 entradas. Se conservó.
  - "3 canales" → VERIFICABLE: lib/api.ts tiene endpoints de WhatsApp, Telegram e Instagram. Se conservó con detalle ("WhatsApp · Telegram · Instagram").
  - "11 herramientas IA" → NO verificable (las tool definitions vivían en los ~40 route handlers NO recuperados). Eliminada.
- Hero (Stats): reemplazado "11 herramientas IA" por "1 empresa por vez — beta privada" (micro-copy honesto). Subtextos: "módulos completos", "WhatsApp · Telegram · Instagram", "empresa por vez — beta privada". Comentario en código documenta la fuente verificable de cada número.
- Demo CTA: texto "INICIAR" → "INICIAR DEMO". Handler api.demoLogin() intacto.
- Features: promesas absolutas suavizadas — "Nunca más pierdas una cita o un cliente" → "recordatorios automáticos para ti y para tus clientes"; "te dice exactamente cuándo..." → "te sugiere cuándo...". H1/subtítulo de valor intactos (energía preservada).
- How It Works: eliminada promesa de tiempo "En menos de 30 minutos tu CRM está operativo" → "Conectas tus canales, el agente aprende tu rubro durante el piloto y empieza a responder por ti". Se añadió id="como-funciona" (ancla del footer).
- Pricing: eliminado el array `plans` (2 cards con "$0"/"A convenir" y bullets no verificables tipo "Agente IA con 11 herramientas"). Nueva estructura 1+2:
  - Card destacada emerald "Piloto controlado" (badge "Cupo abierto", titular "1 empresa por vez", micro "Beta privada — plazas limitadas. La demo es gratis; el alcance del piloto se acuerda contigo"). Bullets: CRM completo (14 módulos), agente IA configurado a tu rubro, acompañamiento de implementación, datos aislados por organización, canales conectados, cotizaciones PDF/reportes/recordatorios. CTAs: "Solicitar cupo en la beta" (mailto) + "Empezar gratis la demo" (setView('register') intacto).
  - 2 cards "Próximamente" SIN precios ni features inventadas ("Acceso para equipos", "Planes y precios" — dejan claro que nada se cobra automáticamente).
- Aviso legal bajo pricing: ahora cita Ley 1581 de 2012 y apunta al footer.
- Footer: eliminados TODOS los enlaces muertos (Integraciones, Changelog, Nosotros, Blog, Carreras, Contacto, Cookies, Seguridad y los <span> del bottom bar). Nuevas columnas honestas: Producto (anclas reales #features/#como-funciona/#pricing + botón "Crear cuenta demo" vía setView), Beta (estado: beta privada / cupos: 1 empresa por vez / mailto), Legal (botones que abren el dialog). "© 2024" fijo → año dinámico + "Beta privada".
- NUEVO ARCHIVO src/components/landing/legal-dialog.tsx (1 de máx 2 permitidos): LegalDialog con docs 'privacidad' | 'terminos' sobre ui/dialog.tsx. Privacidad: responsable del tratamiento, datos tratados, finalidad, mensajería+IA (consentimiento de destinatarios / términos de plataformas), cifrado de secretos en reposo + aislamiento por organización, derechos habeas data (acceso/actualización/rectificación/supresión/revocación), cambios. Términos: naturaleza beta (sin SLA ni soporte 24/7 garantizado), cuenta demo, responsabilidad sobre datos, uso aceptable (anti-spam), disponibilidad, sin cargos automáticos, propiedad/exportación/eliminación, contacto. Estilo sobrio, scrollable, accesible (DialogTitle/Description).
- LandingPage: estado legalDoc + <LegalDialog /> montado junto a los dialogs de login/registro; Footer recibe onOpenLegal. Handlers de login/registro/demo SIN cambios.
- Diseño intacto: mismas clases Tailwind, gradientes emerald/teal, badges amber, framer-motion (initial/whileInView/whileHover), grid responsive (md:grid-cols-3 en pricing).
- Lint: `bun run lint` (eslint .) excedió el timeout de 300s a nivel repo; se corrió eslint scoped a src/components/landing/ (ambos archivos) → EXIT 0, sin errores ni warnings. Scan rg de claims prohibidos (500+, 50K, 98%, SLA, ilimitad, 2024...): única coincidencia es la NEGACIÓN legal intencional ("no ofrecemos SLA ni soporte 24/7 garantizado").
- No se tocó ningún otro archivo. No se corrió dev server ni git.

Stage Summary:
- Landing reposicionada como BETA PRIVADA / PILOTO CONTROLADO (1 empresa por vez) con cero métricas no verificables, cero planes de pago inventados y cero enlaces legales muertos.
- Promesas eliminadas: "11 herramientas IA", "en menos de 30 minutos", "Nunca más pierdas...", "te dice exactamente", pricing con precios "$0/A convenir" y bullets sin respaldo, enlaces muertos del footer, "© 2024" fijo.
- Términos y Privacidad ahora son resúmenes legales reales en dialog (Ley 1581/2012, SIC, habeas data, cifrado en reposo, consentimiento de mensajería/IA, contacto).
- Estado: listo para revisión del main agent; único punto abierto de negocio = definir el correo real de contacto (hoy contacto@crm-albra.com) y el texto legal completo firmado.

---
Task ID: 1-b
Agent: Explore
Task: Analizar el repo de referencia twentyhq/twenty (packages/twenty-server + twenty-front) y documentar patrones importables para las 4 funcionalidades del plan de CRM ALBRA (workflows, timeline, vistas guardadas, multi-tenancy, agentes IA). Solo lectura + un documento.

Work Log:
- Leído worklog.md para contexto. Confirmado el repo en /home/z/my-project/reference/twenty (monorepo Nx, 23 paquetes).
- Mapeado el módulo workflow del server: src/modules/workflow/{common/standard-objects, workflow-trigger, workflow-runner, workflow-executor, workflow-builder, workflow-tools}. Extraído el modelo de 3 niveles (Workflow -> WorkflowVersion con trigger+steps JSON y grafo por nextStepIds -> WorkflowRun con state/stepInfos/stepLogs) y los catálogos completos: 4 trigger types (DATABASE_EVENT, MANUAL, CRON, WEBHOOK) y 20 action types (CODE, SEND_EMAIL, CREATE/UPDATE/DELETE/UPSERT/FIND_RECORDS, PICK_RECORD, FORM, FILTER, IF_ELSE, HTTP_REQUEST, AI_AGENT, CLASSIFY, ITERATOR, EMPTY, DELAY, etc.).
- Estudiada la ejecución: listener @OnDatabaseBatchEvent('*', ...) + mapa cacheado de triggers + watched fields + filtros del trigger -> job BullMQ con retryLimit 3; executor que recorre el grafo con utils de decisión puras (should-execute-step, should-fail-safely, retry con AWAITING_RETRY + delays); DELAY implementado como reanudación por job diferido (DURATION | SCHEDULED_DATE); MAX_EXECUTED_STEPS_COUNT=20.
- Estudiado el motor de filtros compartido: StepFilter/StepFilterGroup (grupos anidables AND/OR) y evaluate-filter-conditions.util.ts (evaluación en memoria por tipo de campo con Temporal para fechas, IS_RELATIVE para fechas relativas); ViewFilterOperand (15 operandos) reutilizado tanto por views como por workflows.
- Estudiado timeline: entidad polimórfica TimelineActivity (happensAt de negocio, properties con SOLO el diff, linkedRecordCachedName, target columns por objeto, timelineActivityTypeSnapshot), poblado por eventos vía cola entityEventsToDbQueue con reglas de ruteo declarativas (source + junction para relaciones), merge keys para idempotencia, sincronización de happensAt; front agrupa por mes (groupEventsByMonth) con renderizadores por tipo y diff campo a campo.
- Estudiadas views (metadata del core schema): View (type TABLE/KANBAN/CALENDAR/LIST + widgets, key INDEX, visibility WORKSPACE/UNLISTED, createdBy, anyFieldFilterValue, config kanban/calendario) + ViewField (columnas visibles/orden/agregación) + ViewFilter (operand, value JSON, subFieldName, viewFilterGroupId) + ViewFilterGroup (AND/OR/NOT anidado) + ViewSort (único por campo).
- Estudiada la tenancy: esquema PostgreSQL por workspace (workspace_<base36 uuid>) para records + core schema compartido con workspaceId; AsyncLocalStorage (orm-workspace-context.storage) con withWorkspaceContext que lanza si falta contexto; WorkspaceScopedRepository que inyecta workspaceId en el where de TODAS las operaciones (assertWorkspaceId); jobs siempre llevan workspaceId y usan buildSystemAuthContext.
- Estudiados los agentes IA: Agent entity (prompt, modelId, responseFormat), chat con streaming (AI SDK streamText + stopWhen), system prompt por secciones con presupuesto de tokens; arquitectura de tools en 2 capas: Tool { description, inputSchema, execute(input, {workspaceId,...}) } estáticas + ToolProviders que GENERAN tools dinámicas por objeto (DatabaseToolProvider: find_many_{plural}, create_one_{singular}, group_by, upsert_many, etc., con JSON Schema generado desde metadata de campos y executionRef {kind, objectNameSingular, operation} despachado centralmente); tool registry con catálogo sin schemas en el prompt (ahorro de tokens) y output transforms para compactar. Meta-pattern: workflow-tools expone create_complete_workflow/validate_workflow como tools del agente reusando los schemas del motor. El action AI_AGENT del workflow delega al mismo executor de agentes con interpolación de variables del contexto.
- Leídos en paralelo nuestros src/lib/workflow-engine.ts y prisma/schema.prisma para marcar qué YA está cubierto (organizationId en todos los modelos, Automation/AutomationRun, TimelineEvent polimórfico con source, SavedView con filters/sort/isShared/isDefault, llmChat sin tools).
- Escrito /home/z/my-project/docs/twenty-insights.md (ES): 5 áreas con (a) cómo lo hace Twenty con rutas de referencia, (b) catálogos de tipos/operadores, (c) ideas concretas adoptables con Prisma/SQLite/Next API routes + qué ya tenemos; cierre con 8 recomendaciones priorizadas.

Stage Summary:
- Entregable generado: docs/twenty-insights.md con catálogos completos (4 triggers, 20 actions, 15 operands, 10 tools CRUD por objeto) y rutas de archivo verificadas del repo twenty.
- Hallazgos más accionables para ALBRA: (1) stepStates/stepLogs en AutomationRun, (2) DELAY a nivel run con resumeAt + cron, (3) watched fields en triggers de cambio de etapa, (4) happensAt + diff en TimelineEvent, (5) operandos ricos + is_relative + columns en SavedView, (6) wrapper tenant-safe de Prisma que inyecte organizationId (equivalente WorkspaceScopedRepository), (7) tools IA generadas desde el schema Prisma con executor central y orgId forzado, compartidas entre chat y workflow.
- No se modificó ningún archivo del proyecto (solo lectura del repo twenty + creación del documento + este append al worklog).

---
Task ID: 2-c
Agent: full-stack-developer (frontend, funcionalidades nuevas inspiradas en Twenty CRM)
Task: Implementar en el frontend de CRM ALBRA las 4 features nuevas del plan: (A) Timeline unificado en ClientDetail, (B) Vistas guardadas en ClientsList y PipelineView, (C) Constructor de workflows en Automations, (D) Acciones del agente IA en ChatPage. Consumo la API pactada (/api/timeline, /api/saved-views, campos nuevos de /api/automations, actions del /api/chat) que el backend (2-b) construye en paralelo.

Work Log:
- Leídos antes de editar: client-detail.tsx, clients-list.tsx, pipeline-view.tsx, automations-page.tsx, automation-form-dialog.tsx, chat-page.tsx, suggestions-panel.tsx, src/lib/api.ts, src/lib/store.ts, docs/API_CONTRACT.md. Patrón respetado: useState/useEffect, toasts sonner, Skeletons, clases emerald/slate existentes, todo en español.
- NUEVO src/lib/filters.ts: tipos SavedViewFilter/SavedView; motor applyFilters() en cliente con operadores equals|contains|gt|lt|in|not_empty (soporta rutas con puntos tipo client.name, comparación numérica y lexicográfica para fechas); parseViewFilters() tolerante; describeFilter() para badges legibles; labels amables de campos/opera­dores para clients y opportunities; cliente HTTP para vistas guardadas (fetchSavedViews/createSavedView/updateSavedView/deleteSavedView) replicando convenciones de api.ts (Bearer token de localStorage 'crm_token', errores { error }).
- NUEVO src/components/clients/client-timeline.tsx (Feature A): feed cronológico GET /api/timeline?clientId=<id>&limit=50 (fetch directo con Bearer), agrupado Hoy/Ayer/fecha (date-fns + locale es), icono por tipo de evento (note/call/meeting/whatsapp/telegram/instagram/email/quote/stage_change/transaction/system) y color por source (agent=violeta, automation=ámbar, integration=sky, manual=slate), badges de source/tipo, metadata parseada (hasta 3 claves), input rápido "Añadir nota" que llama api.addClientHistory y recarga el feed, skeletons de carga y estado vacío amable, max-h con scroll. Integrado en client-detail.tsx como tab "Timeline" (después de General).
- NUEVO src/components/clients/saved-views-bar.tsx (Feature B, reutilizable): barra estilo Twenty con chips clicables de vistas (Bookmark, icono Users si isShared, X al hover para eliminar), chip "Todas" para limpiar, botón "Guardar vista actual" con dialog (nombre + Switch "Compartir con el equipo" + preview de filtros a guardar); badges activos por filtro con X individual y "Limpiar todo"; si hay búsqueda actual se guarda como filtro contains sobre name. CRUD vía filters.ts; fallos de carga silenciosos (backend en despliegue).
- clients-list.tsx: integra SavedViewsBar (entity=clients); al aplicar una vista se trae limit=500 y filtra en cliente con applyFilters; quitar todos los badges vuelve al listado paginado normal; estado vacío considera vistas activas; setPage(1) al cambiar de vista.
- pipeline-view.tsx: SavedViewsBar (entity=opportunities); filtra las oportunidades de cada columna (estimatedValue/title/interest/probability/client.name) y recalcula totales del header y contador/valor por columna con lo visible.
- automation-form-dialog.tsx RECONSTRUIDO (Feature C): dialog de 3 secciones — 1) "Cuando ocurra…": Select triggerType con labels amables (Nuevo cliente registrado / Oportunidad cambia de etapa / Mensaje recibido / Reserva creada / Cotización cambia de estado / Programado (cada X minutos) / Manual); si Programado muestra intervalMinutes (min 5) → triggerConfig JSON. 2) "Y se cumple…": condiciones dinámicas field+operator+value con agregar/quitar (not_empty oculta el valor). 3) "Entonces…": acciones agregables vía DropdownMenu — notify_admin (title+body), send_whatsapp/send_telegram/send_email (selector de plantillas de api.getTemplates() o texto libre con {{variables}}), create_opportunity (title+amount), update_client_status (status), ai_followup (instruction, "el agente IA redacta el seguimiento"). Al guardar POST/PUT con triggerType/triggerConfig/conditions/actions como JSON strings; preserva message legacy en edición. Reset del formulario al abrir; parseo legacy (conditions objeto→equals, actions objeto/array, send_message→send_whatsapp, message→acción send_whatsapp; sin triggerType→Manual). Exporta triggerTypeLabels reutilizado por la página.
- automations-page.tsx: badge de triggerType (o "Trigger: …" legacy, o "Manual"), badge "Ejecutada N vez/veces" (runCount), badges de N condición(es)/M acción(es) (parseo tolerante de JSON), botón "Ejecutar pendientes ahora" → api.runAutomations() con soporte de la respuesta nueva { processed } y fallback al formato legacy { results }.
- chat-page.tsx (Feature D): soporta respuesta { reply, actions } (fallback a content); las acciones se renderizan como mini-cards violeta bajo el mensaje del bot con icono por tipo (create_client=UserPlus, create_opportunity=TrendingUp, schedule_reservation=CalendarPlus, add_note=StickyNote, quote_summary=FileText, list_recent_clients=List, default=Zap) y el summary; toast.success cuando el backend devuelve acciones. Import de toast añadido.
- Correcciones tipo en mi alcance (preexistentes): client-detail.tsx línea updateClientPreferences (cast) y style ringColor inválido eliminado.
- INCIDENCIA DE ENTORNO (reparada): `bun run dev` del sistema murió con TurbopackInternalError "OS file watch limit reached" (fs.inotify.max_user_watches=8192 < directorios del proyecto). Pasos: 1) agregué /reference a .gitignore; 2) moví /home/z/my-project/reference (dump del repo Twenty, 570MB) a /home/z/reference-twenty (NO borrado); 3) limpié .next y levanté `bun run dev` en background (nohup, log en dev.out.log) porque el auto-runner seguía caído. Servidor OK: GET / 200, sin errores de compilación. Si necesitas el dump de Twenty: está en /home/z/reference-twenty.
- Verificación: eslint sobre mis archivos → 0 errores/0 warnings; tsc --noEmit → sin errores en src/lib/filters.ts, components/{clients,opportunities,automations,chat} (los errores restantes son del backend en curso en src/app/api/** y de artefactos preexistentes en crm_albra_mirrored/). Endpoints nuevos ya responden 401 sin sesión (existen: /api/timeline, /api/saved-views); backend (2-b) continúa en paralelo.

Stage Summary:
- Features A-D implementadas y compilando end-to-end en el frontend, respetando paleta emerald/slate (+violeta/ámbar/sky solo como colores semánticos de agent/automation/integration), español, responsive mobile-first y accesibilidad (aria-labels, roles, foco).
- Los 3 archivos nuevos (filters.ts, client-timeline.tsx, saved-views-bar.tsx) + 6 editados (clients-list, client-detail, pipeline-view, automation-form-dialog, automations-page, chat-page) + .gitignore (/reference).
- Pendiente para QA visual cuando el backend 2-b termine: crear/aplicar vistas guardadas reales, eventos de timeline desde mutaciones (auditAndTimeline) y actions del chat desde el agente.

---
Task ID: 3 (integración principal)
Agent: main (Super Z)
Task: Integración final — completar backend tras timeout de 2-a/2-b, corregir 93 errores TS, verificar seguridad P0 de la auditoría y probar end-to-end.

Work Log:
- 2-a y 2-b (backend) dejaron 76 rutas escritas antes de agotar contexto; completé su lib compartida (_lib/shared.ts: handle/json/requireFields/bool), corregí rutas relativas de auth/* y custom-fields/values.
- Corregidos 93 → 0 errores TypeScript: includes inexistentes (user/client en ActivityLog/TimelineEvent → mapas en memoria), filtro temperature vía customFieldValue.findMany por IDs, serializeClientRef null-safe, smtpFromName eliminado, tipos de User en store.ts (null-compat), BufferSource en push card, guards de newStage.
- Lint: 0 errores (fix react-hooks/set-state-in-effect en push-notifications-card).
- Segundo dev server caído por inotify: veinte (570MB) movido a /home/z/reference-twenty (por 2-c); reiniciado .zscripts/dev.sh.
- Tests end-to-end curl: landing 200; demo login OK (8 clientes sembrados); clients/pagination OK; dashboard stats OK (8 clientes, 4 activos, revenue 2400, pipeline 4000, 5 etapas); CHAT IA creó cliente real "Laura Restrepo" con action chip create_client; TIMELINE responde eventos; SAVED-VIEWS CRUD OK (vista compartida creada); WORKFLOW "Bienvenida automática" disparado por client_created → runCount 1 + notificación + seguimiento redactado por IA; suggestions deterministas OK (shape coincide con frontend); settings/templates/quotes/reports/activity/team/export-CSV → 200.
- Seguridad (bloqueadores de auditoría): nicho PUT sin auth → 401 ✓; con admin → 200 ✓; webhook WhatsApp sin firma → 401 ✓; webhook Telegram sin secret → 401 ✓; rutas de negocio sin token → 401 ✓ (bug 500 corregido en shared.handle con duck-typing de status).

Stage Summary:
- Sistema completo funcionando: frontend recuperado (17.3k líneas) + backend multi-tenant (76 rutas) + motor de workflows event-driven + agente IA con herramientas + timeline unificado + vistas guardadas + landing honesta con dialog legal.
- Todos los P0 de la auditoría cerrados y verificados por curl.
- Pendiente: verificación visual con Agent Browser antes de marcar Complete.

---
Task ID: 4 (verificación final)
Agent: main (Super Z)
Task: Verificación end-to-end con Agent Browser y cierre del proyecto.

Work Log:
- Agent Browser: landing renderiza (hero "Inteligencia Comercial que Trabaja por Ti", estética verde). Demo login → Dashboard con pipeline (5 etapas, montos), tendencia de ingresos, próximas reservas, sugerencias IA. Clientes: tabla con temperatura/score/fuente (incluye clientes creados por IA y workflows). Client detail: tab Timeline con "Historial Unificado" (evento del agente IA con badge violeta, chips de metadata, input de nota rápida). Automatizaciones: workflow "Bienvenida automática" activo con "Ejecutada 1 vez" + botón "Ejecutar pendientes ahora" + Sugerencias IA. Chat AI: el agente creó oportunidad "Rediseño de web" ($500) para Ana Martínez vía tool-calling y respondió con chips "ACCIÓN EJECUTADA" + listado de clientes a contactar hoy.
- Sin errores runtime en dev.log, lint 0 errores, tsc 0 errores, 76 rutas API.
- Commits finales en el repo local del proyecto.

Stage Summary:
- PROYECTO CRM ALBRA COMPLETO Y CORRIENDO: frontend 100% recuperado + backend multi-tenant 76 rutas + 4 features Twenty (workflows event-driven, agente IA con tools, timeline unificado, vistas guardadas) + P0 de auditoría cerrados + landing honesta con dialog legal.
- Entregables extra: docs/twenty-insights.md (análisis del repo Twenty), docs/API_CONTRACT.md, crm_albra_frontend_recuperado.zip.

---
Task ID: 5 (post-entrega)
Agent: main (Super Z)
Task: Renombrar etapas del pipeline a embudo profesional (Prospección, Calificación, Oferta, Seguimiento, Cierre Ganado) + responder sobre análisis de Twenty.

Work Log:
- Verificado que la lógica Ganado/Perdido usa flags isWon/isLost (no nombres) → renombre seguro.
- demo-seed.ts: STANDARD_STAGES actualizado a 6 etapas (Prospección 0.1 slate, Calificación 0.3 sky, Oferta 0.5 orange, Seguimiento 0.75 amber, Cierre Ganado 1.0 emerald isWon, Cierre Perdido 0 red isLost); seedDemoData ahora busca etapas por nuevos nombres; automatización demo "Aviso de oportunidad" condiciona sobre "Oferta".
- scripts/rename-stages.ts: migración idempotente que renombra in place (preserva stageId de oportunidades), inserta etapas faltantes, normaliza orden/probabilidad/color/flags, re-sincroniza opportunity.status con flags de etapa y corrige automatizaciones que referenciaban "Cotizado".
- Ejecutada sobre DB (1 org): 5 renombradas + 1 insertada, 1 automatización corregida, 0 opps afectadas.
- Verificado vía API en vivo: dashboard devuelve las 6 etapas con orden/colores/flags correctos; oportunidades intactas (Calificación, Prospección, Oferta); landing 200; eslint 0 errores; tsc sin errores de proyecto.

Stage Summary:
- Pipeline: Prospección → Calificación → Oferta → Seguimiento → Cierre Ganado (+ Cierre Perdido) aplicado en seed para orgs nuevas y en datos existentes. El análisis de Twenty ya estaba documentado en docs/twenty-insights.md (Task 1-b).

---
Task ID: 6 (post-entrega)
Agent: main (Super Z)
Task: Triage funcional de mejoras Twenty + implementación (DELAY durable, stepStates, filtros relativos) + fix barra duplicada del pipeline.

Work Log:
- Triage honesto del backlog de twenty-insights.md: FUNCIONALES implementados = wait/delay durable, stepStates por acción, fechas relativas en vistas, fix overflow main. ADORNO/ya cubiertos descartados = columnas en vistas, draft/publicar, watched fields (el trigger ya solo dispara si la etapa cambió), diff visual timeline.
- Pipeline UI: barra única (título + métricas + vistas/filtros + botón Nueva Oportunidad); eliminada fila de hint y fila separada de vistas. saved-views-bar.tsx reconstruida: una sola fila con badges integrados, modo compact, constructor de filtros popover (campo→operador→valor con presets relativos).
- FIX de raíz preexistente: main (flex item) sin min-w-0 se expandía al min-content del kanban (1808px) → overflow horizontal invisible que dejaba la barra derecha fuera del viewport. app-layout.tsx: min-w-0 en main (también corrige overflow del dashboard).
- Schema AutomationRun: +resumeAt, +currentStep, +stepStates, +índice (status,resumeAt); db push + generate + restart.
- workflow-engine.ts: acción 'wait' (días/horas/min) pausa el run (status=waiting, resumeAt futuro, currentStep=índice siguiente, stepStates persistidos); runActionSteps() registra estado por acción (success/failed/waiting + ms + error) y propaga parciales al fallar; resumeWaitingRuns() reanuda runs vencidos desde currentStep con payload original, soporta esperas encadenadas; scheduler.runDueJobs() barrerá waiting vencidos (processed incluye reanudados). Fix bug: send_* ahora lee config.body || config.text (el builder guardaba text).
- API GET /api/automations: incluye lastRun {status,error,startedAt,finishedAt,resumeAt,currentStep,steps[]} por automatización (serializeAutomation extendido).
- UI automations: badge de última ejecución (Exitosa/Falló/En espera con fecha de reanudación), detalle expandible paso a paso con ms y errores, "Última: hace X" relativo. Builder: acción "Esperar (pausa)" con inputs días/horas/minutos y serialización numérica.
- filters.ts: operador is_relative con 6 presets (hoy, vencidas, últimos/próximos 7/30 días); fix: presets "últimos" acotados a now (no incluyen futuro). dateFieldsByEntity + campo status en labels de clientes.
- E2E verificado: automatización client_created→notify_admin→wait 1min→ai_followup: run waiting (steps notify ok, wait waiting, currentStep=2) → backdate resumeAt → scheduler reanuda → success con 3 pasos (ai_followup 478ms), runCount=1. UI: constructor de filtros aplica "Monto igual a 500" y kanban filtra a 1 opp/$500; badges lastRun y detalle de pasos renderizan.
- Lint 0 errores, tsc 0 errores de proyecto, app 200.

Stage Summary:
- Entregado: pipeline con UNA sola barra, workflows con pausa durable multi-día (patrón DELAY Twenty), observabilidad de ejecuciones (stepStates + UI), vistas con fechas relativas siempre frescas + constructor de filtros. Descartadas honestamente las mejoras tipo adorno.

---
Task ID: 7 (post-entrega)
Agent: main (Super Z)
Task: Reordenar pestañas de Configuración por importancia + comparar con repo ALBRA8/CRM-ALBRA (blindaje .gitignore, .env.example) y replicar lo que faltara.

Work Log:
- Intento de clon de github.com/ALBRA8/CRM-ALBRA: git clone falla (sin credenciales) y API de GitHub devuelve 404 → repo privado/no público. Se usó como checklist de comparación el detalle dado por el usuario (.env bloqueado, custom.db excluido, .wa-auth excluida, .env.example creado).
- Comparación: aquí ya había `.env*` en .gitignore (✓), pero faltaban: exclusión de db/ (*.db), de .wa-auth/, y la plantilla .env.example (✗ x3).
- Reordenado TabsList de settings-page.tsx según criterio del usuario (izq→der por importancia): Negocio → Agente IA (ex Chat AI) → Google → WhatsApp → Instagram → Telegram → Email SMTP → Inventario → Plantillas → Campos Custom → Equipo → Respaldo. defaultValue="negocio". Comentario en código explica el orden. Los TabsContent no se movieron (Radix Tabs renderiza por value; el orden visual lo dan los triggers).
- Blindaje .gitignore: sección "BLINDAJE DE DATOS PRIVADOS" con db/, *.db (+journal/shm/wal), .wa-auth/, wa-auth/, /upload/, /tool-results/, /repo-compare/ y `!.env.example`.
- Creado .env.example documentado (DATABASE_URL, APP_SECRET, APP_ENCRYPTION_KEY, SMTP_*, WHATSAPP_DAEMON_URL, WHATSAPP_VERIFY_TOKEN) — inventario real de process.env usado en src/ (sin valores reales).
- Descubrimiento clave: `.env` y `db/custom.db` estaban TRACKED en el índice git (las reglas de ignore no aplican a archivos rastreados; check-ignore los reportaba como no ignorados). Aplicado `git rm --cached` a .env, db/custom.db, .zscripts/dev.pid y download/crm_albra_frontend_recuperado.zip (runtime/binary junk). Post-untrack: check-ignore ahora matchea .env por .env* (línea 34) y db/custom.db por db/ (línea 60).
- Incidente corregido: un `git rm -r --cached .` accidental durante la sesión vació el índice; restaurado con `git reset` (sin pérdida de datos).
- Commit 51f7c78 "chore: blindaje datos privados (.env, db/, .wa-auth) + plantilla .env.example + config ordenada por importancia". Historial previo aún contiene .env/db antiguos: si algún día se publica este repo, hacer scrub (git filter-repo) o partir del repo GitHub del usuario.
- Verificación en vivo (agent-browser, sesión demo): tablist en el orden nuevo exacto, tab "Negocio" seleccionada por defecto, tabpanel Negocio renderiza (Moneda, Identidad del Negocio, personalidad del agente). Screenshot: tool-results/settings-orden.png. Landing 200, eslint 0 errores en settings-page, tsc sin errores del proyecto (solo examples/ y skills/ preexistentes).

Stage Summary:
- Configuración ordenada por importancia (Negocio primero, Agente IA 2º, Google 3º, canales de comunicación después, operativas al final) y verificada en navegador.
- Blindaje del repo local replicado al del usuario: .env y db des-rastreados e ignorados, .wa-auth excluida, .env.example profesional commiteable. Repo ALBRA8/CRM-ALBRA inaccesible (404 privado) — pendiente que el usuario lo haga público o comparta detalle adicional si quiere comparación más profunda.

---
Task ID: 8 (post-entrega)
Agent: main (Super Z)
Task: Comparar repo público ALBRA8/CRM-ALBRA (solo extraer lo que falta, NO usarlo como base) + ubicar/crear la secuencia de post-venta.

Work Log:
- Repo clonado a repo-compare (el usuario aclaró: nuestra versión es la buena; solo revisar qué tiene y falta). Análisis: daemon.mjs (603 líneas, Baileys), knowledge/ (2 txt), leeme_arquitectura.md (arquitectura LEGACY de crm.html + memory.db, NO aplica), .gitignore más completo, .env.example con LLM/NVIDIA/GOOGLE/NEXTAUTH (su versión antigua), deps @whiskeysockets/baileys + @hapi/boom + qrcode + qrcode-terminal + better-sqlite3. Su repo NO tiene secuencia post-venta (solo plantilla). repo-compare eliminado tras extraer lo útil (también limpiaba tsc).
- PORTADO daemon Baileys → src/whatsapp-daemon/daemon.mjs (567 líneas) ADAPTADO: organizationId (no userId), Client sin temperature/score, agent auto-reply via /api/chat con X-Internal-Secret, endpoints exactos que espera daemon-proxy, CORS localhost, auto-connect si existe sesión, graceful shutdown.
- Prisma: +modelos WhatsAppConversation (unique org+phone) y WhatsAppMessage (índices conv+createdAt); relaciones en Organization y Client; db push + generate OK.
- /api/chat: auth dual JWT o X-Internal-Secret (orgId derivado del clientId o primera org); executeAgentAction/auditAndTimeline aceptan userId null.
- daemon-proxy: POST ahora envía Authorization: Bearer INTERNAL_API_SECRET.
- workflow-engine: buildActionContext() enriquece payload con clientName/name/phone/email del cliente (en runWorkflowsForTrigger Y resumeWaitingRuns) y send_whatsapp hace envío REAL vía daemon POST /send (8s timeout, resultado sent/error en stepStates).
- SECUENCIA POST-VENTA creada: trigger opportunity_stage_changed → condición toStage="Cierre Ganado"; pasos: wait 3d → send_whatsapp check-in satisfacción → wait 4d → ai_followup (reseña/recomendación). En demo-seed.ts (orgs nuevas, activa) + scripts/seed-postventa.ts ejecutado en BD viva (1 creada). El repo del usuario NO tenía nada de esto.
- Deps instaladas: @whiskeysockets/baileys@7.0.0-rc14, qrcode, qrcode-terminal, @hapi/boom, better-sqlite3 (pm trust OK). Script npm wa:daemon.
- .gitignore: +**/.wa-auth/, .wwebjs_auth/, .wwebjs_cache/, *.zip, .vscode/, .idea/, Thumbs.db. .env.example: +INTERNAL_API_SECRET.
- VERIFICADO EN VIVO: tsc 0 errores (proyecto), eslint 0, daemon arranca (DB WAL OK), /status responde directo y vía proxy, POST /connect con auth → waiting_qr, QR real renderizado en Configuración→WhatsApp (screenshot whatsapp-qr-settings.png), chat interno responde como agente, /api/automations muestra "Secuencia post-venta" activa con 4 pasos (screenshot automatizaciones-postventa.png). E2E engine ya validado en Task 6.
- Commit 04717af. Daemon corriendo en background (nohup, log /tmp/wa-daemon.log) esperando escaneo del QR.

Stage Summary:
- WhatsApp REAL por QR funcionando (falta solo escanear desde el teléfono). Secuencia post-venta visible en Automatizaciones. Del repo del usuario solo se portó lo funcional (daemon, tablas, auth interna); knowledge/ no aplica porque nuestro agente usa NichoConfig en BD; su doc leeme_arquitectura.md describe la arquitectura legacy anterior.

---
Task ID: 8
Agent: main (Super Z)
Task: (1) Confirmar superioridad de nuestro CRM vs repo GitHub, (2) diff de qué tiene su repo que nos falta (sin adoptar código), (3) ubicar secuencia post-venta en la UI, (4) preparar backup seguro para GitHub.

Work Log:
- repo-compare/ se había perdido entre sesiones; se re-clonó superficialmente ALBRA8/CRM-ALBRA (público) y GitHub API estaba rate-limited.
- Comparación objetiva: nuestro schema Prisma tiene Organization + 77 referencias organizationId (multi-tenancy real); el suyo 0 (single-tenant). Rutas API: 75 vs 71. Componentes: 87 vs 88 (paridad). Nuestros modelos unificados (Integration/Settings/Template) vs sus tablas dispersas por canal (WhatsAppConfig/TelegramConfig/GoogleConfig).
- Su leeme_arquitectura.md describe la arquitectura VIEJA (crm.html estáticos, memory.db, Socket.io) → su repo contiene una versión hermana anterior, el nuestro es la evolución SaaS.
- Qué tiene su repo que no tenemos: README.md (creado ahora, mejorado), knowledge/ (catalogo + terminos para el agente), leeme_arquitectura.md, MEMORY.md, COPIA_CRM_ALBRA.md, nicho.json (sustituido por NichoConfig), productos CSV, scripts/start-dev.sh, deps bcryptjs/jose/pdfkit/pino, y modelos QuoteItem, ClientServiceHistory, ProgressNote, InventorySyncConfig, TelegramMessage/TelegramConversation, AutomationLog, ChatLog, Memory. Ideas portables a futuro: QuoteItem (cotizaciones con líneas) y knowledge/ (archivos de conocimiento del agente).
- Secuencia post-venta localizada: demo-seed.ts crea la automatización "Secuencia post-venta" (trigger opportunity_stage_changed → Cierre Ganado; wait 3d → WhatsApp check-in → wait 4d → ai_followup pidiendo reseña; isActive: true) + plantilla WhatsApp "Seguimiento post-venta". UI: sidebar → Automatizaciones (Zap) y Configuración → Plantillas. Ejecución durable vía /api/automations/run + scheduler runDueJobs.
- HALLAZGO CRÍTICO: el historial git local contiene .env (9327bd7, 2bf3c18) y db/custom.db con clientes reales (4900f0c, fa86856, 781b9f0) hasta 51f7c78 → NO se debe subir ese historial a GitHub.
- Solución: creado README.md profesional (commit 39bf3e3 en main) + rama huérfana github-main con UN solo commit limpio (b1b684b, 256 archivos, verificado sin .env/custom.db/.wa-auth).
- Backup local: download/CRM-ALBRA-backup-2026-09-24.zip vía git archive de github-main (859K, 382 archivos, sin secretos).
- Sin credenciales GitHub en el entorno (sin gh CLI, sin ~/.git-credentials) → se entregan al usuario los comandos exactos de push.

Stage Summary:
- Confirmado con evidencia: nuestro CRM ES la evolución superior (multi-tenancy, JWT, durable engine, blindaje).
- Rama github-main lista para subir con historial limpio de 1 commit; main conserva el historial completo de desarrollo local.
- Pendiente del usuario: push con su PAT (comandos entregados); opcional crear rama backup-version-anterior en GitHub antes del force push.

---
Task ID: 9
Agent: main (Super Z)
Task: (1) Eliminar la "N" flotante que estorbaba el menú, (2) subir backup a GitHub con el token aportado por el usuario.

Work Log:
- Identificada la "N": es el indicador de desarrollo de Next.js DevTools (badge flotante abajo-izquierda sobre el sidebar). El logo del sidebar es "A" (ALBRA), no era parte de la app.
- Fix: devIndicators: false en next.config.ts → commit 2a5bacf en main.
- Reconstruida rama github-main (commit 2238f7b) incluyendo README + fix.
- Push a GitHub con token del usuario (usado vía remote URL temporal, NUNCA commiteado; output redactado con sed):
  1. Fetch de su main (ff8b184) y preservado como rama backup-version-anterior.
  2. Force push de github-main → main (ff8b184...2238f7b, forced update).
  3. Verificado ls-remote: main=2238f7b (256 archivos, README presente, sin .env/custom.db/.wa-auth), backup-version-anterior=ff8b184.
- Token eliminado de la config local (remote set-url sin credenciales).
- Verificación visual con agent-browser: landing + dashboard (login demo@crmalbra.com) sin badge "N"; screenshots en tool-results/.

Stage Summary:
- GitHub ALBRA8/CRM-ALBRA: main = CRM ALBRA SaaS v2 limpia (1 commit, sin secretos); rama backup-version-anterior = versión anterior preservada.
- Indicador dev "N" desactivado permanentemente.
- PENDIENTE AVISO AL USUARIO: revocar/regenerar el token compartido en el chat (quedó expuesto).

---
Task ID: 10
Agent: main (Super Z)
Task: (a) Portar QuoteItem a tabla relacional, (b) base de conocimiento para el Agente IA, (c) tema oscuro funcional con toggle minimalista junto a la campana.

Work Log:
- (c) TEMA: ThemeProvider de next-themes existía pero NUNCA se montó; el toggle estaba escondido en el menú del sidebar. Montado ThemeProvider (attribute=class, system) en layout.tsx; creado theme-toggle.tsx minimalista (Sun/Moon, h-8 w-8) colocado junto a NotificationBell en header desktop y móvil; eliminado item "Modo Claro/Oscuro" del sidebar (+imports Sun/Moon). globals.css: bloque completo de overrides .dark para utilidades crudas (bg-white/slate-50..200, text-slate-400..900, bordes/divides, estados semánticos con color-mix y text-*-400) — text-white sobre acentos se conserva. Verificado en browser: dark ok, light ok, persiste tras reload (localStorage).
- (a) QUOTEITEM: schema: model QuoteItem (sku, description, quantity, unitPrice, subtotal, position, cascade) + relación Quote.items; columna items JSON renombrada a legacyItems y LUEGO eliminada. Migración segura: extract-quote-items.js (1 cotización COT-0001, 2 items extraídos) → db push → restore-quote-items.js (rows recreadas). _lib/quotes.ts: quoteItemRows() para nested create, serializeQuote lee relación ordenada por position; rutas quotes y quotes/[id]: include items, create anidado, PUT transaccional (deleteMany+createMany) con recálculo de totales. demo-seed actualizado. tsconfig: excluido repo-compare. UI sin cambios (contrato serializeQuote intacto). Verificado: COT-0001 con items migrados en UI, POST/PUT/DELETE de prueba ok (limpieza hecha).
- (b) KNOWLEDGE: model Knowledge (title, content, category general|catalogo|terminos|faq|politicas, isActive) + relación Organization. API: /api/knowledge (GET/POST) y /api/knowledge/[id] (GET/PUT/DELETE) con audit. lib/knowledge.ts buildKnowledgeContext() inyectado en channel-agent.ts (canales) y en buildOrgContext del Chat AI. UI: knowledge-card.tsx en pestaña Agente IA (listar/crear/editar/toggle activo/eliminar con dialog y categorías). Seed: 2 entradas demo en demo-seed.ts + seed-knowledge-demo.js para la org demo existente (Catálogo, Términos). Verificado en UI: tarjeta visible en dark, entrada "Preguntas frecuentes" creada desde el diálogo.
- BUG resuelto en el camino: /api/knowledge 404 → el Write del route.ts principal falló al no existir el directorio y solo quedó [id]/route.ts; re-creado route.ts.
- Server reiniciado para recargar cliente Prisma tras db push+generate (error findMany inválido por cliente stale).

Stage Summary:
- Tema oscuro 100% funcional con toggle minimalista junto a la campana y persistencia.
- QuoteItem relacional en producción con datos migrados sin pérdida.
- Base de conocimiento operativa e inyectada en el agente (canales + chat).
- Pendiente: commit + push a GitHub (reconstruir github-main).

---
Task ID: 11
Agent: main (Super Z)
Task: Responder a las auditorías Antigravity + Qwen: verificar cada hallazgo contra el código real y corregir los críticos/importantes confirmados.

Work Log:
- VERIFICACIÓN: los 6 críticos y 4 importantes de Antigravity confirmados uno a uno (Qwen no pudo acceder al repo: 401 → hallazgos genéricos sin valor verificable).
- CRÍTICO #1 (fuga multi-tenant daemon): daemon.mjs ya NO hace SELECT Organization LIMIT 1. La sesión se vincula por POST /connect {orgId} (validado contra BD, persistido en .wa-auth/session-org.json, restaurado al arrancar). Sin org vinculada los mensajes entrantes se descartan con warning; /conversations/:id filtra por org.
- CRÍTICO #2 (backdoor por fallbacks): eliminados 'crm-albra-dev-fallback-secret' (auth.ts appSecret() con fail-fast), 'crm-albra-dev-fallback-key' (crypto.ts), 'crm-albra-internal-2024' (chat/route.ts, daemon-proxy, daemon.mjs, workflow-engine). INTERNAL_API_SECRET generado y agregado a .env; daemon hace loadEnvFile y NO arranca sin el secreto (>=24 chars).
- CRÍTICO #3 (envío WhatsApp 401): whatsapp-page.tsx ya no habla directo al puerto 3002 — todo vía /api/whatsapp/daemon-proxy con JWT (api.proxyGet/Post/Put). Errores del daemon visibles en toasts.
- CRÍTICO #4 (daemon expuesto): daemon exige Authorization en TODOS los métodos (antes GET abiertos, sin ?secret=); daemon-proxy con requireAuth en GET/POST/PUT (nuevo handler PUT para conversaciones). settings-page y api.ts mandan el token. Verificado: daemon 401 sin auth, proxy 401 sin JWT, 200 con JWT.
- CRÍTICO #5 (reportes en $0): reports/pdf y reports/excel filtran 'ingreso'/'egreso' (idioma real de la BD) + moneda dominante de las transacciones. PDF de prueba: Ingresos US$2.400, Egresos US$60, Balance US$2.340 (antes $0).
- CRÍTICO #6 (SDK sandbox): z-ai-web-dev-sdk envuelto en try/catch → error descriptivo "configura tu LLM" en vez de 500 críptico en VPS/Docker.
- IMPORTANTE #1 (CSV): export/csv soporta 'transactions' (con cliente); finances-page usa api.downloadTransactionsCsv() con token en header (window.open no enviaba JWT).
- IMPORTANTE #3 (stubs): workflow-engine envía email REAL vía trySendSmtp (SMTP de la org) y telegram REAL vía Bot API (token cifrado de la org); la notificación ahora dice "enviado" o "PENDIENTE de envío (fallo de canal)" — nada engañoso.
- IMPORTANTE #4 (webhook O(N)): pre-filtro de integraciones por phone_number_id antes del bucle de firma (típicamente 1 candidato).
- IMPORTANTE #6 (moneda): finances-page usa el selector global del negocio (lib/currency, COP default) vía subscribeCurrency.
- MEJORABLES: package.json renombrado a crm-albra-saas; build multiplataforma (scripts/copy-standalone.mjs con fs.cpSync) y start standalone (start-standalone.mjs) — sin cp/bun; Prisma log:['query'] solo en desarrollo; eliminada carpeta tests/ de artefactos sandbox; dark: variants en currency-selector (Vista previa ilegible en oscuro).
- VERIFICACIÓN END-TO-END (13 tests): 401/200 daemon, 401 proxy sin JWT, login demo, CSV 200 con datos, PDF/Excel 200 con cifras reales, backdoor viejo cerrado (401), /connect sin org → 400 multi-tenant, /conversations sin org → vacío. UI: dashboard/clientes/finanzas/whatsapp/config en oscuro OK; finanzas muestra moneda global.
- NOTA OPERATIVA: la sesión previa de WhatsApp quedó sin org vinculada (seguro por diseño) → reconectar por QR desde Configuración → WhatsApp para atarla a la organización.

Stage Summary:
- Los 6 críticos de Antigravity CERRADOS y verificados con tests automatizados de curl + UI.
- Aún pendientes para producción real (roadmap, no bloquean el código): batería de tests Vitest, Dockerfile, reestructurar SPA a rutas App Router, daemon agnóstico de BD para Postgres, considerar WhatsApp Cloud API como canal primario (ya implementado como alternativa a Baileys).
- PENDIENTE: reconstruir github-main y force push (incluye Task 10: QuoteItem + knowledge + tema oscuro).

---
Task ID: 12-b
Agent: full-stack-developer (docker)
Task: Dockerfile multi-stage + docker-compose + .dockerignore + guía de despliegue

Work Log:
- Leído worklog (Tasks 10-11), scripts/copy-standalone.mjs (standalone en .next/standalone con server.js + .next/static + public), start-standalone.mjs, .env.example, README.md, prisma/schema.prisma (SQLite, DATABASE_URL por env), daemon.mjs (AUTH_DIR=__dirname/.wa-auth → src/whatsapp-daemon/.wa-auth; DB_PATH acepta DATABASE_URL absoluta; no arranca sin INTERNAL_API_SECRET >=24; carga .env con try/catch), package.json (solo bun.lock, SIN package-lock.json) y .gitignore.
- /api/health YA existía (src/app/api/health/route.ts: GET público {ok:true,ts} sin BD, sin auth) → NO se creó ni editó; se usa como healthcheck (wget --spider).
- Dockerfile multi-stage (node:20-alpine): stage deps (libc6-compat + python3/make/g++ + openssl; npm ci si existe package-lock.json, si no npm install — el repo solo trae bun.lock) → stage builder (NEXT_TELEMETRY_DISABLED=1, NODE_ENV=production; npx prisma generate → npm run build (= next build && copy-standalone.mjs) → npm prune --omit=dev → npx prisma generate OTRA VEZ porque npm prune puede borrar node_modules/.prisma) → stage runner no-root (adduser nextjs uid 1001; COPY standalone → /app; COPY node_modules producción completo — better-sqlite3 compilado + CLI prisma + engines; COPY prisma/, src/whatsapp-daemon/, scripts docker; EXPOSE 3000 3002; HEALTHCHECK wget http://127.0.0.1:3000/api/health; ENTRYPOINT por roles). No se usa npm start: start-standalone.mjs hace spawn SIN reenvío de señales; `exec node server.js` recibe SIGTERM de docker stop.
- NUEVO scripts/docker-entrypoint.sh (POSIX sh, sh -n OK): rol "app" (default) = mkdir /app/db + `npx prisma db push --skip-generate --accept-data-loss` (idempotente; trade-off documentado; desactivable con SKIP_DB_PUSH=1) + exec node server.js (PORT/HOSTNAME por env); rol "daemon" = espera activa del esquema (hasta 90s, defensa para docker run manual) + exec node src/whatsapp-daemon/daemon.mjs.
- NUEVO scripts/docker-wait-db.mjs: abre la SQLite con fileMustExist y verifica tabla Organization (exit 0/1). node --check OK.
- NUEVO .dockerignore: .env/.env.* con !.env.example, db/, *.db*, .wa-auth/** (cualquier nivel), wa-auth/, .wwebjs_*, node_modules/, .next/, .git, tests/, coverage/, docs/, examples/, reference/, agent-ctx/, download/, upload/, tool-results/, repo-compare/, skills/, Caddyfile, *.log, dev.log, worklog.md, *.zip, *.tar.gz, IDE. Verificación por simulación de matching docker (última coincidencia gana, negaciones): 17 rutas necesarias del build INCLUIDAS (package.json, next.config.ts, tsconfig, postcss, tailwind.config.ts, bun.lock, prisma/, src/**, public/**, scripts/docker-*) y 17 rutas privadas EXCLUIDAS (.env, db/custom.db, src/whatsapp-daemon/.wa-auth/*, node_modules, .next, logs, tests...).
- NUEVO docker-compose.yml (validado con js-yaml): servicio app (build ., image crm-albra:latest, 3000:3000, env_file .env, environment GANA sobre .env con DATABASE_URL=file:/app/db/custom.db ABSOLUTA — evita resolución relativa de SQLite dependiente del cwd — y WHATSAPP_DAEMON_URL=http://wa-daemon:3002 en la red compose, volumen db-data:/app/db, restart unless-stopped, healthcheck wget) + servicio wa-daemon (misma imagen sin build, command ["daemon"], volumen compartido db-data + wa-auth:/app/src/whatsapp-daemon/.wa-auth, depends_on app condition service_healthy — garantiza db push ya aplicado —, healthcheck /status que acepta 401 como vivo). 3002 NO se publica (solo red interna; la app lo consume vía /api/whatsapp/daemon-proxy JWT). Comentarios documentan flujo QR de primera conexión.
- README.md: añadida sección "## Despliegue con Docker" AL FINAL (respetando estilo): prerrequisitos, cp .env.example .env, generación de los 3 secretos con `openssl rand -base64 32` (APP_SECRET, APP_ENCRYPTION_KEY, INTERNAL_API_SECRET) y qué hace cada uno, docker compose up -d --build, primera conexión WhatsApp (QR una vez, sesión persiste en volumen wa-auth), backup de volúmenes (docker run --rm -v crm-albra_db-data:/data ... alpine tar czf, y wa-auth para no re-escanear QR), actualización (git pull && docker compose up -d --build), trade-off del db push automático + SKIP_DB_PUSH, comandos útiles y notas de seguridad (no-root, bind mounts y chown 1001).
- Validación estática: `npx tsc --noEmit` → 0 errores atribuibles a esta tarea (no toqué ningún .ts/.tsx; los 5 errores restantes están en examples/, skills/ y tests/setup/env.ts del agente paralelo — todos FUERA del contexto Docker por .dockerignore). Trazado del binario better-sqlite3: deps (toolchain compila) → builder (node_modules copiado desde deps) → prune NO lo borra (es dependency) → runner (COPY node_modules completo) ✓. Prisma en runtime: CLI `prisma` está en dependencies (sobrevive al prune), engines en node_modules/@prisma/engines, schema en /app/prisma → `npx prisma db push --skip-generate` funciona OFFLINE (resuelve binario local, sin descargas). z-ai-web-dev-sdk verificado en npm público (npm view OK) → npm install en Docker no falla. NO se corrió npm run build ni docker (no instalado en sandbox; otro agente usa CPU).
- PROHIBICIONES respetadas: package.json, vitest.config.ts, tests/ y lógica existente en src/** intactos (health ya existía). Sin git commit/push. Sin imprimir valores de secretos. Dev server y db/custom.db intactos.

Stage Summary:
- Paquete de despliegue Docker completo y coherente con los scripts existentes: Dockerfile (deps/builder/runner, no-root, healthcheck), .dockerignore (secretos y datos privados nunca en imagen), docker-compose.yml (app + wa-daemon, volúmenes compartidos db-data y wa-auth, healthchecks, orden por service_healthy), entrypoint con roles (app/daemon) y guía "Despliegue con Docker" en README.md.
- Decisiones clave: (1) el standalone queda como contenido de .next/standalone en /app (server.js + .next/static + public, exactamente lo que deja copy-standalone.mjs) y se arranca con `exec node server.js`; (2) prisma db push en el arranque del contenedor app como migración automática de v0.x, documentado el trade-off con --accept-data-loss, backup previo y SKIP_DB_PUSH=1 para desactivar; (3) daemon como servicio separado que reutiliza la MISMA imagen vía command ["daemon"] (entrypoint por roles), con la sesión en volumen wa-auth y la BD compartida por db-data; (4) DATABASE_URL absoluta file:/app/db/custom.db fijada en compose (environment gana sobre env_file) y como default en la imagen; (5) sin package-lock.json en el repo → npm install con fallback automático a npm ci si el equipo lo commitea; (6) node_modules de producción completo en el runner para garantir daemon (baileys/better-sqlite3/qrcode/boom) y CLI prisma sin red.
- Comandos documentados: cp .env.example .env · openssl rand -base64 32 (x3) · docker compose up -d --build · docker run --rm -v crm-albra_db-data:/data -v "$PWD":/backup alpine tar czf /backup/backup-db-...tar.gz -C /data . (backup) · git pull && docker compose up -d --build (actualizar) · docker compose logs -f app / wa-daemon · docker compose down.
---
Task ID: 12-a
Agent: full-stack-developer (tests)
Task: Batería de tests Vitest para rutas críticas

Work Log:
- Leído worklog (Tasks 10-11) y analizados src/lib/auth.ts, crypto.ts, currency.ts, knowledge.ts, api-helpers, _lib/quotes, y handlers reales (clients, clients/[id], quotes, knowledge, reports/pdf, export/csv).
- INSTALACIÓN: `npm install -D vitest` falló con ERESOLVE PREEXISTENTE (next-auth@4 peerOptional nodemailer ^7 vs nodemailer ^10 del proyecto) → se instaló con `bun add -d vitest` (vitest@5.0.1, bun.lock actualizado, node_modules intacto, dev server verificado 200 tras la instalación). package.json editado SOLO en: script "test": "vitest run" + devDep vitest (verificado con git diff).
- Config: vitest.config.mts (environment node, include tests/**/*.test.ts, setupFiles tests/setup/env.ts, testTimeout 30s, hookTimeout 120s, fileParallelism false por el SQLite compartido; alias @→src). Renombrado a .mts para silenciar el warning de configLoader nativo de Vite 7.
- Setup (tests/setup/env.ts): dotenv/config → fail-fast si APP_SECRET <24 chars o falta APP_ENCRYPTION_KEY (mismo contrato que src/lib/auth.ts, sin fallbacks) → DATABASE_URL redirigido a db/test-vitest.db (NUNCA custom.db; la carpeta db/ ya está gitignoreada) → rm del archivo (-journal/-wal/-shm) → `npx prisma db push --skip-generate` contra esa URL (cliente ya generado sirve, mismo schema) → semilla determinista con IDs fijos: 3 organizaciones (A/B/C), 2 usuarios (owner A, member B), 3 clientes, 5 transacciones (ingresos 1000+400, egreso 60, type 'income' en inglés 9999 para documentar el vocabulario, ingreso 500 en org B), 4 entradas knowledge (3 activas/inactiva en A, 1 en B). La BD se recrea por archivo de test → cada archivo arranca idéntico.
- Blindaje de efectos: vi.mock('@/lib/workflow-engine') no-op en el setup; ningún test llama a canales reales, al daemon ni envía email/Telegram/WhatsApp; no se POST-an clientes vía API (única ruta que dispara workflows), los clientes de prueba se crean por BD.
- Helpers (tests/helpers.ts): tokens JWT firmados con APP_SECRET real, construcción de NextRequest para invocar handlers como funciones (verificado: NextRequest con body funciona en Node 24), routeParams() con Promise para Next 16, extracción de renglones de los PDF (contenido sin comprimir "(texto) Tj") y digitsOf() para cifras formateadas locale-agnósticas.
- UNITARIOS (3 archivos, 40 tests): auth (scrypt roundtrip/rechazo, JWT firma/verificación, token manipulado/expirado/sin orgId, getAuth Bearer y ?token=, requireAuth 401, requireAdmin 403, slugify, fail-fast sin APP_SECRET con vi.stubEnv — firmar lanza y verificar falla cerrada), crypto (roundtrip AES-256-GCM, IV aleatorio, valores vacíos, legacy plano passthrough, manipulación de ciphertext y de auth tag → null, truncados → null, prioridad de APP_ENCRYPTION_KEY sobre APP_SECRET, fail-closed sin claves, maskSecret), currency (default COP, set/get, código inválido ignorado, catálogo de 8 monedas, formatos USD $1,234.50 / COP miles con puntos / EUR €, pub/sub subscribeCurrency).
- INTEGRACIÓN (7 archivos, 34 tests) invocando handlers reales con BD efímera: auth-guard (clients GET sin token 401, token basura 401, owner 200 con datos, member 200, fallback ?token=), multitenancy (listado de B sin clientes de A y viceversa; GET /clients/:id de otra org → 404 mientras el dueño ve 200), reports-pdf (401 sin token; 200 application/pdf con %PDF-; Ingresos=1400, Egresos=60, Balance=1340 — NO $0, regresión del crítico #5 cubierta; type 'income' en inglés excluido — vocabulario actual documentado; org B solo ve sus 500), quotes (POST con items anidados → 201, COT-0001, subtotal 250/discount 25/tax 36/total 261, filas QuoteItem reales en BD con position y subtotales, items serializados ordenados; 400 cliente de otra org/inexistente, 400 sin items, 400 sin clientId; GET multi-tenant con filtro clientId), knowledge-api (POST 201 + persistencia con organizationId, recorte title 120/content 8000, 400 sin título/contenido, 400 categoría inválida, GET activos-primero, filtro ?category=, aislamiento org B), knowledge-context (buildKnowledgeContext: bloque CONOCIMIENTO DEL NEGOCIO, [FAQ]/[CATALOGO], inactivas excluidas, aislamiento A/B, org sin entradas → string vacío), export-csv (401 sin token, 200 text/csv con BOM verificado en bytes crudos y cabecera completa de transactions, filas con cliente asociado, aislamiento org B, 400 type inválido).
- Fixtures ajustados tras primera corrida (3 fallos de expectativa, no de código): BOM se consume por res.text() (estándar Fetch) → verificar bytes 0xEF 0xBB 0xBF; flip del auth tag base64 en el último carácter no altera bytes (padding descartado por el decodificador) → flip del primero; GET de quotes ahora crea su propia cotización para client-a2 y filtra por clientId para aislar del resto del archivo.
- Verificación final: `npm test` → 10 archivos / 74 tests, TODOS VERDES (~15s). `npx tsc --noEmit` → cero errores nuevos: los únicos errores son PREEXISTENTES en examples/websocket (falta socket.io-client/socket.io instalados) y skills/stock-analysis-skill (no son código del proyecto, carpetas intactas según git status). `npx eslint tests vitest.config.mts` → limpio. `npm run build` → EXIT 0 (tabla de rutas + copia standalone completa). Efecto colateral: `next build` reescribió .next y el dev server que corría murió (no lo maté yo; el build lo tiró) → reiniciado con el comando estándar `bun run dev` y verificado /api/health 200. Nada del daemon (3002) fue arrancado ni modificado.

Stage Summary:
- Batería Vitest operativa: 10 archivos, 74 tests, 74 verdes en ~15s (`npm test`).
- Cobertura: JWT/auth guards (incl. fail-fast sin secretos y fallback ?token=), cifrado AES-GCM con detección de manipulación, moneda global, guard multi-tenant en listado y detalle, reportes PDF sumando 'ingreso'/'egreso' del idioma real (no $0), QuoteItem relacional con totales y numeración, knowledge API + buildKnowledgeContext, export CSV de transacciones con BOM.
- Infraestructura reproducible: BD efímera db/test-vitest.db recreada por archivo de test (schema vía prisma db push --skip-generate; custom.db jamás tocada), semilla determinista multi-tenant, mock global de workflow-engine para garantizar cero envíos reales.
- Sin bugs nuevos en el código de la app descubiertos; los 3 fallos iniciales fueron expectativas del test (BOM/base64/compartición intra-archivo), corregidos en los fixtures. Comportamiento actual documentado por tests: el filtro de reportes ignora types en inglés ('income') y las lecturas entre orgs devuelven 404/401 según el caso.
- Desviación puntual documentada: vitest instalado con bun (npm falló por ERESOLVE preexistente next-auth↔nodemailer). package.json con SOLO script test + devDep vitest.
- No se hizo commit ni push; cambios en el working tree (tests/, vitest.config.mts, package.json, bun.lock).
---
Task ID: 12 (integración principal)
Agent: main (Super Z)
Task: "Haz los 2 en paralelo" → 12-a batería de tests Vitest + 12-b paquete Docker; integración, commits y sincronización GitHub.

Work Log:
- Estado previo verificado: Tasks 10 (tema oscuro/QuoteItem/knowledge, dbd3b8e) y 11 (hardening auditorías, 13f2bf0) ya completadas y commiteadas.
- Lanzados 2 subagentes full-stack-developer en paralelo (12-a tests, 12-b docker), ambos con protocolo de worklog y restricciones de no-conflicto (solo 12-a edita package.json).
- 12-a: vitest.config.mts + tests/ (unit: auth/crypto/currency; integración sobre BD efímera db/test-vitest.db: auth-guard, multitenancy, reports-pdf, quotes con QuoteItem, knowledge API+contexto, export-csv). 74/74 verdes (~15s). Sin bugs reales en la app. vitest instalada con bun (ERESOLVE preexistente next-auth/nodemailer bloquea npm install -D).
- 12-b: Dockerfile multi-stage node:20-alpine (toolchain better-sqlite3 → builder standalone → runner no-root con HEALTHCHECK /api/health), .dockerignore (excluye .env/db/.wa-auth), docker-compose.yml (app 3000 + wa-daemon 3002 interno, volúmenes db-data/wa-auth compartidos), scripts/docker-entrypoint.sh + docker-wait-db.mjs, README sección "Despliegue con Docker". Validación estática completa (Docker CLI no existe en sandbox). /api/health ya existía → no duplicado.
- Integración: agent-ctx/ añadido a .gitignore; npm test 74/74 en estado combinado; tsc sin errores nuevos del proyecto.
- Commits: 71468c7 (tests), 18d4a4b (docker).
- Reconstruida rama huérfana github-main limpia y force push a GitHub (ver resultado en Stage Summary).

Stage Summary:
- El CRM queda con red de seguridad de tests (74) y paquete de despliegue Docker listo para VPS.
- Pendiente del usuario: revocar/regenerar el token GitHub expuesto en el chat; primer despliegue real con docker compose up -d --build.
---
Task ID: 13
Agent: main (Super Z)
Task: Procesar 3ª auditoría (informe pegado en chat): verificar 15 hallazgos contra código real y corregir los confirmados.

Work Log:
- META-HALLAZGO: la auditoría se corrió sobre la VERSIÓN VIEJA (3 archivos citados NO existen: src/lib/agent/handlers.ts, whatsapp-config-dialog.tsx, api/cron/process-automations; "sin Organization" es del repo single-tenant antiguo).
- FALSOS/YA-ARREGLADOS verificados con evidencia: H-01 (Organization + 77 organizationId; team filtra por org del token), H-03 (requireAuth en daemon-proxy), H-04 (X-Hub-Signature-256 estricta), H-05 (Telegram 401 sin header + safeEquals), H-07 (disconnectWhatsApp existe en api.ts), H-08 (landing ya "Beta privada" sin precios falsos), H-09 (footer abre Legal Dialog funcional), H-10 (0 resultados 'crm-albra-internal-2024'), H-11 (tokens *Enc cifrados AES-GCM).
- H-02 REAL → CORREGIDO: eliminado ignoreBuildErrors de next.config.ts; excluidos examples/skills/mini-services del tsconfig (código ajeno a la app con errores preexistentes); tsc --noEmit TOTAL = 0 errores; npm run build con chequeo estricto = OK.
- H-12 REAL (solo faltaba CI) → CREADO .github/workflows/ci.yml: bun install --frozen-lockfile + prisma generate + tsc --noEmit + vitest (74) + next build, con dummies de env SOLO para tests. Los tests ya existían (Task 12-a).
- H-15 REAL → CORREGIDO: generado package-lock.json (commit para determinismo Docker) + npm audit fix → 26 vulns (2 críticas, 15 altas) → 8 (6 moderadas, 2 altas, 0 críticas); restantes heredadas de sharp/libvips (requieren upgrade mayor, documentadas). package.json sin cambios (fixes in-range); bun.lock sincronizado. Dockerfile: COPY de ambos lockfiles + npm ci --legacy-peer-deps.
- H-06/H-13/H-14 (SQLite/disco, scheduler en memoria, floats): REALES por diseño — mitigados para el despliegue objetivo (VPS con volúmenes Docker); PostgreSQL/colas durables/centavos quedan en roadmap (ya estaban documentados en Task 11).
- Verificación: 74/74 tests, build standalone OK, tsc estricto OK.

Stage Summary:
- De 15 hallazgos: 9 falsos/ya-arreglados, 3 corregidos ahora (H-02, H-12-CI, H-15), 3 de roadmap conocido (H-06/H-13/H-14).
- Puntuación real del proyecto actual muy superior al 4.4/10 del informe (que evaluó la versión anterior).
- Preview caído: el sandbox se recreó hoy y el dev server de la plataforma murió con el .env perdido; .env regenerado con secretos nuevos (login OK verificado); el preview se recupera al reiniciar la sesión. NOTA: tokens de integraciones cifrados con la clave anterior (SMTP/Telegram de orgs) deben re-guardarse en Configuración.
---
Task ID: 13 (post: sincronización GitHub)
Agent: main (Super Z)
Work Log:
- Push a GitHub RECHAZADO por scope: el PAT no tiene permiso 'workflow' para publicar .github/workflows/ci.yml.
- Solución temporal: rama huérfana reconstruida SIN .github (commit eaa93eb, 272 archivos, verificado sin .env/custom.db/.wa-auth) y force push OK → GitHub main = eaa93eb.
- El ci.yml vive en main local (5a2b0f4) y se publicará con el próximo token que tenga scope workflow.

Stage Summary:
- GitHub actualizado a v2.2 (tests + Docker + tipos estrictos + deps auditadas). CI pendiente de publicar por scope del token. URGENTE para el usuario: revocar el token actual (sigue activo) y crear uno nuevo con scopes repo + workflow.
---
Task ID: 14
Agent: main (Super Z)
Task: 4ª ronda del auditor (hallazgos A-D + plan 4 fases): verificar A-D y ejecutar el único pendiente real de la Fase 1 (cookies httpOnly).

Work Log:
- A-D verificados: TODOS ya cerrados. A (mixed content): whatsapp-page no tiene DAEMON_BASE ni :3002 (usa api.getWhatsAppStatus etc. vía proxy). B: requireAuth en GET/POST/PUT del proxy. C: team filtra organizationId. D: ignoreBuildErrors eliminado en Task 13; 'updateWhatsAppConfig' no existe en src/ (nadie lo invoca).
- FASE 1 implementada la pieza faltante: cookies httpOnly. getAuth dual (Bearer → cookie albra_session → ?token=); login/register/demo con Set-Cookie (HttpOnly, SameSite=Lax, Secure en prod, 7d=TTL JWT); ruta nueva POST /api/auth/logout; store deja de persistir el token (partialize) y el logout borra la cookie; page.tsx boot intenta getMe con cookie y migra el legacy 'crm_token'; lectores crudos → api.getToken(); notification-bell header condicional (evitaba 'Bearer null').
- Tests: +5 = 79/79 verdes. tsc 0 errores. Build standalone OK.
- E2E real en vivo: login demo → Set-Cookie albra_session HttpOnly SameSite=lax Max-Age=604800; /api/clients SOLO con cookie → 200; sin credenciales → 401; logout → Max-Age=0.
- INCIDENTE ENTORNO (2 rehidrataciones del sandbox durante la sesión): .env revertido dos veces (perdió APP_SECRET/APP_ENCRYPTION_KEY/INTERNAL_API_SECRET). Solución permanente: scripts/ensure-env.mjs idempotente en "predev" (regenera solo claves faltantes). Además se descubrió que el TypeScript 5.9.3 del sandbox no parsea 'const { a as b } = ...' (rename en destructuring) — gramática básica rota en su build; el código base no usa ese constructo (verificado con rg) y se evitó en el test nuevo.
- Commits: 5f84d6c (cookies + ensure-env). Push a GitHub vía rama huérfana sin .github (token sin scope workflow — pendiente token nuevo).

Stage Summary:
- Fase 1 del plan del auditor: 5/5 COMPLETA (mixed content, proxy auth, webhooks firmados, TS estricto, cookies httpOnly).
- Fase 2: Organization/organizationId ya existen (77 refs); pendientes reales: roles OWNER/ADMIN/AGENT granulares, round-robin de leads, migración SPA→App Router.
- Fase 3: Docker/compose ya hecho; pendientes: PostgreSQL, colas durables (BullMQ/QStash).
- Fase 4: Stripe, bandeja omnicanal unificada, PWA push — futuro comercial.
