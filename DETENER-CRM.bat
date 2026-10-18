@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CRM ALBRA - Detener todo
echo.
echo  ============================================================
echo    CRM ALBRA - Detener CRM y Bot de WhatsApp
echo  ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 3000,3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { taskkill /PID $_ /T /F | Out-Null } catch {} }"
echo.
echo  Listo. El CRM y el bot quedaron detenidos.
echo  Para volver a arrancar: doble clic en INICIAR-CRM.bat
echo.
pause
