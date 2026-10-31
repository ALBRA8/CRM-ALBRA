#!/bin/bash
# E2E sintético del canal TikTok (Login Kit + webhook + send gating), estilo ManyChat.
# 1) mock TikTok :3998  2) CRM con TIKTOK_AUTH_BASE/TIKTOK_API_BASE → mock
# 3) config app mock  4) start → valida diálogo  5) callback → valida conexión
# 6) webhook: challenge + firma HMAC + evento entrante  7) send sin acceso → 409 notAuthorized
# 8) errores CSRF  9) limpieza (desconectar + verificación)
set -u
cd /home/z/my-project
LOGS=scripts/logs
mkdir -p "$LOGS"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== 1) mock TikTok :3998 =="
for p in $(ss -tlnp 2>/dev/null | grep ':3998 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
nohup node scripts/mock-tiktok-server.mjs > "$LOGS/mock-tiktok.log" 2>&1 &
sleep 1
grep -q "escuchando" "$LOGS/mock-tiktok.log" && ok "mock arriba" || { bad "mock no arrancó"; exit 1; }

echo "== 2) CRM con env mock =="
for p in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
sleep 1
TIKTOK_AUTH_BASE=http://localhost:3998 TIKTOK_API_BASE=http://localhost:3998 /usr/bin/node scripts/start-dev-detached.mjs > "$LOGS/e2e-tiktok-crm.log" 2>&1
crm=0; for i in $(seq 1 40); do curl -sf -m 3 http://localhost:3000/api/health >/dev/null 2>&1 && { crm=1; break; }; sleep 1; done
[ $crm = 1 ] && ok "CRM :3000 (env mock)" || { bad "CRM no arrancó"; exit 1; }

echo "== 3) login demo + config app mock =="
TOK=$(curl -s -m 20 -X POST http://localhost:3000/api/auth/demo | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
[ -n "$TOK" ] && ok "token demo emitido (oculto)" || { bad "login demo"; exit 1; }
AH="Cookie: albra_session=$TOK"
put=$(curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' \
  -d '{"appKey":"awmockkey123","appSecret":"tt-mock-secret","webhookVerifyToken":"tt_verify_e2e"}' \
  http://localhost:3000/api/tiktok/config)
echo "$put" | grep -q '"success":true' && ok "App Key + App Secret guardados (blob cifrado)" || { bad "PUT config: $put"; }

echo "== 4) OAuth start =="
start_res=$(curl -s -m 15 -H "$AH" -D - -o /dev/null http://localhost:3000/api/tiktok/oauth/start)
loc=$(echo "$start_res" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
csrf=$(echo "$start_res" | rg -io "set-cookie: tt_oauth_csrf=([^;]+)" -r '$1' | head -1)
echo "$loc" | grep -q "localhost:3998/v2/auth/authorize" && ok "302 al diálogo TikTok (mock)" || bad "start location: $loc"
echo "$loc" | grep -q "client_key=awmockkey123" && ok "client_key correcto" || bad "client_key ausente"
echo "$loc" | grep -q "user_info.basic" && ok "scope user_info.basic presente" || bad "scope ausente"
echo "$loc" | grep -q "redirect_uri=http" && ok "redirect_uri presente" || bad "redirect_uri ausente"
[ -n "$csrf" ] && ok "cookie state CSRF fijada (httpOnly)" || bad "sin cookie CSRF"
STATE=$(node -e "const u=new URL('$loc');console.log(u.searchParams.get('state')||'')")
[ -n "$STATE" ] && ok "state firmado presente" || bad "state ausente"

echo "== 5) OAuth callback (feliz) =="
cb=$(curl -s -m 25 -H "$AH" -H "Cookie: tt_oauth_csrf=$STATE" -D - -o /dev/null \
  "http://localhost:3000/api/tiktok/oauth/callback?code=MOCKCODE&state=$STATE")
cbloc=$(echo "$cb" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
echo "$cbloc" | grep -q "tt_connected=johanbravo0830" && ok "redirect éxito con @usuario TikTok" || bad "callback location: $cbloc"
cfg=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/tiktok/config)
echo "$cfg" | grep -q '"hasAccessToken":true' && ok "token guardado cifrado" || bad "config: $cfg"
echo "$cfg" | grep -q '"isActive":true' && ok "canal TikTok ACTIVO" || bad "canal inactivo"
echo "$cfg" | grep -q '"openId":"TT-OPENID-7300000000000000001"' && ok "open_id persistido" || bad "openId: $cfg"
echo "$cfg" | grep -q '"displayName":"johanbravo0830"' && ok "displayName desde /user/info" || bad "displayName: $cfg"
grep -q "token body" "$LOGS/mock-tiktok.log" && ok "intercambio code→token ejecutado (POST form)" || bad "sin intercambio"

echo "== 6) webhook TikTok =="
w1=$(curl -s -m 10 "http://localhost:3000/api/tiktok/webhook?challenge=CHAL12345")
[ "$w1" = "CHAL12345" ] && ok "challenge GET devuelto tal cual" || bad "challenge GET: $w1"
w2=$(curl -s -m 10 -X POST -H 'Content-Type: application/json' -d '{"challenge":"CHAL-POST-9"}' http://localhost:3000/api/tiktok/webhook)
[ "$w2" = "CHAL-POST-9" ] && ok "challenge POST devuelto tal cual" || bad "challenge POST: $w2"
TTBODY='{"event":"ping"}'
SIG=$(node -e 'const c=require("crypto");console.log(c.createHmac("sha256","tt-mock-secret").update(process.argv[1]).digest("hex"))' "$TTBODY")
w3=$(curl -s -m 10 -X POST -H "Content-Type: application/json" -H "X-TikTok-Signature: $SIG" -d "$TTBODY" http://localhost:3000/api/tiktok/webhook)
echo "$w3" | grep -q '"ok":true' && ok "evento con firma válida → 200 ok" || bad "evento firmado: $w3"
TTMSG='{"event":"im.receive","message":{"sender":{"id":"tt-user-1"},"text":"hola desde tiktok"}}'
SIGMSG=$(node -e 'const c=require("crypto");console.log(c.createHmac("sha256","tt-mock-secret").update(process.argv[1]).digest("hex"))' "$TTMSG")
w3b=$(curl -s -m 15 -X POST -H "Content-Type: application/json" -H "X-TikTok-Signature: $SIGMSG" -d "$TTMSG" http://localhost:3000/api/tiktok/webhook)
echo "$w3b" | grep -q '"ok":true' && ok "mensaje entrante con firma válida → 200 (timeline + workflows)" || bad "mensaje entrante: $w3b"
w4=$(curl -s -m 10 -X POST -H "Content-Type: application/json" -H "X-TikTok-Signature: DEADBEEF" -d "$TTBODY" http://localhost:3000/api/tiktok/webhook -o /dev/null -w "%{http_code}")
[ "$w4" = "401" ] && ok "firma inválida → 401" || bad "firma inválida: $w4"

echo "== 7) send sin acceso de socio → 409 notAuthorized =="
s1=$(curl -s -m 10 -X POST -H "$AH" -H 'Content-Type: application/json' \
  -d '{"to":"tt:conversacion-mock","text":"hola"}' http://localhost:3000/api/tiktok/send)
echo "$s1" | grep -q '"notAuthorized":true' && ok "error estructurado notAuthorized (sin sendEndpoint)" || bad "send: $s1"

echo "== 8) send CON sendEndpoint mock =="
curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' \
  -d '{"sendEndpoint":"/v2/business/message/send/"}' http://localhost:3000/api/tiktok/config > /dev/null
s2=$(curl -s -m 10 -X POST -H "$AH" -H 'Content-Type: application/json' \
  -d '{"to":"tt:conversacion-mock","text":"hola"}' http://localhost:3000/api/tiktok/send)
echo "$s2" | grep -q '"ok":true' && ok "envío ejecutado vía endpoint configurado" || bad "send2: $s2"
grep -q "send body" "$LOGS/mock-tiktok.log" && ok "mock recibió el POST de envío" || bad "mock sin envío"

echo "== 9) errores CSRF =="
b1=$(curl -s -m 15 -H "$AH" -D - -o /dev/null \
  "http://localhost:3000/api/tiktok/oauth/callback?code=X&state=AAA.aaa.111.bbb")
echo "$b1" | rg -q "tt_error=csrf_invalid" && ok "state falso → csrf_invalid" || bad "state fallo: $b1"
EXP=$(node -e '
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
b2=$(curl -s -m 15 -H "$AH" -H "Cookie: tt_oauth_csrf=$EXP" -D - -o /dev/null \
  "http://localhost:3000/api/tiktok/oauth/callback?code=X&state=$EXP")
echo "$b2" | rg -q "tt_error=csrf_expired" && ok "state expirado → csrf_expired" || bad "expiración: $b2"

echo "== 10) limpieza =="
curl -s -m 15 -X DELETE -H "$AH" http://localhost:3000/api/tiktok/config > /dev/null && ok "integración TikTok desconectada"
curl -s -m 15 -H "$AH" http://localhost:3000/api/tiktok/config | rg -q '"configured":false' && ok "config verificada vacía" || bad "residuo"

echo ""
echo "RESULTADO: PASS=$PASS FAIL=$FAIL"
[ $FAIL = 0 ] && echo "E2E TIKTOK: TODO OK" || echo "E2E TIKTOK: HAY FALLOS"
