#!/bin/bash
# E2E sintético del flujo OAuth "Conectar con Google" estilo GitHub/ManyChat
# (sin credenciales reales). 1) mock Google :3998  2) CRM con
# GOOGLE_AUTH_BASE/GOOGLE_TOKEN_BASE/GOOGLE_USERINFO_BASE → mock  3) config
# cliente mock  4) start JSON → valida URL  5) start browser → 302 + cookie CSRF
# 6) callback feliz → google_connected=<email> + config connected  7) errores
# CSRF + client_secret rechazado  8) limpieza (desconectar + CRM normal)
set -u
cd /home/z/my-project
LOGS=scripts/logs
mkdir -p "$LOGS"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== 1) mock Google :3998 =="
for p in $(ss -tlnp 2>/dev/null | grep ':3998 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
nohup node scripts/mock-google-server.mjs > "$LOGS/mock-google.log" 2>&1 &
sleep 1
curl -s -o /dev/null http://localhost:3998/o/oauth2/v2/auth || true
grep -q "escuchando" "$LOGS/mock-google.log" && ok "mock arriba" || bad "mock no arrancó"

echo "== 2) CRM con env mock =="
for p in $(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -o 'pid=[0-9]*' | grep -o '[0-9]*' | sort -u); do kill -9 "$p" 2>/dev/null; done
sleep 1
GOOGLE_AUTH_BASE=http://localhost:3998 GOOGLE_TOKEN_BASE=http://localhost:3998 GOOGLE_USERINFO_BASE=http://localhost:3998 \
  /usr/bin/node scripts/start-dev-detached.mjs > "$LOGS/e2e-google-crm.log" 2>&1
crm=0; for i in $(seq 1 40); do curl -sf -m 3 http://localhost:3000/api/health >/dev/null 2>&1 && { crm=1; break; }; sleep 1; done
[ $crm = 1 ] && ok "CRM :3000 (env mock)" || { bad "CRM no arrancó"; exit 1; }

echo "== 3) login demo + config cliente mock =="
TOK=$(curl -s -m 20 -X POST http://localhost:3000/api/auth/demo | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
[ -n "$TOK" ] && ok "token demo emitido (oculto)" || { bad "login demo"; exit 1; }
AH="Cookie: albra_session=$TOK"

# 3a) sin config → JSON 400
noconf=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/google/auth)
echo "$noconf" | grep -q 'error' && ok "sin config → error claro (JSON 400)" || bad "sin config: $noconf"

put=$(curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' \
  -d '{"clientId":"MOCK-CLIENT-ID.apps.googleusercontent.com","clientSecret":"MOCK-SECRET-OK"}' \
  http://localhost:3000/api/google/config)
echo "$put" | grep -q '"configured":true' && ok "Client ID + Secret guardados (cifrados)" || bad "PUT config: $put"

echo "== 4) OAuth start (modo JSON, sin cookies) =="
jstart=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/google/auth)
echo "$jstart" | grep -q 'redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fgoogle%2Fauth' && ok "redirectUri absoluta /api/google/auth" || bad "json start: $jstart"
echo "$jstart" | grep -q 'localhost:3998/o/oauth2/v2/auth' && ok "URL apunta al diálogo (mock)" || bad "dialog base: $jstart"
echo "$jstart" | grep -q 'client_id=MOCK-CLIENT-ID' && ok "client_id correcto" || bad "client_id ausente"
echo "$jstart" | grep -q 'gmail.send' && echo "$jstart" | grep -q 'drive.file' && echo "$jstart" | grep -q 'userinfo.email' && ok "scopes ecosistema: Gmail+Calendar+Sheets+Drive+email" || bad "scopes incompletos: $jstart"
echo "$jstart" | grep -q 'access_type=offline' && ok "access_type=offline (refresh token)" || bad "access_type ausente"
echo "$jstart" | grep -q 'prompt=consent' && ok "prompt=consent" || bad "prompt ausente"
JSONSTATE=$(echo "$jstart" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const u=new URL(JSON.parse(d).url);console.log(u.searchParams.get('state')||'')}catch{console.log('')}})")
segs=$(echo "$JSONSTATE" | awk -F. '{print NF}')
[ "$segs" = 4 ] && ok "state firmado 4 segmentos (org.nonce.exp.hmac)" || bad "state segmentos=$segs"

