@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CRM ALBRA - Actualizar
cd /d "%~dp0"
echo.
echo  ============================================================
echo    CRM ALBRA - Actualizar a la ultima version
echo  ============================================================
echo.
where git >nul 2>nul
if errorlevel 1 goto :sin-git
if not exist ".git" goto :sin-git
echo  Descargando la ultima version desde GitHub...
call git pull
if errorlevel 1 (
  echo  [AVISO] No se pudo descargar. Revisa tu internet e intenta de nuevo.
  pause
  exit /b 1
)
echo  Deteniendo el CRM y el bot para actualizar con seguridad...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3000,3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { taskkill /PID $_ /T /F | Out-Null } catch {} }"
timeout /t 2 /nobreak >nul
echo  Instalando novedades...
call npm install --no-audit --no-fund
call npx prisma db push
echo.
echo  LISTO. Ahora ejecuta INICIAR-CRM.bat para arrancar.
pause
exit /b 0

:sin-git
echo  Este CRM se instalo sin Git (carpeta descargada como ZIP).
echo.
echo  Para actualizarlo:
echo.
echo    1. Entra a github.com/ALBRA8/CRM-ALBRA
echo    2. Boton verde "Code" ^> "Download ZIP" y descomprime la carpeta nueva
echo    3. De tu carpeta ACTUAL copia dentro de la NUEVA:
echo         - la carpeta  db                                  (tus datos)
echo         - el archivo  .env                                (tu configuracion)
echo         - la carpeta  src\whatsapp-daemon\.wa-auth         (sesion de WhatsApp)
echo    4. Doble clic en INICIAR-CRM.bat dentro de la carpeta nueva
echo.
echo  NOTA: si tienes el CRM abierto, cierralo antes con DETENER-CRM.bat
echo.
pause
