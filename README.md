# CRM ALBRA — Inteligencia Comercial que Trabaja por Ti

CRM SaaS multi-tenant **host-agnostic** (CHALECO CRM): construido con **Next.js 16 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS 4**, **shadcn/ui** y **Prisma sobre SQLite**. Evolución del CRM base de ALBRA GROUP: organizaciones aisladas (multi-tenancy), autenticación JWT, motor de automatizaciones con ejecución durable y WhatsApp real vía daemon Baileys.

> **El CRM ya no depende de un agente propietario.** El antiguo agente de chat fue eliminado: la inteligencia que opera el CRM la aporta un **host externo** (un agente general, un servicio o un proceso) a través de contratos formales — REST `/api/crm/actions`, servidor MCP `/api/mcp` y contrato de memoria MemoryDV. Ver [docs/HARNESS.md](./docs/HARNESS.md).

> ⚠️ **Aviso Importante — Canal no oficial de WhatsApp**: el daemon de WhatsApp (`src/whatsapp-daemon/daemon.mjs`) conecta por **Baileys**, un canal **no oficial** basado en emulación de WhatsApp Web. Su uso conlleva **riesgo inherente de bloqueo o suspensión del número por parte de Meta**. Se recomienda **calentar líneas** (envíos graduales y pacing) y usar **números secundarios**, nunca el número principal del negocio. Para producción comercial, migra el transporte a **Meta WhatsApp Cloud API** (los adaptadores por organización ya existen).

## Módulos principales

- **Dashboard** con métricas del negocio y actividad reciente
- **Clientes** con timeline unificado (WhatsApp, llamadas, notas, cotizaciones) y preferencias
- **Oportunidades** con pipeline Kanban de 6 etapas (drag & drop, etapas ganadas/perdidas)
- **Productos / Servicios** con inventario y categorías
- **Calendario** con reservas y integración Google Calendar
- **Cotizaciones** con numeración automática y timeline
- **WhatsApp real** — conexión por QR (daemon Baileys propio, puerto 3002), envío/recepción, auto-respuesta IA de canal (con handoff a humano y kill-switch) y secuencias con pausas durables
- **Automatizaciones** — motor trigger → condiciones → acciones con ejecución programada (`/api/cron/run`), incluye la secuencia post-venta (check-in día 3 + IA pidiendo reseña día 7)
- **Contratos para hosts** — REST `/api/crm/actions` (acciones de negocio con RBAC) y servidor MCP (`/api/mcp`) con API keys por organización
- **Instagram y Telegram** — canales adicionales por webhook
- **Finanzas** — ingresos, gastos y transacciones por mes
- **Reportes** — exportables a PDF, Excel y CSV
- **Equipo** — usuarios por organización con roles y permisos
- **Actividad** — log de auditoría de toda la organización
- **Configuración con 12 pestañas** — Negocio, IA del CRM, Google, WhatsApp, Instagram, Telegram, Email SMTP, Inventario, Plantillas, Campos personalizados, Equipo y Respaldo
- **Búsqueda global** y notificaciones push (web-push)
- **Seguridad** — Bearer JWT, API keys con hash SHA-256 para hosts, RBAC granular server-side, rate limiting, HMAC en webhooks, cifrado de credenciales por organización

## Chaleco CRM (consumo por hosts)

El CRM expone tres contratos formales para que un host externo lo opere sin conocer su código:

| Contrato | Ruta | Auth | Uso |
|----------|------|------|-----|
| Acciones de negocio | `POST /api/crm/actions` | JWT de usuario o `Authorization: Bearer albra_…` | `create_client`, `create_opportunity`, `schedule_reservation`, `add_note`, `quote_summary`, `list_recent_clients` |
| Servidor MCP | `POST /api/mcp` | API key `albra_…` | 16 tools MCP (`list_clients`, `send_whatsapp`, `get_dashboard_stats`, …) |
| Memoria canónica | `GET /api/memory` + `memory-contract.ts` | JWT | Contrato MemoryDV para consumidores externos |

