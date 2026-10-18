@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CRM ALBRA - Arranque automatico
cd /d "%~dp0"
set "ROOT=%cd%"
set "ROOTFWD=%ROOT:\=/%"
set "FIRSTRUN=0"
set "NOCURL="

echo.
echo  ============================================================
echo    CRM ALBRA  -  Arranque automatico
echo  ============================================================
echo.

REM ---------- 0) Ya esta corriendo? ----------
where curl >nul 2>nul
if errorlevel 1 set "NOCURL=1"
if not defined NOCURL (
  curl -s -m 2 -o nul http://localhost:3000/api/health >nul 2>nul
  if not errorlevel 1 (
    echo  [INFO] El CRM ya esta corriendo. Abriendo el navegador...
    start "" http://localhost:3000
    goto :resumen
  )
)

REM ---------- 1) Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo  [1/6] Node.js no esta instalado. Instalandolo automaticamente...
  echo        Si Windows pide permisos, responde SI.
  winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  set "PATH=%PATH%;%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs"
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudo instalar Node.js automaticamente.
    echo  Se abrira la pagina de descarga. Instala la version LTS,
    echo  reinicia el PC y vuelve a dar doble clic en este archivo.
    echo.
    start "" https://nodejs.org/es/download
    pause
    exit /b 1
  )
)
for /f "delims=" %%v in ('node -v') do echo  [1/6] Node.js OK - version %%v

REM ---------- 2) Configuracion (.env) ----------
REM (fuera de bloques parentesis para tolerar rutas con espacios o parentesis)
if exist ".env" goto :env-ok
echo  [2/6] Creando configuracion inicial...
> ".env" echo DATABASE_URL="file:%ROOTFWD%/db/custom.db"
>> ".env" echo WHATSAPP_DAEMON_URL="http://localhost:3002"
:env-ok
node scripts\ensure-env.mjs >nul 2>nul
echo  [2/6] Configuracion lista.

REM ---------- 3) Dependencias ----------
if not exist "node_modules\" (
  echo  [3/6] Instalando dependencias por primera vez...
  echo        Toma de 5 a 10 minutos. SOLO LA PRIMERA VEZ.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [ERROR] Fallo la instalacion. Verifica tu internet y ejecuta este archivo de nuevo.
    pause
    exit /b 1
  )
)
echo  [3/6] Dependencias OK.

REM ---------- 4) Base de datos ----------
if not exist "db" mkdir "db"
if not exist "db\custom.db" set "FIRSTRUN=1"
npx prisma db push >nul 2>nul
if errorlevel 1 (
  echo  [AVISO] La base de datos necesita atencion. Si el CRM falla al abrir, ejecuta ACTUALIZAR-CRM.bat
)
echo  [4/6] Base de datos OK.

REM ---------- 5) Bot de WhatsApp ----------
netstat -ano | findstr /C:":3002 " | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  echo  [5/6] Abriendo el BOT de WhatsApp en una ventana aparte...
  start "CRM-BOT-WhatsApp" cmd /c "%~dp0scripts\windows\_crm-bot-whatsapp.cmd"
) else (
  echo  [5/6] El bot de WhatsApp ya estaba corriendo.
)

REM ---------- 6) Servidor del CRM ----------
echo  [6/6] Iniciando el servidor del CRM (ventana minimizada)...
start "CRM-Servidor" /min cmd /c "%~dp0scripts\windows\_crm-servidor.cmd"

REM ---------- Esperar a que el CRM responda ----------
echo.
echo  Esperando a que el CRM este listo (20-60 segundos)...
set /a INTENTOS=0
:esperar
if defined NOCURL (
  timeout /t 20 /nobreak >nul
  goto :listo
)
timeout /t 3 /nobreak >nul
curl -s -m 2 -o nul http://localhost:3000/api/health >nul 2>nul
if not errorlevel 1 goto :listo
set /a INTENTOS+=1
if %INTENTOS% lss 40 goto :esperar
echo  [AVISO] El CRM no respondio en 2 minutos. Abriendo navegador de todos modos...
:listo

REM ---------- Primera vez: crear datos de ejemplo ----------
if "%FIRSTRUN%"=="1" (
  echo  Primera vez detectada: preparando datos de ejemplo...
  if not defined NOCURL curl -s -m 30 -X POST -o nul http://localhost:3000/api/auth/demo >nul 2>nul
)

:resumen
echo.
echo  ============================================================
echo    CRM ALBRA ESTA LISTO
echo  ============================================================
echo.
echo    Direccion  : http://localhost:3000
echo    Cuenta demo: demo@crmalbra.com  /  clave: demo1234
echo.
echo    - Esta ventana ya puede CERRARSE. El CRM sigue corriendo.
echo    - PRIMERA VEZ con WhatsApp: mira la ventana "CRM-BOT-WhatsApp"
echo      y escanea el QR con tu telefono:
echo      WhatsApp ^> Dispositivos vinculados ^> Vincular un dispositivo
echo      Esa ventana debe quedarse abierta (puede minimizarse).
echo    - Para DETENER todo: doble clic en DETENER-CRM.bat
echo.
pause
