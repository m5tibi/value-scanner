@echo off
rem Sportfolio-figyelo inditasa Windowson, automatikus ujrainditassal.
rem Tedd egy parancsikonjat a shell:startup mappaba, hogy a gep inditasakor elinduljon.
title Sportfolio-figyelo
cd /d "%~dp0"
:loop
call npm run sf:listen
echo.
echo Leallt. Ujrainditas 30 masodperc mulva (bezarashoz: Ctrl+C, majd az ablak bezarasa)...
timeout /t 30 /nobreak >nul
goto loop