Detalle completo de capacidades, permisos, estados, errores y operaciones destructivas: **[docs/HARNESS.md](./docs/HARNESS.md)**.

## Operación (runbook único)

Arranque, supervisor, outbox, backups con drill, actualización y emergencias:
**[docs/RUNBOOK-CRM.md](./docs/RUNBOOK-CRM.md)**. Actualización sin Docker:
`./scripts/instalar-crm.sh --actualizar` (idempotente, respalda antes de tocar).

## Contratos (fuente única de verdad)

El inventario completo de endpoints de la API — método, autenticación, org-scoping y archivo que
implementa cada ruta — vive en **[docs/CONTRATOS-ECOSISTEMA.md](./docs/CONTRATOS-ECOSISTEMA.md)**.
Complementos: `docs/API_CONTRACT.md` (convenciones), `docs/INTEGRATION_CONTRACT.md` (cross-repo
HMAC v2) y `docs/CONTRATO-WHATSAPP-ORG.md` (daemon Baileys multi-org).

## Multi-tenancy

Cada organización tiene sus propios clientes, oportunidades, automatizaciones, plantillas y configuraciones (modelo `Organization` + `organizationId` en toda la capa de datos). La IA del CRM (auto-respuesta de canales, sugerencias) y los hosts se configuran por organización.

## Ecosistema: acceso directo desde el CRM (2A y 2B)

El botón **Ecosistema** del sidebar (visible en cualquier sesión autenticada, incluida la demo) abre
**WhatsPower** (capa 2A, Flow Studio) y **WhatsPower-Ultra** (capa 2B, campañas y difusión) con
sesión de operador, sin repetir credenciales: el CRM emite un enlace firmado de UN SOLO USO
(`ECOSYSTEM_SSO_SECRET` compartido por los tres servicios, HMAC-SHA256, TTL 90 s) y cada capa lo
canjea en `GET /studio/login-ecosystem` (302 con cookie HttpOnly). Sin el secreto o la URL del
servicio configurados, el acceso se muestra deshabilitado (fail-closed: jamás se emite un token
que nadie puede canjear). Pruebas: `tests/integration/ecosystem-links.test.ts`.

### Arranque del ecosistema completo en Windows
`INICIAR_ECOSISTEMA.bat` arranca en orden daemon 3002 → CRM 3000 → WhatsPower 3003 →
WhatsPower-Ultra 3004, ESPERA la salud de cada capa (max ~60 s) y abre el navegador solo cuando
todo responde; si una capa falla, lo dice en pantalla (los logs quedan en la ventana de cada
capa: nunca se redirigen a archivos dentro de las subcarpetas, que en Windows pueden dar
"Acceso denegado" por ACL). `DIAGNOSTICO_ECOSISTEMA.bat` imprime puertos, códigos HTTP y el
estado de `ECOSYSTEM_SSO_SECRET`/URLs de los tres `.env` (jamás imprime el valor del secreto).

Ambos viven en esta carpeta y localizan las capas 2A/2B como carpetas **hermanas** (un nivel
arriba); si se copian a la raíz del ecosistema se detecta sola. El `INICIAR_ECOSISTEMA.bat` de la
raíz del ecosistema solo delega en este, para no mantener dos versiones. El CRM arranca con el
build standalone (`.next/standalone`) y, si no existe, avisa y cae a `next dev`.

### Cookie de sesión y apertura por IP de red (SESSION_COOKIE_SECURE)
La cookie `albra_session` es HttpOnly + SameSite=Lax con Secure SOLO en producción. Con
`http://localhost` los navegadores la aceptan; si el CRM se abre por IP de red LAN sin HTTPS
la cookie NO se guarda y "la demo no entra". El escape `SESSION_COOKIE_SECURE=false` en `.env`
(decisión EXPLÍCITA del dueño, jamás por defecto) omite Secure para ese caso; nunca usarlo con
el servidor expuesto a internet. Pruebas: `tests/unit/session-cookie-flags.test.ts`.

## Requisitos

