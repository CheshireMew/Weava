@echo off
setlocal EnableExtensions
title Weava

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" start %*
set "WEAVA_EXIT_CODE=%ERRORLEVEL%"

if not "%WEAVA_EXIT_CODE%"=="0" (
    echo.
    echo Weava failed to start or exited unexpectedly. See the error above.
    pause
)

endlocal & exit /b %WEAVA_EXIT_CODE%
