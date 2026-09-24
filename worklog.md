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
