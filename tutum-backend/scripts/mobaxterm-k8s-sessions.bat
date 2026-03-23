@echo off
REM =============================================================
REM CloudDX K8s Cluster - MobaXterm SSH 일괄 접속 스크립트
REM 브릿지 네트워크 (192.168.0.x) 기준
REM =============================================================
REM
REM 사용법:
REM   mobaxterm-k8s-sessions.bat          → 전체 노드 접속 (8개 탭)
REM   mobaxterm-k8s-sessions.bat cp       → Control Plane만 (cp-1,2,3)
REM   mobaxterm-k8s-sessions.bat worker   → Worker만 (worker1,2,3)
REM   mobaxterm-k8s-sessions.bat data     → Data 노드만 (mongodb, monitoring)
REM   mobaxterm-k8s-sessions.bat cp-1     → 개별 노드 접속
REM =============================================================

set MOBA_PATH="C:\Program Files (x86)\Mobatek\MobaXterm\MobaXterm.exe"
set SSH_USER=clouddx
set SSH_KEY=%USERPROFILE%\.ssh\id_rsa

REM --- 브릿지 IP 정의 ---
set CP1_IP=192.168.0.220
set CP2_IP=192.168.0.221
set CP3_IP=192.168.0.222
set W1_IP=192.168.0.223
set W2_IP=192.168.0.224
set W3_IP=192.168.0.225
set MONGO_IP=192.168.0.231
set MON_IP=192.168.0.230

if "%1"=="" goto all
if "%1"=="all" goto all
if "%1"=="cp" goto cp_only
if "%1"=="worker" goto worker_only
if "%1"=="data" goto data_only
if "%1"=="cp-1" goto single_cp1
if "%1"=="cp-2" goto single_cp2
if "%1"=="cp-3" goto single_cp3
if "%1"=="worker1" goto single_w1
if "%1"=="worker2" goto single_w2
if "%1"=="worker3" goto single_w3
if "%1"=="mongodb" goto single_mongo
if "%1"=="monitoring" goto single_mon

echo [ERROR] 알 수 없는 옵션: %1
echo 사용법: %~n0 [all^|cp^|worker^|data^|cp-1^|cp-2^|cp-3^|worker1^|worker2^|worker3^|mongodb^|monitoring]
goto end

:all
echo [INFO] 전체 K8s 클러스터 노드 접속 (8개 탭)...
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP1_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP2_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP3_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W1_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W2_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W3_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%MONGO_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%MON_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] 8개 탭 열기 완료!
goto end

:cp_only
echo [INFO] Control Plane 노드 접속 (3개 탭)...
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP1_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP2_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP3_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] CP 3개 탭 열기 완료!
goto end

:worker_only
echo [INFO] Worker 노드 접속 (3개 탭)...
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W1_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W2_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W3_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] Worker 3개 탭 열기 완료!
goto end

:data_only
echo [INFO] Data 노드 접속 (2개 탭)...
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%MONGO_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
timeout /t 1 >nul
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%MON_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
echo [OK] Data 2개 탭 열기 완료!
goto end

:single_cp1
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP1_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_cp2
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP2_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_cp3
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%CP3_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_w1
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W1_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_w2
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W2_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_w3
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%W3_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_mongo
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%MONGO_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end
:single_mon
start "" %MOBA_PATH% -newtab "ssh %SSH_USER%@%MON_IP% -i %SSH_KEY% -o StrictHostKeyChecking=no"
goto end

:end