- **Node.js 22** — es el runtime de producción y el único soportado: `.nvmrc` fija `22.14.0`, `engines` exige `>=22.12.0` y las imágenes Docker usan `node:22-alpine`. Con nvm basta `nvm use` (lee `.nvmrc`).
- npm 10+ (o bun)

> **better-sqlite3 y Node 24:** better-sqlite3 es un módulo nativo compilado contra la ABI de la versión de Node con la que se instalaron las dependencias (`NODE_MODULE_VERSION` 115 en Node 22 vs 137 en Node 24). Si corres el proyecto con Node 24 y obtienes el error "was compiled against a different Node.js version", ejecuta `npm rebuild better-sqlite3` (o reinstala dependencias con tu Node activo). Recomendación: mantén Node 22 en desarrollo y producción para no tener que recompilar entre versiones.

## Instalar en Windows (Build Tools de Visual Studio)

`better-sqlite3` intenta primero descargar un **binario precompilado**. Cuando no hay uno para tu combinación exacta de versión de Node y sistema operativo (por ejemplo Node 24 recién salido, o si la descarga falla tras un proxy), npm **compila el módulo nativo** con `node-gyp`, y en Windows eso exige las herramientas de compilación de Visual Studio. Si la instalación falla con errores tipo `gyp ERR! find VS` o `MSBuild` no encontrado:

1. Instala **Visual Studio 2022 Build Tools** (gratuito): [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/) → sección *Tools for Visual Studio* → *Build Tools for Visual Studio 2022*.
2. En el instalador, marca el workload **"Desarrollo para escritorio con C++"** (incluye MSVC, Windows SDK y las opciones de CMake que `node-gyp` busca).
3. Cierra y reabre la terminal (para refrescar el PATH) y reintenta:

```powershell
npm install
npm rebuild better-sqlite3   # solo si el árbol ya estaba instalado a medias
```

También se necesita un **Python 3** en el PATH (node-gyp lo usa; en Windows 10/11: `python --version` o `winget install Python.Python.3.12`).

Con Node 22 (la versión soportada por el repo) lo habitual es que el binario precompilado se descargue solo y **no haga falta compilar nada**; las Build Tools quedan como red de seguridad para rebuilds (`npm rebuild better-sqlite3`) o para versiones de Node sin binario publicado.

**En Linux (y macOS) no se requiere nada de esto:** `better-sqlite3` publica binarios precompilados para las ABI comunes y `npm install` los descarga automáticamente — sin gcc, sin make, sin Build Tools. Solo se compila localmente si usas una arquitectura exótica o una versión de Node sin binario publicado (mismo mecanismo de fallback).

## E2E de tres servicios (ecosistema completo, autocontenido)

```bash
npm run e2e:3
```

Levanta **CRM + WHATSPOWER + ULTRA** con bases de datos temporales y secretos generados en runtime, ejecuta el flujo completo (webhook Meta firmado → puente → flujo → cliente en CRM; lock; consentimiento; campaña con lock / sin consentimiento / salvaguarda) y verifica que **SENT=0** (jamás hay envío real: `ALLOW_REAL_DISPATCH=false`). Al terminar detiene los procesos y elimina las bases temporales. Multiplataforma (Windows y Linux) usando solo Node; los repos hermanos se autodescubren por el campo `name` de su `package.json` (o usa `E2E_CRM_DIR` / `E2E_WP_DIR` / `E2E_ULTRA_DIR` para rutas explícitas). Requiere `npm install` previo en los tres repos.

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
#    Edita .env con tus valores reales (APP_SECRET, APP_ENCRYPTION_KEY, etc.)

# 3. Base de datos (migraciones versionadas; no usar db push)
npm run db:migrate

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
- `scripts/pii-pepper.local` — pepper secreto del denylist de PII (ver sección siguiente)

## Denylist de PII con pepper (HMAC)

`npm run check:pii` escanea el árbol rastreado por git y bloquea valores prohibidos y teléfonos colombianos no autorizados. Los valores prohibidos del operador no se publican ni en texto plano ni como hash adivinable: viven SOLO como **HMAC-SHA256** en `scripts/pii-hashlist.json`, firmados con una clave secreta (**pepper**) que **nunca se compromete**. Sin la clave no se puede calcular el HMAC de un candidato, así que la hashlist publicada no permite verificar ni un solo intento de adivinación (a diferencia de un `sha256(sal+valor)` simple, que cualquiera puede comparar contra sus candidatos).

