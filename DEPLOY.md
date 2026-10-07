# DEPLOY.md — Despliegue en producción (VPS)

Guía para pasar del repo a un CRM funcionando con HTTPS, WhatsApp conectado
y backups automáticos. Escrita para la fase de **primeros 1–5 clientes**:
mínima pieza por pieza, sin sobrediseño, pero cerrando los bloqueantes que
marcó la auditoría pre-venta.

```
Internet ── HTTPS :443 ──► Caddy (o cloudflared) ──► app (Next.js :3000)
                                                        │  red interna Docker
                                                        ├─► wa-daemon (Baileys :3002, NO público)
                                                        │
                                    volúmenes: db-data (custom.db) · wa-auth (sesión WhatsApp)
```

---

## 1. Requisitos

| Pieza | Mínimo | Recomendado |
|---|---|---|
| VPS | 1 vCPU · 2 GB RAM · 20 GB disco | 2 vCPU · 4 GB RAM |
| SO | Ubuntu 22.04 / 24.04 LTS | Ubuntu 24.04 LTS |
| Software | Docker Engine + plugin compose | — |
| Dominio | 1 registro **A** apuntando a la IP del VPS | subdominio dedicado (crm.tudominio.com) |
| Puertos | 22, 80, 443 (opción Caddy) — o solo 22 (opción Cloudflare Tunnel) | — |
| IP | **Estable**: WhatsApp asocia la sesión a la conexión; cambios frecuentes de IP pueden forzar re-escanear el QR | — |

Con 1–5 clientes, el par app + daemon Baileys vive cómodo en 2 GB
(observado: ~300–500 MB en conjunto). El cuello real suele ser el disco si
los backups crecen: la retención del §8 lo controla.

---

## 2. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

---

## 3. Código y variables de entorno

```bash
sudo mkdir -p /opt/crm-albra && sudo chown "$USER" /opt/crm-albra
git clone https://github.com/ALBRA8/CRM-ALBRA.git /opt/crm-albra
cd /opt/crm-albra
cp .env.example .env
# Genera los 3 secretos con:
openssl rand -hex 32   # (ejecutar 3 veces, un valor para cada variable)
```

Edita `.env`:

| Variable | Qué poner | ¿La pisa compose? |
|---|---|---|
| `APP_SECRET` | `openssl rand -hex 32` — firma los JWT de sesión | no |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` — cifra llaves de IA (AES-256-GCM) | no |
| `INTERNAL_API_SECRET` | `openssl rand -hex 32` (≥24 chars) — auth mutua app ↔ daemon | no (ambos lo leen del mismo `.env`) |
| `DATABASE_URL` | déjalo como venga; en Docker el compose lo fuerza a `file:/app/db/custom.db` | **sí** |
| `WHATSAPP_DAEMON_URL` | ídem: el compose lo fuerza a `http://wa-daemon:3002` | **sí** |
| `SMTP_*` | tu proveedor de correo (automatizaciones por email) | no |
| `WHATSAPP_VERIFY_TOKEN` | string aleatorio cualquiera | no |

> `.env` nunca entra en la imagen (lo bloquea `.dockerignore`): vive solo en
> el host y se inyecta vía `env_file`. Si pierdes `APP_ENCRYPTION_KEY`
> pierdes las llaves de IA cifradas → tendrías que re-ingresarlas en
> Configuración → Agente IA. Guárdala junto a tus backups.

---

## 4. Levantar

```bash
cd /opt/crm-albra
docker compose up -d --build
watch docker compose ps        # espera: app "healthy" y wa-daemon "healthy"
curl -s http://127.0.0.1:3000/api/health     # {"ok":true,...}
```

Qué hace el primer arranque: `app` aplica el esquema (`prisma db push`) y
arranca el servidor; `wa-daemon` espera a que la BD tenga esquema (con
`depends_on: service_healthy` + doble defensa en el entrypoint) y abre el
puerto interno 3002.

**Migraciones seguras por defecto** (hardening pre-venta): desde esta versión
el arranque ejecuta `prisma db push` **sin** `--accept-data-loss`: si un cambio
de esquema exigiría destruir datos, el contenedor **falla ruidoso y no arranca**
en vez de recortarlos. Solo con `ALLOW_DATA_LOSS: "1"` en compose se acepta la
pérdida explícitamente (haz backup antes, §8). Cuando la BD esté en producción
y quieras congelar del todo, descomenta `SKIP_DB_PUSH: "1"` y aplica cambios
a mano:

```bash
docker compose exec app npx prisma db push
```

---

## 5. Primer usuario (dueño de la organización)

Abre el dominio → **Registro**: el primer usuario crea la organización como
owner. Para explorar antes de registrar nada, la demo pública sigue
disponible (`INICIAR DEMO` en la landing).

---

## 6. HTTPS — obligatorio antes de vender

Sin candado: el login viaja en plano, los navegadores de los clientes
gritan "no seguro" y las PWA no instalan. Dos opciones probadas:

### Opción A — Caddy en el host (recomendado: certificado automático)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

