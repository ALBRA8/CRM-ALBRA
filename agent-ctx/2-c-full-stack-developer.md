# Task ID: 2-c — full-stack-developer (frontend, features Twenty CRM)

## Task
Implementar las funcionalidades nuevas del plan aprobado en el frontend de CRM ALBRA: (A) Timeline unificado en ClientDetail, (B) Vistas guardadas en ClientsList y PipelineView, (C) Constructor de workflows en Automations, (D) Acciones del agente IA en ChatPage. Consumiendo la API pactada que el backend (2-b) construye en paralelo.

## Work Log (resumen ejecutivo)
- **Archivos NUEVOS:**
  - `src/lib/filters.ts` — helpers de filtrado en cliente (operadores `equals|contains|gt|lt|in|not_empty`, rutas con puntos tipo `client.name`, comparación numérica/lexicográfica) + labels amables en español + cliente HTTP para vistas guardadas (Bearer token de `localStorage('crm_token')`, mismas convenciones que api.ts).
  - `src/components/clients/client-timeline.tsx` — Feature A: feed `GET /api/timeline?clientId=&limit=50`, agrupado Hoy/Ayer/fecha, icono por tipo de evento, color por source (agent=violeta, automation=ámbar, integration=sky, manual=slate), input rápido "Añadir nota" vía `api.addClientHistory`, skeletons y estado vacío.
  - `src/components/clients/saved-views-bar.tsx` — Feature B: barra de vistas estilo Twenty (chips con Bookmark, compartidas con Users, X para eliminar, "Guardar vista actual" con dialog nombre+Switch compartir), badges de filtros activos con X individual.
- **Archivos EDITADOS:**
  - `clients-list.tsx` — barra de vistas sobre la tabla; vista activa → fetch `limit=500` + `applyFilters` en cliente; badges removibles; empty state consciente de vistas.
  - `client-detail.tsx` — nuevo tab "Timeline" con `ClientTimeline`; fixes de tipos preexistentes (cast updateClientPreferences, style ringColor inválido).
  - `pipeline-view.tsx` — vistas guardadas para oportunidades (monto/título/interés/probabilidad/client.name); totales del header y contadores por columna recalculados con lo filtrado.
  - `automation-form-dialog.tsx` — reconstruido en 3 secciones ("Cuando ocurra…" triggerType+intervalMinutes, "Y se cumple…" condiciones dinámicas, "Entonces…" acciones: notify_admin / send_whatsapp / send_telegram / send_email con plantillas o texto {{variables}} / create_opportunity / update_client_status / ai_followup). Guarda triggerType/triggerConfig/conditions/actions como JSON strings. Parseo legacy compatible (sin triggerType→Manual). Exporta `triggerTypeLabels`.
  - `automations-page.tsx` — badges triggerType/"Ejecutada N veces"/condiciones/acciones; botón "Ejecutar pendientes ahora" → `api.runAutomations()` con soporte `{ processed }` y fallback legacy.
  - `chat-page.tsx` — respuesta `{ reply, actions }`: chips/cards violeta con icono por tipo de acción + toast. Import de sonner añadido.
- **Corrección de entorno (importante para otros agentes):** el dev server del sistema murió con `TurbopackInternalError: OS file watch limit reached` (inotify max_user_watches=8192). Fix: `/reference` agregado a `.gitignore` y el dump del repo Twenty (570MB) fue **movido** (no borrado) a `/home/z/reference-twenty`. `.next` limpiado y `bun run dev` relanzado en background (log: `dev.out.log`).

## Estado de verificación
- `eslint` sobre los archivos del alcance: **0 errores, 0 warnings**.
- `tsc --noEmit`: sin errores en `src/lib/filters.ts` ni en `src/components/{clients,opportunities,automations,chat}`. Los errores restantes viven en `src/app/api/**` (backend 2-b en curso) y en artefactos preexistentes (`crm_albra_mirrored/`).
- `GET /` → 200 (compila toda la SPA). `/api/timeline` y `/api/saved-views` ya responden 401 sin sesión (existen); `/api/auth/demo` → 500 (territorio del backend, en progreso).

## Stage Summary
- Features A–D implementadas y compilando end-to-end; paleta emerald/slate respetada (violeta/ámbar/sky solo semánticos de source), todo en español, mobile-first, accesible (aria-labels, roles, teclado en chips).
- Para QA visual cuando 2-b termine: crear/aplicar vistas guardadas reales, eventos de timeline desde mutaciones (`auditAndTimeline`) y `actions` del chat desde el agente.