Comportamiento del escáner según el pepper:

| Estado del pepper | Comprobación de valores prohibidos | Árbol limpio |
| --- | --- | --- |
| `ok` | Completa: hashlist + patrones genéricos + lista local | exit 0 |
| `ausente` | Desactivada: genéricos + lista local, con **aviso prominente** (y `::warning::` en Actions) | exit 0 |
| `no coincide` | Desactivada: genéricos + lista local, con **aviso prominente** que lo indica | exit 0 |

**Generar un pepper nuevo** (una sola vez; guárdelo en su gestor de contraseñas):

```bash
openssl rand -hex 32   # nunca lo comitee ni lo pegue en issues, logs o chats
```

**Cargarlo:**

- **Local**: guarde el hex en `scripts/pii-pepper.local` (ya está en `.gitignore`; admite `# comentarios`, el prefijo `PII_PEPPER=` o el hex solo en la primera línea).
- **CI**: `gh secret set PII_PEPPER --body "<hex>"` (o *Settings → Secrets and variables → Actions → New repository secret*). El workflow ya lo pasa al escáner.

**Regenerar la hashlist sin publicar valores** (requiere el pepper; no imprime valores):

```bash
PII_PEPPER="<hex>" node scripts/pii-denylist-build.mjs \
  --from-git "scripts/check-pii.mjs@<revision-antigua>" \
  --out scripts/pii-hashlist.json
```

`--from-file <archivo-privado>` y `--from-stdin` aceptan líneas `tipo:valor` (`name|handle|lid|phone`). El pepper jamás aparece en la hashlist ni en la salida del comando.

**Rotación**: genere un pepper nuevo, regenere la hashlist, haga commit de la hashlist y actualice el secreto de Actions y su `scripts/pii-pepper.local` en cada máquina. Los valores reales nunca salen de su equipo: al repo solo llega el HMAC.

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

En Docker, el contenedor opera con `NODE_ENV=production`: antes de levantarlo, configura `ALLOW_DESTRUCTIVE_DB_OPERATION=true` en `.env` **solo después de verificar que `DATABASE_URL` apunta a la BD correcta y tener un backup**. Esta variable autoriza el paso protegido de `migrate deploy`; no autoriza `db push` ni `migrate reset`.

Opcionales: `SMTP_*` (correos transaccionales y automatizaciones) y `WHATSAPP_VERIFY_TOKEN` (webhook de WhatsApp Cloud API).

> En Docker **no** edites `DATABASE_URL` ni `WHATSAPP_DAEMON_URL` del `.env`: Compose los fija (`file:/app/db/custom.db` y `http://wa-daemon:3002`) para que apunten al volumen y a la red interna.

### 2. Levantar

```bash
docker compose up -d --build
```

Al arrancar, el servicio `app` aplica únicamente las migraciones versionadas pendientes (`prisma migrate deploy`) y sirve en `http://localhost:3000`. En un VPS, abre `http://IP-DEL-SERVIDOR:3000`. En entornos protegidos el guard exige `ALLOW_DESTRUCTIVE_DB_OPERATION=true`; configura esa autorización solo después de revisar el destino y tener un backup.

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

En cada arranque, `app` ejecuta `prisma migrate deploy`: aplica las migraciones versionadas pendientes y no genera migraciones nuevas ni sincroniza cambios fuera del historial. Antes de actualizar, haz backup del volumen de datos. Para omitir temporalmente la aplicación automática, configura `SKIP_DB_MIGRATE=1` solo si un operador aplicará las migraciones por un procedimiento controlado. Las bases antiguas que no tengan `_prisma_migrations` pueden requerir revisión y baseline manual; consulta [docs/MIGRACIONES.md](./docs/MIGRACIONES.md). No uses `db push` para actualizar instalaciones.

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
