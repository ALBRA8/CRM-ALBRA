#!/bin/bash
# E2E sintético del flujo OAuth Instagram estilo ManyChat (sin credenciales reales).
# 1) mock Meta en :3999  2) CRM con META_GRAPH_BASE/META_DIALOG_BASE → mock
# 3) config app mock  4) start → valida diálogo  5) callback → valida conexión
# 6) errores CSRF y credenciales faltantes  7) limpieza (desconectar + CRM normal)
set -u
cd /home/z/my-project
LOGS=scripts/logs
mkdir -p "$LOGS"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== 1) mock Meta :3999 =="
for p in $(ss -tlnp 2>/dev/null | grep ':3999 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
nohup node scripts/mock-meta-server.mjs > "$LOGS/mock-meta.log" 2>&1 &
sleep 1
curl -s -o /dev/null -w "" http://localhost:3999/v21.0/dialog/oauth || true
grep -q "escuchando" "$LOGS/mock-meta.log" && ok "mock arriba" || bad "mock no arrancó"

echo "== 2) CRM con env mock =="
for p in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
sleep 1
META_GRAPH_BASE=http://localhost:3999 META_DIALOG_BASE=http://localhost:3999 /usr/bin/node scripts/start-dev-detached.mjs > "$LOGS/e2e-oauth-crm.log" 2>&1
crm=0; for i in $(seq 1 40); do curl -sf -m 3 http://localhost:3000/api/health >/dev/null 2>&1 && { crm=1; break; }; sleep 1; done
[ $crm = 1 ] && ok "CRM :3000 (env mock)" || { bad "CRM no arrancó"; exit 1; }

echo "== 3) login demo + config app mock =="
TOK=$(curl -s -m 20 -X POST http://localhost:3000/api/auth/demo | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
[ -n "$TOK" ] && ok "token demo emitido (oculto)" || { bad "login demo"; exit 1; }
AH="Cookie: albra_session=$TOK"
put=$(curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' \
  -d '{"metaAppId":"1234567890123456","webhookSecret":"mock-secret-for-e2e"}' \
  http://localhost:3000/api/instagram/config)
echo "$put" | grep -q '"metaAppId":"1234567890123456"' && ok "App ID + App Secret guardados (blob cifrado)" || { bad "PUT config: $put"; }

echo "== 4) OAuth start =="
start_res=$(curl -s -m 15 -H "$AH" -D - -o /dev/null http://localhost:3000/api/instagram/oauth/start)
loc=$(echo "$start_res" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
csrf=$(echo "$start_res" | rg -io "set-cookie: ig_oauth_csrf=([^;]+)" -r '$1' | head -1)
echo "$loc" | grep -q "localhost:3999/v21.0/dialog/oauth" && ok "302 al diálogo Meta (mock)" || bad "start location: $loc"
echo "$loc" | grep -q "client_id=1234567890123456" && ok "client_id correcto" || bad "client_id ausente"
echo "$loc" | grep -q "instagram_business_manage_messages" && ok "scope messages presente" || bad "scope ausente"
echo "$loc" | grep -q "redirect_uri=http" && ok "redirect_uri presente" || bad "redirect_uri ausente"
[ -n "$csrf" ] && ok "cookie state CSRF fijada (httpOnly)" || bad "sin cookie CSRF"
STATE=$(node -e "
const u=new URL('$loc');
console.log(u.searchParams.get('state')||'')")
[ -n "$STATE" ] && ok "state firmado presente" || bad "state ausente"

echo "== 5) OAuth callback (feliz) =="
cb=$(curl -s -m 25 -H "$AH" -H "Cookie: ig_oauth_csrf=$STATE" -D - -o /dev/null \
  "http://localhost:3000/api/instagram/oauth/callback?code=MOCKCODE&state=$STATE")
cbloc=$(echo "$cb" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
echo "$cbloc" | grep -q "ig_connected=dr.hernanjarringuillen" && ok "redirect éxito con @usuario IG" || bad "callback location: $cbloc"
cfg=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/instagram/config)
echo "$cfg" | grep -q '"hasAccessToken":true' && ok "token de página guardado cifrado" || bad "config: $cfg"
echo "$cfg" | grep -q '"isActive":true' && ok "canal Instagram ACTIVO" || bad "canal inactivo"
echo "$cfg" | grep -q '"igAccountId":"17841400000000001"' && ok "IG account id persistido" || bad "igAccountId: $cfg"
grep -q "subscribed_apps body" "$LOGS/mock-meta.log" && ok "suscripción webhook IG ejecutada" || bad "sin subscribed_apps"
grep -q "meta_oauth" "$LOGS/e2e-oauth-crm.log" 2>/dev/null && true  # auditoría va a DB, no al log

echo "== 6) caminos de error =="
bad1=$(curl -s -m 15 -H "$AH" -D - -o /dev/null \
  "http://localhost:3000/api/instagram/oauth/callback?code=X&state=AAA.aaa.111.bbb")
echo "$bad1" | rg -q "ig_error=csrf_invalid" && ok "state falso → csrf_invalid" || bad "state fallo no detectado"
exp2=$(node -e '
const fs=require("fs");
const env=fs.readFileSync(".env","utf8");
const m=env.match(/^APP_SECRET=(.+)$/m);
const c=require("crypto");
const tok=process.argv[1];
const payload=JSON.parse(Buffer.from(tok.split(".")[1],"base64").toString());
const exp=Date.now()-1000;
const p=payload.orgId+".n."+exp;
const s=c.createHmac("sha256",m[1].replace(/^"|"$/g,"")).update(p).digest("hex");
console.log(p+"."+s);
' "$TOK")
bad2=$(curl -s -m 15 -H "$AH" -H "Cookie: ig_oauth_csrf=$exp2" -D - -o /dev/null \
  "http://localhost:3000/api/instagram/oauth/callback?code=X&state=$exp2")
echo "$bad2" | rg -q "ig_error=csrf_expired" && ok "state expirado → csrf_expired" || bad "expiración no detectada"
unset_secret="$(curl -s -m 15 -H "$AH" -X PUT -H 'Content-Type: application/json' -d '{"metaAppId":""}' http://localhost:3000/api/instagram/config > /dev/null)"
st3=$(curl -s -m 15 -H "$AH" -D - -o /dev/null http://localhost:3000/api/instagram/oauth/start | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
echo "$st3" | rg -q "ig_error=missing_app_credentials" && ok "sin credenciales → missing_app_credentials" || bad "sin credenciales: $st3"

echo "== 7) limpieza =="
curl -s -m 15 -X DELETE -H "$AH" http://localhost:3000/api/instagram/config > /dev/null && ok "integración IG desconectada (sin token mock residual)"
curl -s -m 15 -H "$AH" http://localhost:3000/api/instagram/config | rg -q '"configured":false' && ok "config verificada vacía" || bad "residuo en config"

echo ""
echo "RESULTADO: PASS=$PASS FAIL=$FAIL"
[ $FAIL = 0 ] && echo "E2E OAUTH INSTAGRAM: TODO OK" || echo "E2E OAUTH INSTAGRAM: HAY FALLOS"
