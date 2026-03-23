# K8S 문서 인덱스 (라인 번호 포함)

> 경로: `docs/plans/infra/K8S_MIGRATION_PLAN.md`, `K8S_CICD_LGTM_SETUP_PLAN.md`, `K8S_TECH_STACK.md`, `K8S_CLUSTER_STRUCTURE_GUIDE.md`

- 목표: 팀원들이 섹션을 **섹션명+라인번호**로 바로 찾을 수 있게 정리
- 라인 이동: `Ctrl+G` (또는 `:번호`)로 바로 이동

## 1) 문서별 빠른 진입

### 1-1. K8S_MIGRATION_PLAN.md

| 주제 | 시작 라인 |
|---|---:|
| AS-IS | 11 |
| TO-BE | 133 |
| 네임스페이스 설계 | 298 |
| 리소스 매핑 | 320 |
| Istio 서비스 메시 | 366 |
| NetworkPolicy | 516 |
| LGTM 스택 | 631 |
| CI/CD 파이프라인 | 898 |
| 아키텍처/배포 흐름(Phase) | 1316 |
| KEDA | 1806 |
| Karpenter | 2026 |
| 운영협업/알림 | 2394 |
| 보안(Trivy/Cosign/Kyverno) | 2600 |
| 부하 테스트 | 2816 |
| MetalLB | 3006 |
| 배포 전략(Canary/Blue-Green) | 3190 |
| Backup/DR | 3421 |
| 참고사항 | 3623 |

### 1-2. K8S_CICD_LGTM_SETUP_PLAN.md

| 주제 | 시작 라인 |
|---|---:|
| 전체 로드맵 | 10 |
| 5대 배치/사양(1-1) | 27 |
| 공통 접속/분담(1-0) | 55 |
| 팀원별 작업분담(1-0-1 ~ 1-0-5) | 65 |
| VM 생성(1-1-1) | 296 |
| 포트포워딩(1-1-2) | 326 |
| 고정 IP(1-1-3) | 410 |
| SSH 확인(1-1-4) | 523 |
| 방화벽(UFW) | 596 |
| VM 간 통신(1-1-6) | 703 |
| 공통셋업(1-2) | 731 |
| Master init(1-3) | 795 |
| Worker join(1-4) | 817 |
| MetalLB(1-6) | 866 |
| Istio 설치(1-8) | 927 |
| Phase 1 완료 검증(1-10/1-11/1-12) | 981 |
| Phase 2(전체) | 1106 |
| GitLab Runner(2-2) | 1186 |
| CI/CD 파이프라인(2-9) | 1537 |
| Phase 2 완료 검증(2-10) | 1749 |
| Phase 3(모니터링) | 1794 |
| Monitoring 구성 검증(3-8) | 2228 |
| E2E 검증 | 2262 |
| 네트워크 포트 정리 | 2287 |
| 주의사항 | 2313 |

### 1-3. K8S_TECH_STACK.md

| 주제 | 시작 라인 |
|---|---:|
| AS-IS/TO-BE 요약 | 7 |
| 한눈에 보기 | 36 |
| 기술 스택 상세 | 80 |
| 클러스터 기반 | 82 |
| 서비스 메시/트래픽 | 91 |
| 오토스케일링 | 99 |
| CI/CD & 보안 | 106 |
| 데이터 레이어 | 119 |
| 모니터링/테스트 | 130 |
| AI | 143 |
| 백업 & DR | 149 |

### 1-4. K8S_CLUSTER_STRUCTURE_GUIDE.md

| 주제 | 시작 라인 |
|---|---:|
| 목적/한눈에 보기 | 1 |
| 물리 PC + VM 배치 | 12 |
| 쿠버네티스 논리 구조 | 23 |
| 노드별 기능 | 37 |
| 트래픽 구조 | 67 |
| 네트워크 운영 원칙 | 80 |
| 브릿지 표준 이유 | 87 |
| 접속 기준(브릿지/NAT) | 92 |
| 팀원 체크리스트 | 116 |
| 장애 시 1차 분류 | 122 |

### 1-5. NODE123_TO_K8S_MIGRATION_RUNBOOK.md

| 주제 | 시작 라인 |
|---|---:|
| 범위/현재 기준 상태 | 9 |
| 이관 아키텍처 매핑 | 33 |
| 단계별 실행 순서(Phase 0~6) | 58 |
| 롤백 계획 | 204 |
| 팀원 역할 분배 | 215 |
| 오늘 우선 작업 | 228 |

### 1-6. APP_MONGO_INTEGRATION_CHECKLIST.md

| 주제 | 시작 라인 |
|---|---:|
| 목적/역할 분담 | 1 |
| 사전 조건 | 24 |
| 작업 순서(시크릿/매니페스트/롤아웃) | 38 |
| 롤백 절차 | 118 |
| 완료 기준/보고 템플릿 | 136 |

---

## 2) 팀 역할별 바로 가기(짧은 체크리스트)

### A. 클러스터/HA 담당
1) `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:55~280` (분담/조정 모드)
2) `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:296~703` (VM/네트워크 기본)
3) `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:731~981` (공통셋업~1-10)
4) `K8S_MIGRATION_PLAN.md:1316~1389` (Phase 1 기준 검증)

