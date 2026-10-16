@echo off
setlocal

set "PROJECT_DIR=%~dp0nitro"

where.exe git >nul 2>&1
if errorlevel 1 (
    echo Git is required. Install Git for Windows and run this file again.
    goto error
)

where.exe node >nul 2>&1
if errorlevel 1 (
    echo Node.js 22 or later is required. Install it from https://nodejs.org/
    goto error
)

for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
    echo Could not determine the installed Node.js version.
    goto error
)
if %NODE_MAJOR% LSS 22 (
    echo Node.js 22 or later is required. Installed version: %NODE_MAJOR%
    echo Install it from https://nodejs.org/ and run this file again.
    goto error
)

set "PNPM_VERSION="
where.exe pnpm.cmd >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%V in ('pnpm.cmd --version 2^>nul') do set "PNPM_VERSION=%%V"
)
if not "%PNPM_VERSION%"=="11.9.0" (
    echo Installing the required pnpm version 11.9.0...
    call npm install --global pnpm@11.9.0
    if errorlevel 1 goto error
)

if exist "%PROJECT_DIR%\.git\" goto update
if exist "%PROJECT_DIR%\" (
    echo The destination folder already exists and is not a Git repository:
    echo %PROJECT_DIR%
    goto error
)

call git clone https://github.com/vt2rk2/nitro.git "%PROJECT_DIR%"
if errorlevel 1 goto error
goto install

:update
call git -C "%PROJECT_DIR%" pull --ff-only origin main
if errorlevel 1 goto error

:install
cd /d "%PROJECT_DIR%"
if errorlevel 1 goto error

call pnpm.cmd install
if errorlevel 1 goto error

call pnpm.cmd run build
if errorlevel 1 goto error

call pnpm.cmd run inject -- --branch canary
if errorlevel 1 goto error

echo.
echo Build and Canary injection completed successfully.
pause
exit /b 0

:error
echo.
echo Setup failed. Review the error above.
pause
exit /b 1
