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

## Despliegue con Docker

La imagen es multi-stage (`Dockerfile`): compila el standalone de Next, el módulo nativo `better-sqlite3` y el cliente Prisma; el resultado corre como usuario no-root con la BD y la sesión de WhatsApp en volúmenes. `docker-compose.yml` levanta dos servicios:

- **app** — servidor Next.js en el puerto `3000` (público)
- **wa-daemon** — daemon de WhatsApp/Baileys en `3002` (**solo interno**: la app habla con él vía `/api/whatsapp/daemon-proxy` con JWT; no publiques ese puerto)

### Prerrequisitos

- Docker Engine 24+ con Compose v2 (`docker compose version`)
- Git

### 1. Configurar el entorno

```bash
git clone https://github.com/ALBRA8/CRM-ALBRA.git crm-albra
cd crm-albra
cp .env.example .env
```

Genera los **3 secretos obligatorios** y pégalos en `.env` (uno por variable):

```bash
openssl rand -base64 32   # → APP_SECRET          (firma de tokens JWT de sesión)
openssl rand -base64 32   # → APP_ENCRYPTION_KEY  (cifrado de credenciales por organización)
openssl rand -base64 32   # → INTERNAL_API_SECRET (auth mutua app ↔ daemon; mínimo 24 caracteres)
```

Opcionales: `SMTP_*` (correos transaccionales y automatizaciones) y `WHATSAPP_VERIFY_TOKEN` (webhook de WhatsApp Cloud API).

> En Docker **no** edites `DATABASE_URL` ni `WHATSAPP_DAEMON_URL` del `.env`: Compose los fija (`file:/app/db/custom.db` y `http://wa-daemon:3002`) para que apunten al volumen y a la red interna.

### 2. Levantar

```bash
docker compose up -d --build
```

Al arrancar, el servicio `app` sincroniza el esquema (`prisma db push`) y sirve en `http://localhost:3000`. En un VPS, abre `http://IP-DEL-SERVIDOR:3000`.

### 3. Primera conexión de WhatsApp (QR)

1. Entra a la app y crea tu organización (registro).
2. Ve a **Configuración → WhatsApp → Conectar**.
3. Escanea el QR **una sola vez** desde el teléfono: WhatsApp → Dispositivos vinculados.
4. La sesión queda en el volumen `wa-auth`: los reinicios **no** piden QR de nuevo (solo si cierras sesión desde el teléfono o borras el volumen).

### 4. Backup del volumen de datos

```bash
docker volume ls   # los nombres llevan el prefijo de la carpeta del proyecto (crm-albra_*)

# Base de datos
docker run --rm -v crm-albra_db-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/backup-db-$(date +%Y%m%d-%H%M).tar.gz -C /data .

# Sesión de WhatsApp (evita re-escanear el QR tras restaurar)
docker run --rm -v crm-albra_wa-auth:/data -v "$PWD":/backup alpine \
  tar czf /backup/backup-wa-auth-$(date +%Y%m%d-%H%M).tar.gz -C /data .
```

Restaurar: descomprime el tar dentro del volumen (mismo comando con `tar xzf`) y reinicia con `docker compose restart`. La app también incluye respaldo integrado en **Configuración → Respaldo**.

### 5. Actualizar

```bash
git pull
docker compose up -d --build
```

En cada arranque, `app` ejecuta `prisma db push --skip-generate --accept-data-loss`: el esquema de `prisma/schema.prisma` se aplica sobre tu SQLite (idempotente; no-op si ya está en sync). **Trade-off:** en v0.x esto actúa como migración automática y los cambios destructivos (renombrar/borrar columnas) se aplican igual → **haz backup del volumen antes de actualizar**. Para desactivarlo, descomenta `SKIP_DB_PUSH=1` en `docker-compose.yml` y aplica el esquema a mano:

```bash
docker compose exec app npx prisma db push
```

### Comandos útiles

```bash
docker compose logs -f app         # logs del servidor
docker compose logs -f wa-daemon   # logs del daemon de WhatsApp (QR de diagnóstico)
docker compose ps                  # estado y healthchecks
docker compose down                # detiene contenedores (los volúmenes persisten)
```

### Notas de seguridad

- `.env`, las BD (`db/*.db*`) y la sesión `.wa-auth/` **nunca entran en la imagen** (bloqueados en `.dockerignore`); viven en los volúmenes `db-data` y `wa-auth`.
- El contenedor corre como usuario no-root (`nextjs`, uid 1001). Con bind mounts en lugar de volúmenes nombrados, ajusta la propiedad: `chown -R 1001:1001 db/`.
- `INTERNAL_API_SECRET` es compartido por ambos servicios desde el mismo `.env`; sin él el daemon se niega a arrancar.
