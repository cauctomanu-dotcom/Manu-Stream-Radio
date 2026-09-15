@echo off
setlocal
title Manu Stream Radio - Recuperation

REM Retire le blocage Internet des fichiers extraits si Windows l'a ajoute.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

REM Lance le serveur local sans EXE tiers ni installation.
start "Manu Stream Radio" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-msr.ps1"
exit /b 0
