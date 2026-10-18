@echo off
chcp 65001 >nul
title CRM ALBRA - Servidor (NO cerrar mientras usas el CRM)
cd /d "%~dp0..\.."
echo.
echo  Servidor del CRM iniciando en http://localhost:3000
echo  Esta ventana puede minimizarse pero NO cerrarse
echo  mientras estes usando el CRM.
echo.
node scripts\ensure-env.mjs
npx next dev -p 3000
echo.
echo  [INFO] El servidor se detuvo. Cierra esta ventana o ejecuta INICIAR-CRM.bat de nuevo.
pause
