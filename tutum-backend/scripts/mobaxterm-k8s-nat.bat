@echo off
REM =============================================================
REM CloudDX K8s Cluster - MobaXterm SSH 접속 (NAT 포트포워딩 버전)
REM 브릿지가 안 될 때 사용 (호스트 IP + NAT 포트)
REM =============================================================
REM
REM 사용법:
REM   mobaxterm-k8s-nat.bat          → 전체 노드 접속
REM   mobaxterm-k8s-nat.bat cp       → Control Plane만
REM   mobaxterm-k8s-nat.bat cp-1     → 개별 노드 접속
REM =============================================================

set MOBA_PATH="C:\Program Files (x86)\Mobatek\MobaXterm\MobaXterm.exe"
set SSH_USER=clouddx
set SSH_KEY=%USERPROFILE%\.ssh\id_rsa

REM --- 호스트 PC IP + NAT 포트 ---
REM 서버 PC(1): cp-1=2220, monitoring=2230
set CP1_HOST=192.168.0.28
set CP1_PORT=2220
set MON_HOST=192.168.0.28
set MON_PORT=2230

REM 팀원 PC(2) 박성준: cp-2=2221
set CP2_HOST=192.168.0.13
set CP2_PORT=2221

REM 팀원 PC(3) 김루비: cp-3=2222
set CP3_HOST=192.168.0.98
set CP3_PORT=2222

REM 팀원 PC(4) 김경윤: worker1=2223, mongodb=2224
set W1_HOST=192.168.0.3
set W1_PORT=2223
set MONGO_HOST=192.168.0.3
set MONGO_PORT=2224

REM 팀원 PC(5) 김정호: worker2=2225, worker3=2226
set W2_HOST=192.168.0.14
set W2_PORT=2225
set W3_HOST=192.168.0.14
set W3_PORT=2226

if "%1"=="" goto all
if "%1"=="all" goto all
if "%1"=="cp" goto cp_only
if "%1"=="worker" goto worker_only
if "%1"=="cp-1" goto single_cp1
if "%1"=="cp-2" goto single_cp2
if "%1"=="cp-3" goto single_cp3
if "%1"=="worker1" goto single_w1
if "%1"=="worker2" goto single_w2
if "%1"=="worker3" goto single_w3
if "%1"=="mongodb" goto single_mongo
if "%1"=="monitoring" goto single_mon
echo [ERROR] 알 수 없는 옵션: %1
goto end

:all
echo [INFO] 전체 노드 NAT 접속 (8개 탭)...
start "" %MOBA_PATH% -newtab "ssh -p %CP1_PORT% %SSH_USER%@%CP1_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %CP2_PORT% %SSH_USER%@%CP2_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %CP3_PORT% %SSH_USER%@%CP3_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %W1_PORT% %SSH_USER%@%W1_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %W2_PORT% %SSH_USER%@%W2_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %W3_PORT% %SSH_USER%@%W3_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %MONGO_PORT% %SSH_USER%@%MONGO_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %MON_PORT% %SSH_USER%@%MON_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] 8개 탭 열기 완료!
goto end

:cp_only
echo [INFO] Control Plane NAT 접속 (3개 탭)...
start "" %MOBA_PATH% -newtab "ssh -p %CP1_PORT% %SSH_USER%@%CP1_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %CP2_PORT% %SSH_USER%@%CP2_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %CP3_PORT% %SSH_USER%@%CP3_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] CP 3개 탭 열기 완료!
goto end

:worker_only
echo [INFO] Worker NAT 접속 (3개 탭)...
start "" %MOBA_PATH% -newtab "ssh -p %W1_PORT% %SSH_USER%@%W1_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %W2_PORT% %SSH_USER%@%W2_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh -p %W3_PORT% %SSH_USER%@%W3_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] Worker 3개 탭 열기 완료!
goto end

:single_cp1
start "" %MOBA_PATH% -newtab "ssh -p %CP1_PORT% %SSH_USER%@%CP1_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_cp2
start "" %MOBA_PATH% -newtab "ssh -p %CP2_PORT% %SSH_USER%@%CP2_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_cp3
start "" %MOBA_PATH% -newtab "ssh -p %CP3_PORT% %SSH_USER%@%CP3_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_w1
start "" %MOBA_PATH% -newtab "ssh -p %W1_PORT% %SSH_USER%@%W1_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_w2
start "" %MOBA_PATH% -newtab "ssh -p %W2_PORT% %SSH_USER%@%W2_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_w3
start "" %MOBA_PATH% -newtab "ssh -p %W3_PORT% %SSH_USER%@%W3_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_mongo
start "" %MOBA_PATH% -newtab "ssh -p %MONGO_PORT% %SSH_USER%@%MONGO_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_mon
start "" %MOBA_PATH% -newtab "ssh -p %MON_PORT% %SSH_USER%@%MON_HOST% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end

:end
