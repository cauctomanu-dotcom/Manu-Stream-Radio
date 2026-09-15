@echo off
setlocal
title Manu Stream Radio - Mode diagnostic
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1
echo.
echo ==============================================================
echo   MANU STREAM RADIO - MODE DIAGNOSTIC
echo ==============================================================
echo.
echo Cette fenetre peut rester ouverte pendant le test.
echo Le journal se trouve dans : msr-noexe.log
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-msr.ps1"
echo.
echo Le serveur s'est arrete. Appuie sur une touche pour fermer.
pause >nul
