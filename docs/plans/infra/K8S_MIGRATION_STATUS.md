# K8S 마이그레이션 현황 및 미완료 이슈 (2026-03-03)

> 기준: K8S_MIGRATION_PLAN.md 대비 실제 클러스터 상태 SSH 점검 결과

---

## 전체 진행률 요약

| Phase | 내용 | 상태 | 완료도 |
|-------|------|------|--------|
| Phase 0 | 사전 준비 (Dockerfile, 환경변수, Health endpoint) | ✅ 완료 | ~90% |
| Phase 1 | K8s 클러스터 구축 | ✅ 완료 | ~95% |
| Phase 2 | Istio 서비스 메시 | ⚠️ 부분 완료 | ~70% |
| Phase 3 | LGTM 옵저버빌리티 | ✅ 거의 완료 | ~85% |
| Phase 4 | GitLab CI/CD + SonarQube | ⚠️ 부분 완료 | ~60% |
| Phase 5 | ArgoCD GitOps | ⚠️ 부분 완료 | ~70% |
| Phase 5.5 | KEDA + Karpenter | ⚠️ KEDA만 완료 | ~60% |
| Phase 6 | 데이터 레이어 마이그레이션 | ✅ 거의 완료 | ~85% |
| Phase 7 | 어플리케이션 마이그레이션 | ✅ 거의 완료 | ~85% |
| Phase 8 | 검증 및 최적화 | ❌ 미시작 | ~0% |

---

## 미완료 이슈 목록

### 🔴 Critical (파이프라인/배포 차단)

---

#### ~~ISSUE-01: ArgoCD OutOfSync — news-producer Deployment 패치 실패~~ ✅ 완료

- **원인**: ruby-backup0225 브랜치의 `value:` 방식 env가 develop 브랜치의 `valueFrom:` 방식과 충돌
- **해결**: `kubectl delete deployment news-producer -n tutum-app` 후 ArgoCD force sync 적용
- **결과**: `tutum-app-gitops` Synced / Healthy / Succeeded, news-producer 재생성 Running 확인
- **처리일**: 2026-03-03

---

#### ~~ISSUE-02: GitLab Runner k8s 태그 없음~~ ✅ 완료

- `RUNNER_TAG_LIST` 환경변수는 비어있으나, ConfigMap의 `config.toml`에 `tags = "k8s"` 직접 설정됨
- 파이프라인 정상 실행 확인됨
- **결론**: 정상 운영 중

---

### 🟡 High (보안/안정성 미완성)

---

#### ~~ISSUE-03: Cosign 키 미생성 / CI Variable 미설정~~ ⚠️ 부분 완료

- **완료된 작업** (2026-03-03):
  - cosign v2.4.3 다운로드 및 키 쌍 생성 완료 (cp-2)
  - `cosign-key` K8s Secret 생성 완료 (`tutum-app` 네임스페이스)
  - `k8s-manifests/kyverno/cosign-verify-policy.yaml` publicKeys 업데이트 완료
- **남은 작업** (사용자 직접 설정 필요):
  - GitLab CI Variable `COSIGN_PRIVATE_KEY` 등록 (Type: File, cosign.key 내용)
  - GitLab CI Variable `COSIGN_PASSWORD` 등록 (값: tutum123)
  - 위 변수 등록 후 CI 파이프라인의 `sign:*` 잡 동작 확인 필요

---

#### ISSUE-04: Kyverno 정책이 Audit 모드 (Enforce 아님)

- **영향**: 미서명 이미지 배포 시 차단되지 않고 경고만 발생
- **현재 상태**: `validateAction: Audit` (미서명 이미지 배포 허용)
- **해결 방법**: Cosign 키 설정 완료 후 `Enforce`로 전환
  ```yaml
  # k8s-manifests/kyverno/cosign-verify-policy.yaml
  spec:
    validationFailureAction: Enforce  # Audit → Enforce
  ```
  > ⚠️ Enforce 전환 전에 현재 실행 중인 이미지 전부 서명 완료 필수

---

#### ~~ISSUE-05: Istio mTLS PeerAuthentication 없음~~ ✅ 완료

- **해결** (2026-03-03): `k8s-manifests/base/ingress/peer-authentication.yaml` 생성 완료
  - mTLS STRICT 모드로 tutum-app 네임스페이스 적용
  - kustomization.yaml에 추가 완료 → ArgoCD develop 브랜치 sync 예정

---

#### ~~ISSUE-06: NetworkPolicy 없음 (tutum-app/tutum-data)~~ ✅ 완료

- **해결** (2026-03-03): `k8s-manifests/base/security/network-policy.yaml` 생성 완료
  - `tutum-data`: default-deny-ingress + allow-from-tutum-app + allow-from-monitoring + allow-intra-namespace
  - `tutum-app`: default-deny-ingress + allow-from-istio + allow-from-monitoring + allow-intra-namespace
  - kustomization.yaml에 추가 완료 → ArgoCD develop 브랜치 sync 예정

---

### 🟠 Medium (기능 미완성)

---

#### ~~ISSUE-07: Slack/Jira 알림 미연동~~ ✅ 완료