`/etc/caddy/Caddyfile`:

```
crm.tudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy   # Let's Encrypt emite y renueva solo
```

### Opción B — Cloudflare Tunnel (sin abrir puertos; ideal si el VPS está detrás de NAT o quieres ocultar la IP)

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login
cloudflared tunnel create crm-albra
cloudflared tunnel route dns crm-albra crm.tudominio.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: crm-albra
credentials-file: /home/TU_USUARIO/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: crm.tudominio.com
    service: http://localhost:3000
  - service: http_status:404
```

```bash
sudo cloudflared service install && sudo systemctl start cloudflared
```

> **El puerto 3000 queda ligado a `127.0.0.1`** (hardening pre-venta):
> Docker NO lo publica hacia Internet — solo Caddy/cloudflared en el host lo
> alcanza por loopback. Los clientes SIEMPRE entran por HTTPS. El 3002 del
> daemon **nunca** se publica (no tiene auth de red; la app lo expone de
> forma segura por su proxy con JWT).

---

## 7. Conectar WhatsApp (una sola vez)

1. Entra con tu usuario → **Configuración → WhatsApp → Conectar**.
2. Escanea el QR con el teléfono: *WhatsApp → Dispositivos vinculados →
   Vincular un dispositivo*.
3. La sesión queda en el volumen `wa-auth`: al reiniciar el VPS **no** hay
   que re-escanear. Solo se re-escanea si cierras sesión desde el teléfono
   o borras ese volumen.

Notas operativas: el mensaje que el dueño escriba desde su propio teléfono
se registra como saliente del vendedor (el bot **no** se auto-responde);
los grupos y estados se ignoran. Límite práctico de WhatsApp: ~4 dispositivos
vinculados por cuenta.

---

## 8. Backups automáticos + restauración (la lección de oro)

**Instalar el cron (una vez):**

```bash
crontab -e
# añadir:
30 3 * * * /opt/crm-albra/scripts/backup-nightly.sh >> /var/log/crm-albra-backup.log 2>&1
```

Qué genera cada noche en `/opt/crm-albra/backups/`:

- `custom-<fecha>.db` — snapshot **consistente** de la BD (Online Backup API
  de SQLite, sin detener servicios, con `integrity_check` incluido).
- `wa-auth-<fecha>.tar.gz` — sesión de WhatsApp (sin ella se pierde el
  dispositivo vinculado).
- Retención 14 días (`RETAIN_DAYS`) y, si defines `BACKUP_REMOTE_DEST`,
  envío externo con `rclone`.

**Regla 3-2-1 de fase 1:** copia en el VPS + copia FUERA del VPS. Un backup
solo en el mismo disco que la BD no es backup, es decoración. Mínimo viable:
`rclone config` (S3 / B2 / Google Drive) + `BACKUP_REMOTE_DEST=b2:crm-albra-backups`
en el crontab — o un `scp`/`rsync` diario a tu PC.

**Restauración total (procedimiento exacto — ensáyalo antes de necesitarlo):**

```bash
cd /opt/crm-albra && docker compose stop

# BD (los volúmenes se llaman crm-albra_db-data y crm-albra_wa-auth)
docker run --rm -v crm-albra_db-data:/db -v "$PWD/backups":/bak alpine \
  sh -c "cp /bak/custom-FECHA.db /db/custom.db \
      && rm -f /db/custom.db-wal /db/custom.db-shm \
      && chown -R 1001:1001 /db"

# Sesión de WhatsApp
docker run --rm -v crm-albra_wa-auth:/auth -v "$PWD/backups":/bak alpine \
  sh -c "rm -rf /auth/* /auth/.[!.]* 2>/dev/null; \
         tar xzf /bak/wa-auth-FECHA.tar.gz -C /auth; \
         chown -R 1001:1001 /auth"

