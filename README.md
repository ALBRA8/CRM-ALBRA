# CRM ALBRA — Inteligencia Comercial que Trabaja por Ti

CRM SaaS multi-tenant con agente de IA, construido con **Next.js 16 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS 4**, **shadcn/ui** y **Prisma sobre SQLite**. Evolución del CRM base de ALBRA GROUP: ahora con organizaciones aisladas (multi-tenancy), autenticación JWT, motor de automatizaciones con ejecución durable y WhatsApp real vía daemon Baileys.

## Módulos principales

- **Dashboard** con métricas del negocio y actividad reciente
- **Clientes** con timeline unificado (WhatsApp, llamadas, notas, cotizaciones) y preferencias
- **Oportunidades** con pipeline Kanban de 6 etapas (drag & drop, etapas ganadas/perdidas)
- **Productos / Servicios** con inventario y categorías
- **Calendario** con reservas y integración Google Calendar
- **Cotizaciones** con numeración automática y timeline
- **WhatsApp real** — conexión por QR (daemon Baileys propio, puerto 3002), envío/recepción, auto-respuestas con IA y secuencias con pausas durables
- **Automatizaciones** — motor trigger → condiciones → acciones con ejecución programada (`/api/cron/run`), incluye la secuencia post-venta (check-in día 3 + IA pidiendo reseña día 7)
- **Chat AI** — agente con herramientas (crear clientes, oportunidades, tareas, consultar datos)
- **Instagram y Telegram** — canales adicionales por webhook
- **Finanzas** — ingresos, gastos y transacciones por mes
- **Reportes** — exportables a PDF, Excel y CSV
- **Equipo** — usuarios por organización con roles y permisos
- **Actividad** — log de auditoría de toda la organización
- **Configuración con 12 pestañas** — Negocio, Agente IA, Google, WhatsApp, Instagram, Telegram, Email SMTP, Inventario, Plantillas, Campos personalizados, Equipo y Respaldo
- **Búsqueda global** y notificaciones push (web-push)
- **Seguridad** — Bearer JWT, rate limiting, HMAC en webhooks, cifrado de credenciales por organización

## Multi-tenancy

Cada organización tiene sus propios clientes, oportunidades, automatizaciones, plantillas y configuraciones (modelo `Organization` + `organizationId` en toda la capa de datos). El agente IA y los canales se configuran por organización.

## Requisitos

- Node.js 20 o superior (también funciona con Bun)
- npm 10+ (o bun)

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
#    Edita .env con tus valores reales (APP_SECRET, APP_ENCRYPTION_KEY, etc.)

# 3. Base de datos
npx prisma db push

# 4. Desarrollo
npm run dev          # http://localhost:3000

# 5. WhatsApp (opcional, en otra terminal)
node src/whatsapp-daemon/daemon.mjs    # http://localhost:3002 (QR por consola)
```

## Variables de entorno

Ver [.env.example](./.env.example) — incluye `DATABASE_URL`, `APP_SECRET`, `APP_ENCRYPTION_KEY`, SMTP y `WHATSAPP_DAEMON_URL`. **Nunca subas tu `.env` real ni tu base de datos al repositorio** (ya están excluidos en `.gitignore`).

## Datos privados (no versionados)

- `.env` — claves y secretos
- `db/*.db` — base de datos real con tus clientes
- `src/whatsapp-daemon/.wa-auth/` — sesión de WhatsApp (si se filtra, te roban el número)
- `upload/`, `tool-results/`, `repo-compare/` — archivos locales de trabajo
