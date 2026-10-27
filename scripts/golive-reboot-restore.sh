#!/bin/bash
# Restauración post-reinicio del VM: alinear secretos del .env del CRM (fuente canónica
# tras reciclaje) + clonar WP + arrancar daemon :3002, WP :3003. CRM :3000 ya arranca con el boot.
# Secretos jamás impresos. Sin teardown: ventana del operador queda viva.
set -u
LOGS=/home/z/my-project/scripts/logs
mkdir -p "$LOGS"

# 1) WP clone si falta
if [ ! -d /home/z/repos-limpio/WHATSPOWER ]; then
  mkdir -p /home/z/repos-limpio
  cd /home/z/repos-limpio
  git clone --depth 1 https://github.com/ALBRA8/WHATSPOWER.git > "$LOGS/restore-wp-clone.log" 2>&1 || { echo "FALLO_CLONE_WP"; exit 2; }
fi
SHA=$(git -C /home/z/repos-limpio/WHATSPOWER rev-parse HEAD)
echo "WP HEAD: $SHA"

# 2) claves de integración en .env del CRM (si el boot las borró)
if ! grep -qE '^WHATSPOWER_WEBHOOK_SECRET=' /home/z/my-project/.env; then
  echo "WHATSPOWER_WEBHOOK_SECRET=\"$(openssl rand -hex 32)\"" >> /home/z/my-project/.env
fi
grep -qE '^WHATSPOWER_ENABLED=' /home/z/my-project/.env || printf 'WHATSPOWER_ENABLED="true"\nWHATSPOWER_INBOUND_URL="http://localhost:3003/api/inbound"\nWHATSPOWER_STAGE_URL="http://localhost:3003/api/crm/stage-change"\n' >> /home/z/my-project/.env
chmod 600 /home/z/my-project/.env
echo "claves CRM .env: $(cut -d= -f1 /home/z/my-project/.env | tr '\n' ' ')"

# 3) .env de WP con el MISMO par de secretos del CRM
WENV=/home/z/repos-limpio/WHATSPOWER/.env
if [ ! -f "$WENV" ]; then
  WSEC=$(grep '^WHATSPOWER_WEBHOOK_SECRET=' /home/z/my-project/.env | cut -d= -f2- | tr -d '"')
  ISEC=$(grep '^INTERNAL_API_SECRET=' /home/z/my-project/.env | cut -d= -f2- | tr -d '"')
  umask 077
  printf 'PORT=3003\nNODE_ENV=production\nINTERNAL_API_SECRET=%s\nWEBHOOK_SECRET=%s\nWHATSAPP_DAEMON_URL=http://localhost:3002\nCRM_BASE_URL=http://localhost:3000\n' "$ISEC" "$WSEC" > "$WENV"
fi
echo "claves WP .env: $(cut -d= -f1 "$WENV" | tr '\n' ' ')"

# 4) deps WP
cd /home/z/repos-limpio/WHATSPOWER
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund > "$LOGS/restore-wp-npm.log" 2>&1
  echo "npm install exit: $?"
fi

# 5) puertos limpios (daemon/WP)
for port in 3002 3003; do
  for p in $(ss -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
done
sleep 1

# 6) daemon Baileys :3002 (env del CRM — mismo secreto)
cd /home/z/my-project
nohup node src/whatsapp-daemon/daemon.mjs > "$LOGS/restore-daemon.log" 2>&1 &
echo $! > "$LOGS/restore-daemon.pid"

# 7) WHATSPOWER :3003
cd /home/z/repos-limpio/WHATSPOWER
nohup node --experimental-strip-types src/server.ts > "$LOGS/restore-wp.log" 2>&1 &
echo $! > "$LOGS/restore-wp.pid"

# 8) salud de los tres
ISEC=$(grep '^INTERNAL_API_SECRET=' /home/z/my-project/.env | cut -d= -f2- | tr -d '"')
dm=0; wp=0; crm=0
for i in $(seq 1 30); do
  [ $dm = 0 ] && curl -sf -H "Authorization: Bearer $ISEC" http://localhost:3002/status >/dev/null 2>&1 && dm=1
  [ $wp = 0 ] && curl -sf http://localhost:3003/api/health >/dev/null 2>&1 && wp=1
  [ $dm = 1 ] && [ $wp = 1 ] && break
  sleep 1
done
for i in $(seq 1 120); do
  curl -sf http://localhost:3000/api/health >/dev/null 2>&1 && { crm=1; break; }
  sleep 1
done
echo "RESULTADO_RESTAURE WP=$wp DAEMON=$dm CRM=$crm"
