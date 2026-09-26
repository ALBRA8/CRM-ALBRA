# ============================================================
# CRM ALBRA — Imagen de producción (multi-stage)
#
# Etapas:
#   deps    → instala dependencias con toolchain nativo (better-sqlite3
#             es un módulo NATIVO: necesita python3/make/g++ en Alpine).
#   builder → prisma generate + next build (output standalone) + poda de
#             devDependencies (typescript/eslint/tailwind/vitest...).
#   runner  → imagen mínima no-root con el standalone de Next, el daemon
#             de WhatsApp (Baileys) y el CLI de Prisma para db push.
#
# El standalone queda en .next/standalone (ver scripts/copy-standalone.mjs):
#   .next/standalone/server.js          → servidor
#   .next/standalone/.next/static       → assets del cliente (copiado por el script)
#   .next/standalone/public             → estáticos públicos (copiado por el script)
#   .next/standalone/node_modules       → deps trazadas por Next
# En el runner ese contenido es /app, así que se arranca con `node server.js`.
#
# NUNCA entran en la imagen (los bloquea .dockerignore):
#   .env, db/*.db*, .wa-auth/, sesión de WhatsApp, secretos.
# Los datos viven en volúmenes: /app/db y /app/src/whatsapp-daemon/.wa-auth.
# ============================================================

# syntax=docker/dockerfile:1

# ------------------------------------------------------------
# Etapa 1 · deps — dependencias con toolchain nativo
# ------------------------------------------------------------
FROM node:20-alpine AS deps
# libc6-compat: binarios precompilados que esperan glibc (SWC/sharp en Alpine)
# python3 + make + g++: compila better-sqlite3 si no hay prebuild para musl
# openssl: binarios de Prisma (targets *-openssl-3.0.x)
RUN apk add --no-cache libc6-compat python3 make g++ openssl

WORKDIR /app

# Solo el manifiesto primero → cache de Docker: cambios de código no
# re-instalan dependencias.
COPY package.json package-lock.json* bun.lock* ./

# Instalación reproducible: con package-lock.json commiteado, npm ci fija
# versiones exactas. --legacy-peer-deps por el conflicto peer preexistente
# (next-auth ↔ nodemailer); sin lock, npm install resuelve desde package.json.
RUN if [ -f package-lock.json ]; then \
      npm ci --legacy-peer-deps --no-audit --no-fund; \
    else \
      npm install --legacy-peer-deps --no-audit --no-fund; \
    fi

# ------------------------------------------------------------
# Etapa 2 · builder — prisma generate + next build
# ------------------------------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# node_modules ya compilado (incluye better_sqlite3.node para musl)
COPY --from=deps /app/node_modules ./node_modules
# Fuente completa (lo que .dockerignore excluye no llega: .env, db/, .wa-auth…)
COPY . .

# 1) Cliente Prisma con el motor de consulta para esta plataforma
RUN npx prisma generate

# 2) Build de Next + copia de static/public al standalone
#    (npm run build = `next build && node scripts/copy-standalone.mjs`)
RUN npm run build

# 3) Poda de devDependencies para el runtime (typescript, eslint, tailwind,
#    vitest…). IMPORTANTE: se hace ANTES de `prisma generate` de abajo porque
#    npm prune puede borrar node_modules/.prisma (no es un paquete npm).
RUN npm prune --omit=dev

# 4) Regenerar el cliente Prisma tras la poda: repone node_modules/.prisma
#    con el query engine (offline: los engines ya están en @prisma/engines,
#    que es dependencia del CLI `prisma` — una dependencia de producción).
RUN npx prisma generate

# ------------------------------------------------------------
# Etapa 3 · runner — imagen mínima, usuario no-root
# ------------------------------------------------------------
FROM node:20-alpine AS runner
# libc6-compat + openssl para los binarios nativos de runtime
# (query/schema-engine de Prisma). wget viene con busybox (healthcheck).
RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # BD en el volumen (ruta ABSOLUTA: evita la resolución relativa de SQLite,
    # que depende del directorio de trabajo del proceso)
    DATABASE_URL=file:/app/db/custom.db \
    # Cache de npm/npx fuera de $HOME (el usuario del runtime no la necesita)
    NPM_CONFIG_CACHE=/tmp/.npm

WORKDIR /app

# Usuario no-root (uid/gid 1001). Los volúmenes heredan esta propiedad
# al inicializarse (volúmenes nombrados de compose).
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone de Next: server.js + .next/static + public + node_modules trazados
# (exactamente el contenido que deja scripts/copy-standalone.mjs).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# node_modules de producción completo: agrega al standalone lo que Next NO
# traza — better-sqlite3 compilado (daemon), @whiskeysockets/baileys, qrcode,
# @hapi/boom y el CLI `prisma` + engines (para `db push` en el arranque).
# COPY fusiona directorios: gana sobre el node_modules trazado sin borrar nada.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Esquema Prisma (necesario para `prisma db push` del entrypoint)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Daemon de WhatsApp (Baileys) — proceso separado, no forma parte del
# standalone. AUTH_DIR del daemon = src/whatsapp-daemon/.wa-auth (volumen).
COPY --from=builder --chown=nextjs:nodejs /app/src/whatsapp-daemon ./src/whatsapp-daemon

# Entrypoint y utilidad de espera de esquema (archivos nuevos de este despliegue)
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-wait-db.mjs   ./scripts/docker-wait-db.mjs

# Directorios de datos con dueño correcto (los volúmenes nombrados los
# heredan al inicializarse por primera vez)
RUN chmod +x ./scripts/docker-entrypoint.sh \
 && mkdir -p ./db ./src/whatsapp-daemon/.wa-auth \
 && chown -R nextjs:nodejs ./db ./src/whatsapp-daemon/.wa-auth

# 3000 = app Next · 3002 = daemon WhatsApp (interno; NO publicar)
EXPOSE 3000 3002

# Salud de la app: GET público sin auth ({ ok: true, ts }), no toca la BD.
# start-period cubre el `prisma db push` del arranque.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

# ENTRYPOINT con roles (ver scripts/docker-entrypoint.sh):
#   CMD "app" (default) → prisma db push + node server.js
#   CMD "daemon"        → espera esquema + node src/whatsapp-daemon/daemon.mjs
# No se usa `npm start` (start-standalone.mjs hace spawn sin reenvío de
# señales): aquí `exec node server.js` recibe SIGTERM de `docker stop`.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["app"]
