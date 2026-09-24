# CRM ALBRA

CRM agéntico con integraciones de **WhatsApp**, **Telegram** y **Google Workspace**, construido con Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui y Prisma sobre SQLite.

## Módulos principales

- Dashboard con métricas en tiempo real
- Clientes, Oportunidades (pipeline Kanban), Productos/Servicios e Inventario
- Calendario con reservas y sincronización Google Calendar
- Cotizaciones con exportación a PDF
- WhatsApp con conexión por QR (daemon propio, puerto 3002) y auto-respuestas con IA
- Telegram (webhook + envío de mensajes)
- Automatizaciones con ejecución programada (cron)
- Chat AI con agente de 11 herramientas
- Finanzas (ingresos/gastos/transacciones)
- Reportes exportables a PDF, Excel y CSV; Backup JSON completo
- Equipo, permisos por rol, actividad, notificaciones
- Configuración con 11 pestañas (incluye plantillas, campos personalizados, multi-moneda)
- Búsqueda global con Cmd+K
- Seguridad: Bearer tokens, rate limiting, HMAC en webhooks

## Requisitos

- Node.js 20 o superior (también funciona con Bun)
- npm 10+ (o bun)

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Revisar variables de entorno
#    El archivo .env ya viene incluido y funcional para desarrollo local.
#    DATABASE_URL apunta a db/custom.db (incluida, con esquema y datos de ejemplo).
#    En producción cambia NEXTAUTH_SECRET y configura SMTP si lo necesitas.

# 3. Generar el cliente de Prisma
npm run db:generate

# 4. (Opcional) Empezar con base de datos vacía:
#    borra db/custom.db (y sus archivos -wal/-shm si existen) y ejecuta:
npm run db:push

# 5. Levantar en desarrollo
npm run dev
# → http://localhost:3000
```

> La base de datos `db/custom.db` incluida ya contiene el esquema aplicado y datos de ejemplo. El primer arranque ejecuta el seed automáticamente si está vacía.

## Daemon de WhatsApp (opcional)

El módulo de WhatsApp usa un proceso independiente basado en Baileys:

```bash
node src/whatsapp-daemon/daemon.mjs
# API:    http://localhost:3002/status
# QR:     http://localhost:3002/qr
```

Escanea el QR desde la pantalla **WhatsApp** del CRM o desde la terminal. El servidor Next.js redirige automáticamente las rutas `/api/whatsapp/daemon/*` al puerto 3002.

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo en puerto 3000 |
| `npm run build` | Build de producción (output standalone) |
| `npm run start:prod` | Servir el build de producción con Node |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generar cliente Prisma |
| `npm run db:push` | Sincronizar esquema con la base de datos |
| `./scripts/start-dev.sh` | Reinicio limpio del servidor dev (proceso desacoplado) |

## Producción

```bash
npm run build
npm run start:prod
# Respeta las rutas de NEXTAUTH_URL / APP_URL en .env
```

## Estructura del proyecto

```
├── src/
│   ├── app/              # App Router: páginas y +60 endpoints de API
│   ├── components/       # UI (shadcn/ui) y páginas por módulo
│   ├── lib/              # db, auth, agente IA, permisos, utilidades
│   ├── hooks/            # Hooks de React
│   └── whatsapp-daemon/  # Daemon de WhatsApp (Baileys, puerto 3002)
├── prisma/
│   └── schema.prisma     # Esquema completo de la base de datos
├── db/
│   └── custom.db         # Base de datos SQLite (con datos de ejemplo)
├── public/               # Logo, manifest, robots
├── scripts/
│   └── start-dev.sh      # Arranque persistente del servidor dev
├── nicho.json            # Configuración de branding/nicho del agente
└── next.config.ts        # Config de Next (standalone, rewrites del daemon)
```

## Notas de seguridad

- Las credenciales por defecto en `.env` son solo para desarrollo local.
- Los secretos internos (`INTERNAL_API_SECRET`, `INTERNAL_CHAT_SECRET`) protegen la comunicación servidor-daemon y los webhooks.
- Configura SMTP en `.env` para habilitar el envío de correos.
