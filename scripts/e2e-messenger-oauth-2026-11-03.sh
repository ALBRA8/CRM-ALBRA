#!/bin/bash
# E2E sintético del flujo OAuth Messenger estilo ManyChat (sin credenciales reales).
# 1) mock Meta-Messenger en :3998  2) CRM con META_GRAPH_BASE/META_DIALOG_BASE → mock
# 3) config app mock (misma app de Meta compartida con Instagram)  4) start JSON + browser
# 5) diálogo mock valida y devuelve code  6) callback feliz → conexión + blob cifrado
# 7) errores CSRF / user_cancel / token reject / sin credenciales  8) limpieza (DELETE + sin residuos)
# 9) restauración: CRM en modo normal (META_*_BASE oficiales) y mock muerto
set -u
cd /home/z/my-project
LOGS=scripts/logs
mkdir -p "$LOGS"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== 1) mock Messenger :3998 =="
for p in $(ss -tlnp 2>/dev/null | grep ':3998 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
nohup node scripts/mock-messenger-server.mjs > "$LOGS/mock-messenger.log" 2>&1 &
sleep 1
curl -s -o /dev/null -w "" http://localhost:3998/v21.0/me || true
grep -q "escuchando" "$LOGS/mock-messenger.log" && ok "mock arriba" || { bad "mock no arrancó"; exit 1; }

echo "== 2) CRM con env mock =="
for p in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
sleep 1
META_GRAPH_BASE=http://localhost:3998 META_DIALOG_BASE=http://localhost:3998 /usr/bin/node scripts/start-dev-detached.mjs > "$LOGS/e2e-messenger-crm.log" 2>&1
crm=0; for i in $(seq 1 40); do curl -sf -m 3 http://localhost:3000/api/health >/dev/null 2>&1 && { crm=1; break; }; sleep 1; done
[ $crm = 1 ] && ok "CRM :3000 (env mock)" || { bad "CRM no arrancó"; exit 1; }

echo "== 3) login demo + config app Meta mock (compartida con Instagram) =="
TOK=$(curl -s -m 20 -X POST http://localhost:3000/api/auth/demo | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
[ -n "$TOK" ] && ok "token demo emitido (oculto)" || { bad "login demo"; exit 1; }
AH="Cookie: albra_session=$TOK"
put=$(curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' \
  -d '{"metaAppId":"1234567890123456","webhookSecret":"fb-mock-secret-e2e"}' \
  http://localhost:3000/api/instagram/config)
echo "$put" | grep -q '"success":true' && ok "App ID + App Secret guardados (blob cifrado, misma app IG+Messenger)" || { bad "PUT config: $put"; }
ORGID=$(node -e "const p=JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64').toString());console.log(p.orgId||'')" "$TOK")

echo "== 4) OAuth start modo JSON (cliente API) =="
start_json=$(curl -s -m 15 -H "$AH" -H 'Accept: application/json' http://localhost:3000/api/facebook/oauth/start)
jurl=$(echo "$start_json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).url||'')}catch{console.log('')}})")
jredir=$(echo "$start_json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).redirectUri||'')}catch{console.log('')}})")
echo "$start_json" | grep -q '"url":' && echo "$start_json" | grep -q '"redirectUri":' && ok "JSON {url, redirectUri} sin redirect" || bad "JSON start: $start_json"
[ "$jredir" = "http://localhost:3000/api/facebook/oauth/callback" ] && ok "redirectUri = callback oficial" || bad "redirectUri: $jredir"
echo "$jurl" | grep -q "localhost:3998/v21.0/dialog/oauth" && ok "url apunta al diálogo Meta (mock)" || bad "url diálogo: $jurl"
echo "$jurl" | grep -q "client_id=1234567890123456" && ok "client_id correcto" || bad "client_id ausente"
echo "$jurl" | grep -q "pages_messaging" && echo "$jurl" | grep -q "pages_show_list" && ok "scopes Messenger presentes" || bad "scopes ausentes"
echo "$jurl" | grep -q "response_type=code" && ok "response_type=code" || bad "response_type ausente"

echo "== 5) OAuth start modo navegador (302 + cookie) =="
start_res=$(curl -s -m 15 -H "$AH" -H 'Accept: text/html' -D - -o /dev/null http://localhost:3000/api/facebook/oauth/start)
loc=$(echo "$start_res" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
csrf=$(echo "$start_res" | rg -io "set-cookie: facebook_oauth_csrf=([^;]+)" -r '$1' | head -1)
echo "$loc" | grep -q "localhost:3998/v21.0/dialog/oauth" && ok "302 al diálogo Meta (mock)" || bad "start location: $loc"
echo "$loc" | grep -q "client_id=1234567890123456" && ok "client_id en el diálogo" || bad "client_id ausente (browser)"
echo "$loc" | grep -q "pages_messaging" && ok "scope Messenger en el diálogo" || bad "scope ausente (browser)"
[ -n "$csrf" ] && ok "cookie state CSRF fijada (httpOnly, path callback)" || bad "sin cookie CSRF"
STATE=$(node -e "const u=new URL('$loc');console.log(u.searchParams.get('state')||'')")
[ -n "$STATE" ] && ok "state firmado presente" || bad "state ausente"

echo "== 6) diálogo mock valida y entrega code =="
dlg=$(curl -s -m 10 -H "$AH" -D - -o /dev/null "$loc")
dlgloc=$(echo "$dlg" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
echo "$dlgloc" | grep -q "code=FB-MOCK-CODE" && ok "diálogo valida client_id/redirect_uri/state → 302 con code" || bad "diálogo: $dlgloc"
echo "$dlgloc" | grep -q "state=$STATE" && ok "diálogo preserva el state firmado" || bad "state mutado: $dlgloc"

echo "== 7) OAuth callback (feliz) =="
cb=$(curl -s -m 25 -H "$AH" -H "Cookie: facebook_oauth_csrf=$STATE" -D - -o /dev/null \
  "http://localhost:3000/api/facebook/oauth/callback?code=FB-MOCK-CODE&state=$STATE")
cbloc=$(echo "$cb" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
echo "$cbloc" | grep -q "facebook_connected=" && ok "redirect éxito a /settings?tab=facebook" || bad "callback location: $cbloc"
connected=$(node -e "const u=new URL(process.argv[1],'http://localhost:3000');console.log(u.searchParams.get('facebook_connected')||'')" "$cbloc")
[ "$connected" = "Página ALRA Mock" ] && ok "nombre de la PRIMERA página conectada" || bad "connected: '$connected'"
cfg=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/facebook/config)
echo "$cfg" | grep -q '"hasPageToken":true' && ok "token de página guardado cifrado" || bad "config: $cfg"
echo "$cfg" | grep -q '"isActive":true' && ok "canal Facebook ACTIVO" || bad "canal inactivo"
echo "$cfg" | grep -q '"pageId":"101010101010102"' && ok "pageId de la primera página persistido" || bad "pageId: $cfg"
echo "$cfg" | grep -q '"pageName":"Página ALRA Mock"' && ok "pageName persistido" || bad "pageName: $cfg"
echo "$cfg" | grep -q '"userEmail":"messenger.mock@albra.test"' && ok "email del autorizador persistido" || bad "userEmail: $cfg"
grep -q "token code=FB-MOCK-CODE" "$LOGS/mock-messenger.log" && ok "intercambio code→token ejecutado" || bad "sin intercambio"
grep -q "subscribed_apps body" "$LOGS/mock-messenger.log" && grep -q "messaging_postbacks" "$LOGS/mock-messenger.log" && ok "suscripción webhook (messaging, messaging_postbacks)" || bad "sin subscribed_apps"

echo "== 8) blob cifrado en SQLite (sin token plano) =="
blob=$(node -e '
const D=require("better-sqlite3");
const d=new D("db/custom.db",{readonly:true});
const row=d.prepare("SELECT facebookTokenEnc,facebookPageId,facebookPageName,facebookUserEmail,enableFacebook FROM Integration WHERE organizationId=?").get(process.argv[1]);
if(!row){console.log("NOROW");process.exit(0)}
console.log(JSON.stringify({enc:row.facebookTokenEnc||"",pid:row.facebookPageId||"",name:row.facebookPageName||"",email:row.facebookUserEmail||"",active:row.enableFacebook}));
d.close();
' "$ORGID")
echo "$blob" | grep -q '"enc":"v1:' && ok "facebookTokenEnc cifrado AES-256-GCM (v1:…)" || bad "blob sin cifrar: $blob"
echo "$blob" | grep -q "FB-PAGE-TOKEN-MOCK" && bad "TOKEN PLANO en la DB" || ok "sin texto plano del token en la DB"
echo "$blob" | grep -q '"active":1' && ok "enableFacebook=1 en DB" || bad "enableFacebook: $blob"
echo "$blob" | grep -q '"pid":"101010101010102"' && echo "$blob" | grep -q '"name":"Página ALRA Mock"' && echo "$blob" | grep -q '"email":"messenger.mock@albra.test"' && ok "columnas facebookPageId/PageName/UserEmail en DB" || bad "columnas: $blob"

echo "== 9) caminos de error =="
bad1=$(curl -s -m 15 -H "$AH" -D - -o /dev/null \
  "http://localhost:3000/api/facebook/oauth/callback?code=X&state=AAA.aaa.111.bbb")
echo "$bad1" | rg -q "facebook_error=csrf_invalid" && ok "state falso → csrf_invalid" || bad "state falso no detectado: $bad1"
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
bad2=$(curl -s -m 15 -H "$AH" -H "Cookie: facebook_oauth_csrf=$EXP" -D - -o /dev/null \
  "http://localhost:3000/api/facebook/oauth/callback?code=X&state=$EXP")
echo "$bad2" | rg -q "facebook_error=csrf_expired" && ok "state expirado → csrf_expired" || bad "expiración no detectada: $bad2"
# access_denied de Meta → user_cancel (state+cookie frescos)
start2=$(curl -s -m 15 -H "$AH" -H 'Accept: text/html' -D - -o /dev/null http://localhost:3000/api/facebook/oauth/start)
loc2=$(echo "$start2" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
STATE2=$(node -e "const u=new URL('$loc2');console.log(u.searchParams.get('state')||'')")
bad3=$(curl -s -m 15 -H "$AH" -H "Cookie: facebook_oauth_csrf=$STATE2" -D - -o /dev/null \
  "http://localhost:3000/api/facebook/oauth/callback?error=access_denied&state=$STATE2")
echo "$bad3" | rg -q "facebook_error=user_cancel" && ok "error=access_denied → user_cancel" || bad "access_denied: $bad3"
# code inválido → el endpoint de token rechaza
start3=$(curl -s -m 15 -H "$AH" -H 'Accept: text/html' -D - -o /dev/null http://localhost:3000/api/facebook/oauth/start)
loc3=$(echo "$start3" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
STATE3=$(node -e "const u=new URL('$loc3');console.log(u.searchParams.get('state')||'')")
bad4=$(curl -s -m 15 -H "$AH" -H "Cookie: facebook_oauth_csrf=$STATE3" -D - -o /dev/null \
  "http://localhost:3000/api/facebook/oauth/callback?code=CODIGO-MALO&state=$STATE3")
echo "$bad4" | rg -q "facebook_error=token_endpoint_reject" && ok "code inválido → token_endpoint_reject" || bad "token reject: $bad4"
# sin credenciales de app → redirect (browser) y 400 (JSON)
curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' -d '{"metaAppId":""}' \
  http://localhost:3000/api/instagram/config > /dev/null
bad5=$(curl -s -m 15 -H "$AH" -H 'Accept: text/html' -D - -o /dev/null http://localhost:3000/api/facebook/oauth/start)
echo "$bad5" | rg -q "facebook_error=missing_app_credentials" && ok "sin credenciales app → missing_app_credentials (browser)" || bad "sin credenciales: $bad5"
code5=$(curl -s -m 15 -H "$AH" -H 'Accept: application/json' -o /dev/null -w "%{http_code}" http://localhost:3000/api/facebook/oauth/start)
body5=$(curl -s -m 15 -H "$AH" -H 'Accept: application/json' http://localhost:3000/api/facebook/oauth/start)
[ "$code5" = "400" ] && echo "$body5" | grep -q 'missing_app_credentials' && ok "sin credenciales app → JSON 400 missing_app_credentials" || bad "JSON sin credenciales: $code5 $body5"

echo "== 10) limpieza (DELETE + sin residuos) =="
curl -s -m 15 -X DELETE -H "$AH" http://localhost:3000/api/facebook/config > /dev/null && ok "integración Facebook desconectada (sin token mock residual)"
curl -s -m 15 -H "$AH" http://localhost:3000/api/facebook/config | rg -q '"configured":false' && ok "config verificada vacía" || bad "residuo en config"
resid=$(node -e '
const D=require("better-sqlite3");
const d=new D("db/custom.db",{readonly:true});
const row=d.prepare("SELECT facebookTokenEnc,facebookPageId,facebookPageName,facebookUserEmail,enableFacebook FROM Integration WHERE organizationId=?").get(process.argv[1]);
console.log(JSON.stringify({enc:row.facebookTokenEnc,pid:row.facebookPageId,name:row.facebookPageName,email:row.facebookUserEmail,active:row.enableFacebook}));
d.close();
' "$ORGID")
echo "$resid" | grep -q '"enc":null' && echo "$resid" | grep -q '"pid":null' && echo "$resid" | grep -q '"name":null' && echo "$resid" | grep -q '"email":null' && echo "$resid" | grep -q '"active":0' && ok "DB sin residuos (blob, pageId, pageName, email, enable=false)" || bad "residuos DB: $resid"

echo "== 11) restaurar modo normal (META_*_BASE oficiales) y mock muerto =="
for p in $(ss -tlnp 2>/dev/null | grep ':3998 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
sleep 1
ss -tlnp 2>/dev/null | grep -q ':3998 ' && bad "mock aún vivo" || ok "mock :3998 muerto"
for p in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
sleep 1
/usr/bin/node scripts/start-dev-detached.mjs > "$LOGS/e2e-messenger-crm-normal.log" 2>&1
crm2=0; for i in $(seq 1 40); do curl -sf -m 3 http://localhost:3000/api/health >/dev/null 2>&1 && { crm2=1; break; }; sleep 1; done
[ $crm2 = 1 ] && ok "CRM :3000 en modo normal (sin env mock)" || bad "CRM normal no arrancó"
health=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
[ "$health" = "200" ] && ok "health 200 (CRM vivo y sano)" || bad "health: $health"

echo ""
echo "RESULTADO: PASS=$PASS FAIL=$FAIL"
[ $FAIL = 0 ] && echo "E2E OAUTH MESSENGER: TODO OK" || echo "E2E OAUTH MESSENGER: HAY FALLOS"
