@echo off
setlocal EnableExtensions

REM =============================================================
REM CloudDX K8s Cluster - MobaXterm session launcher
REM Supports: all / cp / worker / data / single node
REM =============================================================

set "MOBA_PATH=C:\Program Files (x86)\Mobatek\MobaXterm\MobaXterm.exe"
set "SSH_USER=clouddx"

REM Optional key path. If missing, SSH will use default keys/agent.
set "SSH_KEY=%USERPROFILE%\.ssh\id_rsa"
set "SSH_OPTS=-o StrictHostKeyChecking=no -o ConnectTimeout=5"
if exist "%SSH_KEY%" (
  set "SSH_OPTS=%SSH_OPTS% -i %SSH_KEY%"
)

REM Bridge network IPs
set "CP1_IP=192.168.0.220"
set "CP2_IP=192.168.0.221"
set "CP3_IP=192.168.0.222"
set "W1_IP=192.168.0.223"
set "W2_IP=192.168.0.224"
set "W3_IP=192.168.0.225"
set "MONGO_IP=192.168.0.231"
set "MON_IP=192.168.0.230"

set "BOOT_DELAY=4"
set "TAB_DELAY=1"

if not exist "%MOBA_PATH%" (
  echo [ERROR] MobaXterm not found: %MOBA_PATH%
  exit /b 1
)

if "%~1"=="" goto menu
set "MODE=%~1"
goto dispatch

:menu
echo.
echo [CloudDX K8s SSH Launcher]
echo 1^) all       ^(cp + worker + data^)
echo 2^) cp        ^(cp-1, cp-2, cp-3^)
echo 3^) worker    ^(worker1, worker2, worker3^)
echo 4^) data      ^(mongodb, monitoring^)
echo 5^) single    ^(one node^)
echo Q^) quit
choice /C 12345Q /N /M "Select: "
if errorlevel 6 goto end
if errorlevel 5 goto menu_single
if errorlevel 4 set "MODE=data" & goto dispatch
if errorlevel 3 set "MODE=worker" & goto dispatch
if errorlevel 2 set "MODE=cp" & goto dispatch
if errorlevel 1 set "MODE=all" & goto dispatch
goto end

:menu_single
echo.
echo Enter node name: cp-1 ^| cp-2 ^| cp-3 ^| worker1 ^| worker2 ^| worker3 ^| mongodb ^| monitoring
set /p MODE="single> "
if "%MODE%"=="" goto end

:dispatch
if /I "%MODE%"=="all" goto all
if /I "%MODE%"=="cp" goto cp_only
if /I "%MODE%"=="worker" goto worker_only
if /I "%MODE%"=="data" goto data_only
if /I "%MODE%"=="cp-1" goto single_cp1
if /I "%MODE%"=="cp-2" goto single_cp2
if /I "%MODE%"=="cp-3" goto single_cp3
if /I "%MODE%"=="worker1" goto single_w1
if /I "%MODE%"=="worker2" goto single_w2
if /I "%MODE%"=="worker3" goto single_w3
if /I "%MODE%"=="mongodb" goto single_mongo
if /I "%MODE%"=="monitoring" goto single_mon

echo [ERROR] Unknown option: %MODE%
echo Usage: %~n0 [all^|cp^|worker^|data^|cp-1^|cp-2^|cp-3^|worker1^|worker2^|worker3^|mongodb^|monitoring]
goto end

:open
start "" "%MOBA_PATH%" -newtab "ssh %SSH_USER%@%~1 %SSH_OPTS%"
timeout /t %TAB_DELAY% >nul
goto :eof

:all
echo [INFO] Open all cluster nodes...
start "" "%MOBA_PATH%" -newtab "ssh %SSH_USER%@%CP1_IP% %SSH_OPTS%"
timeout /t %BOOT_DELAY% >nul
call :open %CP2_IP%
call :open %CP3_IP%
call :open %W1_IP%
call :open %W2_IP%
call :open %W3_IP%
call :open %MONGO_IP%
call :open %MON_IP%
echo [OK] 8 tabs requested.
goto end

:cp_only
echo [INFO] Open control plane nodes...
start "" "%MOBA_PATH%" -newtab "ssh %SSH_USER%@%CP1_IP% %SSH_OPTS%"
timeout /t %BOOT_DELAY% >nul
call :open %CP2_IP%
call :open %CP3_IP%
echo [OK] CP tabs requested.
goto end

:worker_only
echo [INFO] Open worker nodes...
call :open %W1_IP%
call :open %W2_IP%
call :open %W3_IP%
echo [OK] Worker tabs requested.
goto end

:data_only
echo [INFO] Open data nodes...
call :open %MONGO_IP%
call :open %MON_IP%
echo [OK] Data tabs requested.
goto end

:single_cp1
call :open %CP1_IP%
goto end
:single_cp2
call :open %CP2_IP%
goto end
:single_cp3
call :open %CP3_IP%
goto end
:single_w1
call :open %W1_IP%
goto end
:single_w2
call :open %W2_IP%
goto end
:single_w3
call :open %W3_IP%
goto end
:single_mongo
call :open %MONGO_IP%
goto end
:single_mon
call :open %MON_IP%
goto end

:end
endlocal
