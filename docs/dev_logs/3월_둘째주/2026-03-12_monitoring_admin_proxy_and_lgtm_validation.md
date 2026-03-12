# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-11 ~ 2026-03-12
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: `tutum.my` 장애 복구와 `/admin` 모니터링 데이터 복원을 통해 AWS EKS staging 환경의 frontend proxy, ALB 대상, LGTM 연동 경로를 안정화

## 2. 상세 변경 사항
- `k8s-manifests/overlays/staging/alb-ingress.yaml`
  - `/api/proxy`, `/api/public` 경로를 `frontend-svc`로 라우팅하도록 추가
  - admin 페이지의 `/api/proxy/api/v1/admin/*` 요청이 backend 직행이 아니라 Next proxy를 경유하도록 복구
- `k8s-manifests/overlays/staging/replicas-patch.yaml`
  - frontend 리소스를 `requests cpu 200m / memory 256Mi`, `limits cpu 500m / memory 512Mi`로 상향
  - `exit code 137` 반복과 rollout 중 504 재발을 줄이도록 조정
- `k8s-manifests/overlays/staging/kustomization.yaml`
  - staging overlay가 private-only nodepool 패치를 포함하도록 정리
- `k8s-manifests/overlays/staging/remove-nodeselector-patch.yaml`
  - staging에서 app/data workload가 public-route 노드로 새지 않도록 `nodeSelector` 제거/복원 로직 정리
- `k8s-manifests/overlays/staging/private-nodepools.yaml`
  - `private-general`, `private-system` NodePool을 추가해 `aws-load-balancer-controller`, app, data 워크로드를 private subnet 노드에 고정
- `k8s-manifests/overlays/staging/private-general-nodepool-patch.yaml`
  - `auth`, `backend`, `kafka-exporter`를 `private-general` 노드풀로 고정
- `k8s-manifests/overlays/staging/kafka-startup-probe-patch.yaml`
  - Kafka broker 롤링 시 startup probe 여유를 늘려 관측계 워크로드 재시작 중 연쇄 영향 최소화
- 운영 검증
  - `https://tutum.my/` → `200`
  - `https://tutum.my/api/proxy/api/v1/chat/health` → `200`
  - `https://tutum.my/api/proxy/api/v1/market/prices/stocks?symbols=NVDA` → `200`
  - `https://tutum.my/api/proxy/api/v1/admin/nodes` → `401` (비로그인 기준 정상)
  - `/admin` Overview에서 `RPS`, `P95`, `Error Rate`, API 처리량 그래프, 노드/파드/PVC 카드, Logs 탭 데이터 표시 확인

## 3. 작업 중 발생 이슈 및 대응
- 이슈: frontend pod 교체 시 ALB target group이 이전 pod IP를 계속 참조해 `502`, `504`가 반복 발생
- 대응: frontend 리소스 상향, target group 재동기화, private-only nodepool 고정으로 재발 경로 차단
- 이슈: `/api/proxy` ingress 규칙 부재로 admin API 요청이 backend로 직행하면서 `/admin` 카드가 `N/A`로 표시
- 대응: staging ALB ingress에 `/api/proxy`, `/api/public`를 `frontend-svc`로 명시해 Next proxy 경유 경로 복구
- 이슈: monitoring 데이터는 일부 복구됐지만 traces와 Kafka lag는 여전히 비어 있음
- 대응: 원인 범위를 분리해 traces는 `alloy.monitoring.svc.cluster.local:4317` OTLP export timeout, Kafka lag는 Mimir 미적재로 분류

## 4. 결과
- 검증 항목:
  - `tutum.my` 메인 경로와 주요 API 응답 상태
  - `/admin` Overview 및 Logs 데이터 가시성
  - staging 워크로드의 private-only nodepool 수렴 상태
- 검증 결과:
  - `tutum.my` 메인/차트/채팅/시세 경로는 정상 응답 상태로 복구
  - `/admin` Overview KPI, API 처리량/응답시간 그래프, Logs 탭은 정상 표시
  - `Cluster WARN` 수준으로 운영 가능 상태이며, traces와 Kafka lag는 후속 작업 필요

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-11" --until="2026-03-12 23:59:59"
```

- 관련 커밋:
  - `1b320b7` `fix(staging): restore frontend proxy routing`
  - `1b0ffcd` `fix(staging): raise frontend resources for tutum.my stability`
  - `7407423` `fix(staging): pin workloads to private-only nodepools`
  - `270497a` `fix(staging): pin auth backend exporter to private-general`
  - `3d2da35` `fix(staging): stabilize kafka private-general rollout`
  - `291dc04` `fix(staging): route /api/proxy through frontend ingress`

## 6. 후속 작업/리스크
- `alloy.monitoring.svc.cluster.local:4317` trace export timeout 해소 필요
- Kafka consumer lag metric을 Mimir로 적재하도록 exporter 또는 scrape 경로 점검 필요
- staging live patch가 있더라도 `origin/develop`에 반영하지 않으면 Argo CD self-heal로 원복되므로 문서/매니페스트 동기화가 계속 필요