### B. CI/CD 담당
1) `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:1106~1749`
2) `docs/plans/infra/K8S_MIGRATION_PLAN.md:898~1140`
3) `docs/plans/infra/K8S_MIGRATION_PLAN.md:2600~2794` (보안 연동)

### C. 모니터링/알림 담당
1) `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:1794~2231`
2) `docs/plans/infra/K8S_MIGRATION_PLAN.md:631~859`
3) `docs/plans/infra/K8S_MIGRATION_PLAN.md:2394~2472`

### D. 아키텍처/운영 정책 담당
1) `docs/plans/infra/K8S_MIGRATION_PLAN.md:42~344`
2) `docs/plans/infra/K8S_MIGRATION_PLAN.md:3421~3623`
3) `K8S_TECH_STACK.md:7~149`

### E. 앱-DB 연동 검증 담당
1) `docs/plans/infra/APP_MONGO_INTEGRATION_CHECKLIST.md:1~166`
2) `docs/plans/infra/NODE123_TO_K8S_MIGRATION_RUNBOOK.md:58~203`

---

## 3) 자주 쓰는 “빠른 검색 키워드”(라인 없이도 찾기 쉬운 용도)

- `Harbor` → `docs/plans/infra/K8S_MIGRATION_PLAN.md:7`, `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:1257`, `docs/plans/infra/K8S_TECH_STACK.md:17`
- `MetalLB` → `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:866~872`, `docs/plans/infra/K8S_MIGRATION_PLAN.md:3006~3159`
- `KEDA` → `docs/plans/infra/K8S_MIGRATION_PLAN.md:1771~1806`, `docs/plans/infra/K8S_TECH_STACK.md:99`
- `조정 모드` → `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:232~280`
- `포트/방화벽` → `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:596~698`, `docs/plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md:2287`

---

## 4) ha-verify 스크립트 사용법

`K8S` 5개 분산 노드 운영에서 **네트워크 가용성/통신/핵심 컴포넌트 상태**를 빠르게 점검하기 위한 보조 스크립트입니다.

- 존재 이유
  - 각 PC의 NAT 포트포워딩 상태, 방화벽 설정, 브릿지 통신을 한 번에 확인
  - 조인/클러스터 상태 점검 전 선행 점검 자동화
  - 분산 작업 충돌(누군가 네트워크를 건드린 경우) 탐지용 빠른 health check

- 파일
  - `scripts/ha-verify.ps1` (Windows/PowerShell)
  - `scripts/ha-verify.sh` (Linux/macOS)

- 사용 예시
  - Windows: `.\ha-verify.ps1`
  - Linux: `./ha-verify.sh`

- 빠른 점검만 원할 때(내부 ping·kubectl 생략)
  - Windows: `.\ha-verify.ps1 -SkipInternalChecks`
  - Linux: `./ha-verify.sh --skip-internal`

- Linux에서 바로 실행하려면 실행권한 필요  
  - `chmod +x scripts/ha-verify.sh`

- 점검 항목
  1. NAT/SSH 접속 포트 체크
  2. 브릿지 내부 IP ping 체크 (`192.168.0.220,221,222,223,224,225,230,231`)
  3. kubectl 핵심 상태 체크 (nodes/ns/pods/services)

### 4-1. ha-verify 결과 공유 템플릿

팀 채널 공유용으로 아래 포맷을 그대로 사용하면 좋습니다.

```text
### ha-verify 결과 (YYYY-MM-DD HH:MM)
- 실행자:
- 실행 노드: (cp1/cp2/cp3/w1/w2/w3/mongodb/monitoring/기타)
- 명령: (ha-verify.ps1 | ha-verify.sh) [--skip-internal]

1) NAT/SSH 포트
- OPEN: 2220,2221,2222,2223,2224,2225,2226,2230
- CLOSED: (없음)

2) 브릿지 Ping
- OK: 192.168.0.220,221,222,223,224,225,230,231 (N/8)
- FAIL: 192.168.0.xxx

3) kubectl 상태
- nodes: Ready=3/3
- namespaces: tutum-app tutum-data tutum-storage monitoring istio-system argocd kyverno
- critical pods: metallb-system/istio-system ingressgateway pod 1개 이상

요약: PASS / FAIL / WARN
실패 원인:
조치:
```

### 4-2. 실패 대응(짧은 기준)

1. `CLOSED` 포트가 있으면
   - 해당 PC의 Windows 방화벽 규칙 확인
   - VirtualBox NAT 포트포워딩 규칙(호스트 IP/port) 재확인
   - 해당 VM의 SSH 데몬(`sshd`) 정상 실행 확인

2. ping 실패 IP가 있으면
   - 브릿지 어댑터 상태 및 VM 내부 고정 IP 재확인
   - 해당 VM이 부팅/네트워크 인터페이스 정상 상태인지 확인

3. kubectl 오류가 있으면
   - 검사 실행 위치가 `cp1`인지 확인 (kubectl context)
   - 해당 Namespace/Pod가 존재하는지(`kubectl get ns`, `kubectl get pods`) 재확인
   - Istio/MetalLB Pod가 CrashLoop일 경우 최근 이벤트 확인 후 로그 분석