- **Grafana**: `slack-alerts` Contact Point 설정 완료, 기본 알림 수신자로 지정
- **GitLab CI**: `SLACK_WEBHOOK_URL`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` CI Variable 등록 완료
- **결론**: 정상 운영 중

---

#### ISSUE-08: Redis Sentinel 미구성

- **영향**: Redis 단일 장애점 존재 (redis-0 장애 시 전체 캐시 불가)
- **현재 상태**: Redis StatefulSet 1-replica만 운영 중 (PVC 5Gi)
- **계획 목표**: Redis Sentinel 3-replica
- **해결 방법**: `k8s-manifests/base/data/redis.yaml` StatefulSet 3-replica 전환 + Sentinel 배포

---

#### ISSUE-09: Cert-Manager 미설치

- **영향**: TLS 인증서 자동 발급/갱신 불가 (HTTPS 게이트웨이 설정 시 필요)
- **현재 상태**: Istio Gateway가 HTTP(port 80)만 운영 중, HTTPS 미적용
- **해결 방법**:
  ```bash
  helm install cert-manager jetstack/cert-manager \
    --namespace cert-manager --create-namespace \
    --set installCRDs=true
  ```

---

#### ~~ISSUE-10: Kiali 미설치~~ ✅ 완료

- **해결** (2026-03-03): Monitoring VM Docker Compose에 Kiali v1.73 컨테이너 추가 완료
  - 접속 URL: `http://192.168.0.230:20001/kiali`
  - 인증 없음 (anonymous 모드)
  - Prometheus: Mimir 연동 (`http://mimir:9009/prometheus`)
  - Grafana 연동: `http://192.168.0.230:3000`
  - 구성: fake in-cluster config (SA token + CA cert 마운트, KUBERNETES_SERVICE_HOST/PORT 환경변수)
  - K8s SA: `monitoring/kiali` ClusterRole + ClusterRoleBinding 적용 완료

---

#### ISSUE-11: ArgoCD 앱 구조 계획과 불일치

- **영향**: Staging/Production 환경 분리 미완성
- **현재 상태**: `tutum-app-gitops` 단일 앱 (k8s-manifests/base 감시)
- **계획 목표**: `tutum-staging` (Auto sync) + `tutum-production` (Manual sync)
- **해결 방법**: Kustomize overlay 구조 활성화 후 ArgoCD 앱 2개로 분리

---

### 🔵 Low (추후 고려)

---

#### ISSUE-12: Karpenter 미설치 (사실상 Skip)

- **영향**: 노드 오토스케일링 불가
- **현재 상태**: 없음
- **비고**: Karpenter는 AWS 환경 전용. 온프레미스 VirtualBox 환경에서는 적용 불가. AWS 마이그레이션 시 도입 예정

---

#### ISSUE-13: Kafka 단일 인스턴스

- **영향**: Kafka 장애 시 전체 이벤트 파이프라인 중단
- **현재 상태**: kafka-0 1개 (PVC 20Gi)
- **계획 목표**: 추후 3-replica KRaft 클러스터
- **해결 방법**: Kafka StatefulSet 3-replica 전환 (디스크 용량 확인 필요)

---

#### ISSUE-14: Phase 8 검증 미시작

- E2E 테스트 시나리오 미실시
- k6 부하 테스트 미실시
- 장애 시나리오 / Pod/Node 강제종료 복구 테스트 미실시
- KEDA Scale-to-Zero / Scale-from-Zero 동작 검증 미실시

---

## 이슈 처리 우선순위 로드맵

```
보안 완성 (이미지 서명 체계)
├── ISSUE-03: Cosign 키 생성 + CI Variable 등록
├── ISSUE-04: Kyverno Audit → Enforce 전환 (03 완료 후)
└── ISSUE-05: Istio mTLS PeerAuthentication 적용

안정성 강화
├── ISSUE-06: NetworkPolicy 적용 (tutum-app/tutum-data)
└── ISSUE-08: Redis Sentinel 구성

장기 과제
├── ISSUE-09: Cert-Manager + HTTPS 전환
├── ISSUE-10: Kiali 설치
├── ISSUE-11: ArgoCD Staging/Production 분리
├── ISSUE-13: Kafka 3-replica 전환
└── ISSUE-14: Phase 8 검증 및 부하 테스트
```

---

## 현재 정상 운영 중인 항목

```
✅ 클러스터       cp-1/2/3 + worker1/2/3  전부 Ready
✅ Calico CNI     6노드 calico-node Running
✅ MetalLB        External IP 192.168.0.240 정상
✅ Istio          istiod + ingressgateway Running
✅ ArgoCD         develop 브랜치 auto-sync 설정됨 (OutOfSync 이슈 제외)
✅ KEDA           ScaledObject 5개 Ready/Active
✅ Kyverno        Audit 모드로 동작 중
✅ Alloy          worker1/2/3 DaemonSet Running, 메트릭/로그 수집 정상
✅ Grafana        CloudDX Overview 5패널 전부 데이터 표시
✅ MongoDB        3-replica StatefulSet Running (30Gi × 3)
✅ Redis          StatefulSet Running (5Gi)
✅ Kafka          StatefulSet Running (20Gi)
✅ Elasticsearch  StatefulSet Running (30Gi)
✅ MinIO          StatefulSet Running (20Gi)
✅ Backend        3 파드 Running
✅ Frontend       2 파드 Running
✅ Workers        6종 전부 Running (price/news producer/consumer, elastic, email)
✅ GitLab Runner  Pod Running (태그 설정만 필요)
✅ SonarQube      시작 중 (Running, 초기화 대기)
```
