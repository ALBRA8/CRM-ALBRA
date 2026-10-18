@echo off
chcp 65001 >nul
title CRM ALBRA - Bot WhatsApp (escanea el QR aqui la primera vez)
cd /d "%~dp0..\.."
echo.
echo  ============================================================
echo    BOT DE WHATSAPP - CRM ALBRA
echo  ============================================================
echo.
echo    LA PRIMERA VEZ: escanea el QR que aparece abajo
echo    con tu telefono:
echo.
echo      WhatsApp  ^>  Dispositivos vinculados
echo                ^>  Vincular un dispositivo
echo.
echo    Despues de vincular, esta ventana debe quedarse
echo    abierta (puede minimizarse). No la cierres.
echo    Si un dia pide QR de nuevo, solo escanealo otra vez.
echo  ============================================================
echo.
node src\whatsapp-daemon\daemon.mjs
echo.
echo  [ERROR] El bot se detuvo inesperadamente. Lee el mensaje de arriba.
echo  Si el problema persiste, ejecuta INICIAR-CRM.bat de nuevo.
pause