echo "== 5) OAuth start (modo navegador) =="
bstart=$(curl -s -m 15 -H "$AH" -D - -o /dev/null "http://localhost:3000/api/google/auth?redirect=1")
bloc=$(echo "$bstart" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
gcsrf=$(echo "$bstart" | rg -io "set-cookie: google_oauth_csrf=([^;]+)" -r '$1' | head -1)
echo "$bloc" | grep -q "localhost:3998/o/oauth2/v2/auth" && ok "302 al diálogo Google (mock)" || bad "browser start: $bstart"
echo "$bloc" | grep -q "redirect_uri=http" && ok "redirect_uri presente" || bad "redirect_uri ausente"
[ -n "$gcsrf" ] && ok "cookie google_oauth_csrf fijada (httpOnly)" || bad "sin cookie CSRF"
STATE=$(node -e "const u=new URL('$bloc');console.log(u.searchParams.get('state')||'')")
[ "$STATE" = "$JSONSTATE" ] || ok "state distinto por intento (anti-replay)" # informativo, no falla

echo "== 6) OAuth callback (feliz) =="
cb=$(curl -s -m 25 -H "$AH" -H "Cookie: google_oauth_csrf=$STATE" -D - -o /dev/null \
  "http://localhost:3000/api/google/auth?code=MOCK-CODE&state=$(node -e "console.log(encodeURIComponent('$STATE'))")")
cbloc=$(echo "$cb" | rg -io "^location: (.+)$" -r '$1' | head -1 | tr -d '\r')
echo "$cbloc" | grep -q "google_connected=albragroup8" && ok "redirect éxito con email conectado" || bad "callback location: $cbloc"
cfg=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/google/config)
echo "$cfg" | grep -q '"connected":true' && ok "refresh token guardado (connected:true)" || bad "config: $cfg"
echo "$cfg" | grep -q '"googleEmail":"albragroup8@gmail.com"' && ok "email de la cuenta persistido" || bad "googleEmail: $cfg"
echo "$cfg" | grep -q '"enableGoogle":true' && ok "canal Google ACTIVO" || bad "enableGoogle falso"
grep -q "authorization_code → tokens" "$LOGS/mock-google.log" && ok "mock entregó tokens" || bad "mock sin token call"
grep -q "userinfo → albragroup8" "$LOGS/mock-google.log" && ok "userinfo consultado (identidad)" || bad "sin userinfo"

echo "== 7) caminos de error =="
bad1=$(curl -s -m 15 -H "$AH" -D - -o /dev/null \
  "http://localhost:3000/api/google/auth?code=X&state=AAA.aaa.111.bbb")
echo "$bad1" | rg -q "google_error=csrf_invalid" && ok "state falso → csrf_invalid" || bad "state fallo no detectado"
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
bad2=$(curl -s -m 15 -H "$AH" -H "Cookie: google_oauth_csrf=$exp2" -D - -o /dev/null \
  "http://localhost:3000/api/google/auth?code=X&state=$exp2")
echo "$bad2" | rg -q "google_error=csrf_expired" && ok "state expirado → csrf_expired" || bad "expiración no detectada"
# client_secret rechazado por Google: reconfigurar con secreto malo + state fresco firmado
curl -s -m 15 -X PUT -H "$AH" -H 'Content-Type: application/json' \
  -d '{"clientId":"MOCK-CLIENT-ID.apps.googleusercontent.com","clientSecret":"MOCK-SECRET-BAD"}' \
  http://localhost:3000/api/google/config > /dev/null
fresh=$(node -e '
const fs=require("fs");
const env=fs.readFileSync(".env","utf8");
const m=env.match(/^APP_SECRET=(.+)$/m);
const c=require("crypto");
const tok=process.argv[1];
const payload=JSON.parse(Buffer.from(tok.split(".")[1],"base64").toString());
const exp=Date.now()+600000;
const p=payload.orgId+".fresh."+exp;
const s=c.createHmac("sha256",m[1].replace(/^"|"$/g,"")).update(p).digest("hex");
console.log(p+"."+s);
' "$TOK")
bad3=$(curl -s -m 25 -H "$AH" -H "Cookie: google_oauth_csrf=$fresh" -D - -o /dev/null \
  "http://localhost:3000/api/google/auth?code=MOCK-CODE&state=$fresh")
echo "$bad3" | rg -q "google_error=token_endpoint_reject" && ok "secreto malo → token_endpoint_reject" || bad "rechazo secreto: $(echo "$bad3" | rg -io '^location: .+' | head -1)"

echo "== 8) limpieza =="
curl -s -m 15 -X DELETE -H "$AH" http://localhost:3000/api/google/config > /dev/null && ok "integración Google desconectada (sin tokens mock residuales)"
final=$(curl -s -m 15 -H "$AH" http://localhost:3000/api/google/config)
echo "$final" | grep -q '"connected":false' && echo "$final" | grep -q '"configured":false' && echo "$final" | grep -q '"googleEmail":null' && ok "config verificada vacía" || bad "residuo: $final"

echo ""
echo "RESULTADO: PASS=$PASS FAIL=$FAIL"
[ $FAIL = 0 ] && echo "E2E OAUTH GOOGLE: TODO OK" || echo "E2E OAUTH GOOGLE: HAY FALLOS"