docker compose up -d
```

El `chown 1001:1001` es obligatorio: los contenedores corren como usuario
no-root (nextjs, uid 1001) y un archivo restaurado con dueño `root` rompe
el arranque. El `rm -f ...-wal/-shm` evita mezclar el WAL viejo con la BD
restaurada.

---

## 9. Actualizar la app

```bash
cd /opt/crm-albra
./scripts/backup-nightly.sh          # regla de oro: backup ANTES de actualizar
git pull
docker compose up -d --build
docker compose logs -f app           # mira el db push del entrypoint
```

Si algo sale mal: `docker compose down`, restaura el backup (§8), y
`git checkout <commit-anterior>` + `up -d --build`.

---

## 10. Ensayo de desastre (drill trimestral — 10 minutos)

Lo que no se ensaya no funciona el día que importa. **Drill automatizado**
(verificado en el cierre pre-venta: PASS — snapshot → integridad → copia
externa → destrucción controlada → restore → CRM funcional con login real):

```bash
bash scripts/backup-restore-drill.sh   # no toca la BD real; exit 0 = PASS
```

Complemento manual (simula también el volumen `wa-auth`, que el script
automatizado NO cubre):

1. `scp` el backup más reciente a tu portátil (prueba de que la copia
   externa es real y legible).
2. En un directorio temporal, levanta el stack con los mismos volúmenes y
   restaura (§8) el backup más viejo disponible.
3. Verifica: login OK, un cliente con su historial, una cotización con
   ítems, WhatsApp conectado sin re-escanear QR.
4. Borra el entorno de prueba. Anota la fecha del drill.

---

## 11. Monitoreo mínimo (sin over-engineering)

```bash
docker compose ps                          # ambos "healthy"
curl -s https://crm.tudominio.com/api/health
docker compose logs --tail 50 wa-daemon    # reconexiones de Baileys
df -h /                                    # espacio (backups + BD crecen)
```

Opcional: un uptime-checker externo gratuito (UptimeRobot/Better Stack)
apuntando a `/api/health` con alerta a tu correo/WhatsApp.

---

## 12. Checklist final pre-venta (mapeo de la auditoría)

| # | Hallazgo | Estado |
|---|---|---|
| 🔴1 | Bot se auto-respondía al dueño (`fromMe`) | ✅ commit `7029f4a` — mensajes del dueño se guardan como salientes, sin auto-respuesta |
| 🔴2 | Daemon no alcanzaba la API en Docker (`NEXT_APP_URL`) | ✅ commit `7029f4a` — `http://app:3000` en compose |
| 🔴3 | Restauración de backup perdía datos | ✅ commit `7029f4a` — restaura oportunidades, reservas, cotizaciones+ítems y transacciones; aviso honesto en la UI |
| 🟠 | `prisma db push --accept-data-loss` | ✅ hardening — arranque **fail-closed**: los cambios destructivos detienen el arranque; `ALLOW_DATA_LOSS=1` solo explícito (§4) |
| 🟠 | HTTP plano | ✅ doble defensa — compose publica `127.0.0.1:3000` (§6) + Caddy/cloudflared obligatorios |
| 🔴P0 | WhatsApp fail-open (`!linked \|\| linked === org`) | ✅ hardening — ownership verificable o DENIED en proxy y daemon (rebind bloqueado); 6 tests de regresión + E2E HTTP 19 pasos |
| 🔴P0 | CI rojo (223/224) | ✅ corregido — la causa raíz era el mismo fail-open; CI completo: prisma validate + tsc + lint + tests + build |
| 🟡 | Backup nocturno programado | ✅ §8 — `scripts/backup-nightly.sh` + cron + retención + externo |
| 🟡 | Drill de desastre | ✅ §10 — procedimiento de 10 min |
| ⚪ | Sobrediseño (Instagram/Telegram, niveles, Sheets) | Concordado: ya construidos, no se venden en fase 1 |

Antes del primer cliente pagado, además (**obligatorio** — la auditoría
pre-venta confirmó con `git log -S` que la llave NVIDIA completa vive en el
historial de `main` ya publicado en GitHub, no solo local):

1. **Rotar la llave NVIDIA** en [console.ngc.nvidia.com](https://console.ngc.nvidia.com) → revocar `nvapi-THrlN-…` → generar una nueva → Configuración → Agente IA.
2. **Revocar todos los PAT de GitHub antiguos** ([github.com/settings/tokens](https://github.com/settings/tokens)) — hay PATs `ghp_…` en commits históricos de `worklog.md` y uno pegado en chat durante el despliegue.
3. Opcional (P2): reescribir el historial (`git filter-repo`) para purgar los secretos viejos; mientras tanto la rotación del punto 1-2 neutraliza el riesgo.

### Estado verificado de cada pieza (auditoría pre-venta)

| Pieza | Estado |
|---|---|
| Aislamiento multi-tenant (API/memoria/automatizaciones/documentos) | **REAL** — tests P0 (230) + E2E HTTP (20 pasos) |
| WhatsApp ownership fail-closed | **REAL** — E2E HTTP 19 pasos (ORG-A/B, unknown, daemon caído) |
| Auth JWT + scrypt + RBAC | **REAL** — unit + E2E + drill de restauración |
| Backup → externo → restore → CRM funcional | **REAL** — `bash scripts/backup-restore-drill.sh` (PASS; replica el flujo del §10) |
| E2E del agente IA (tool-calling, memoria, embeddings) | **MOCK** — frontera OpenAI-compatible simulada; todo el código del CRM es real |
| Proveedor de IA real (chat + embeddings) | **CONFIGURABLE / NO VERIFICADO** — sin credenciales disponibles al cierre; verificar con `node scripts/ai-real-smoke.mjs` (imprime REAL / REAL+CONFIGURACIÓN / NO VERIFICADO sin exponer la key) |
| WhatsApp real (Baileys, QR, envío) | **CONFIGURABLE** — requiere teléfono + QR en el VPS; la arquitectura está testeada con daemon mock |
| SMTP / notificaciones email | **CONFIGURABLE** — credentials en .env, no verificadas en el cierre |
| Escalado (multi-sesión WhatsApp, >1 org pesada, HA) | **LIMITADO** — SQLite + 1 sesión de WhatsApp por despliegue: dimensionado para primera venta controlada, no para escala |
