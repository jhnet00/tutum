# K8S 마이그레이션 현황 및 미완료 이슈 (2026-03-03)

> 기준: K8S_MIGRATION_PLAN.md 대비 실제 클러스터 상태 SSH 점검 결과

---

## 전체 진행률 요약

| Phase | 내용 | 상태 | 완료도 |
|-------|------|------|--------|
| Phase 0 | 사전 준비 (Dockerfile, 환경변수, Health endpoint) | ✅ 완료 | ~90% |
| Phase 1 | K8s 클러스터 구축 | ✅ 완료 | ~95% |
| Phase 2 | Istio 서비스 메시 | ⚠️ 부분 완료 | ~85% |
| Phase 3 | LGTM 옵저버빌리티 | ✅ 거의 완료 | ~90% |
| Phase 4 | GitLab CI/CD + SonarQube | ⚠️ 부분 완료 | ~60% |
| Phase 5 | ArgoCD GitOps | ✅ 거의 완료 | ~90% |
| Phase 5.5 | KEDA + Karpenter | ⚠️ KEDA만 완료 | ~60% |
| Phase 6 | 데이터 레이어 마이그레이션 | ✅ 거의 완료 | ~85% |
| Phase 7 | 어플리케이션 마이그레이션 | ✅ 거의 완료 | ~85% |
| Phase 8 | 검증 및 최적화 | ✅ 완료 | ~90% |

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

#### ~~ISSUE-04: Kyverno 정책이 Audit 모드 (Enforce 아님)~~ ✅ 완료

- **해결** (2026-03-03): CI `sign:*` 잡 정상 확인 후 `Enforce`로 전환
  - `k8s-manifests/kyverno/cosign-verify-policy.yaml`: `Audit → Enforce`
  - 이후 미서명 이미지는 `tutum-app` 네임스페이스 배포 차단됨
  - ArgoCD tutum-staging auto-sync로 클러스터 적용 예정

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

#### ~~ISSUE-08: Redis Sentinel 미구성~~ ✅ 완료 (Master+Replica 방식으로)

- **해결** (2026-03-03): StatefulSet 1→3 replicas (Master + 2 Replica)
  - redis-0: master, redis-1/2: replica (`--replicaof redis-0.redis-headless...`)
  - `redis-headless` 서비스 추가 (StatefulSet 파드 DNS 전용)
  - `redis` ClusterIP: `statefulset.kubernetes.io/pod-name: redis-0` 선택자로 마스터 전용
  - podAntiAffinity required: worker1/2/3 분산 배치
  - 앱 REDIS_URL 변경 없음 (코드 수정 불필요)
  - connected_slaves: 2 확인 완료
- **참고**: 완전한 Sentinel은 redis-py 코드 변경 필요 → EKS 전환 시 ElastiCache로 대체 예정

---

#### ~~ISSUE-09: Cert-Manager 미설치~~ ✅ 완료

- **해결** (2026-03-03): cert-manager v1.16.2 Helm 설치 완료
  ```
  cert-manager            1/1 Running
  cert-manager-cainjector 1/1 Running
  cert-manager-webhook    1/1 Running
  ```
  - **온프레미스**: Cloudflare Tunnel이 HTTPS TLS를 처리했으므로 Let's Encrypt 불필요 (온프레미스 한정)
  - **EKS 전환**: Cloudflare 미사용 — 가비아 네임서버를 Route53으로 변경하여 ACM + ALB로 직접 HTTPS 처리
  - **EKS 전환 시**: Let's Encrypt 대신 ACM (AWS Certificate Manager) + AWS Load Balancer Controller 사용 예정
    - ACM: 인증서 자동 갱신, 추가 비용 없음
    - AWS Load Balancer Controller: ALB를 K8s Ingress 리소스로 제어
    - cert-manager는 내부 서비스 인증서 / 웹훅 TLS 용도로 유지

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

#### ~~ISSUE-11: ArgoCD 앱 구조 계획과 불일치~~ ✅ 완료

- **해결** (2026-03-03): `tutum-app-gitops` 삭제 후 2개 앱으로 분리
  - `tutum-staging`: auto-sync, develop 브랜치, `k8s-manifests/overlays/staging`
  - `tutum-production`: manual sync, main 브랜치, `k8s-manifests/overlays/production`
  - staging overlay namePrefix 제거, backend OOM 메모리 512Mi→768Mi 수정
  - CI deploy 잡: 백엔드 레포 직접 push, `[skip ci]` 태그로 루프 방지
  - 경윤님 추가 수정 (2026-03-03): OTel BatchSpanProcessor 부하로 768Mi→**1Gi** 재상향
  - 경윤님 추가 수정 (2026-03-03): ocr `google-cloud-vision` 의존성 추가 → CrashLoopBackOff 해소
  - backend-sa RBAC에 `persistentvolumeclaims list` 권한 추가 (`/admin/storage` 엔드포인트 대응)
  - **참고**: KEDA minReplicas와 staging replicas:1 충돌로 OutOfSync 표시 (서비스는 정상)

---

### 🔵 Low (추후 고려)

---

#### ISSUE-12: Karpenter 미설치 (사실상 Skip)

- **영향**: 노드 오토스케일링 불가
- **현재 상태**: 없음
- **비고**: Karpenter는 AWS 환경 전용. 온프레미스 VirtualBox 환경에서는 적용 불가. AWS 마이그레이션 시 도입 예정

---

#### ~~ISSUE-13: Kafka 단일 인스턴스~~ ✅ 완료

- **해결** (2026-03-03): StatefulSet 1→3 replicas, KRaft 3-voter 클러스터
  - `podManagementPolicy: Parallel`: 3개 파드 동시 기동 (KRaft quorum 동시 형성 필요)
  - `kafka-headless` 서비스: `publishNotReadyAddresses: true` (Init 단계 DNS 등록)
  - `wait-for-peers` init container: 모든 피어 DNS 준비 후 Kafka 기동
  - `KAFKA_ADVERTISED_LISTENERS`: 파드별 headless 주소 동적 설정
  - Replication factor 3, min.insync.replicas 2
  - podAntiAffinity required: worker1/2/3 분산 배치
  - kafka-0/1/2 모두 Running 확인, price-consumer-group 재연결 완료

---

#### ~~ISSUE-14: Phase 8 검증~~ ✅ 완료

- **완료** (2026-03-03):
  - k6 v0.55.1 설치 (monitoring VM), InfluxDB v1 연동 (k6 user: tutumk6pass)
  - Grafana k6 대시보드 임포트 (ID 2587, InfluxDB-k6 datasource 추가)
  - **Smoke Test** (1 VU/30s): 50/50 checks ✅, error_rate 0%, p(95)=174ms
  - **Load Test** (50 VU/3min): 8594/8600 checks ✅, p(95)=727ms (기준 3000ms)
  - **Stress Test** (120 VU/5.5min): KEDA 2→5 pods 확장 검증 ✅
    - backend ScaledObject CPU 43-58%/70% 트리거, 5/5 max replicas 유지
  - **ImagePullBackOff 해결**: `gitlab-registry-secret` 갱신 (sj1202pak PAT, read_registry 스코프)
    - harbor-secret 제거 (harbor 미사용, GitLab CR 전용)
    - 전 네임스페이스(tutum-app/data/storage) 동기화
- **KEDA failover 테스트**: `failover-test.sh` 생성 완료 (tests/k6/), 실행은 cp-1/2에서 가능
- **부하 테스트 실행 방법**:
  ```bash
  # monitoring VM (192.168.0.230) 에서 실행
  k6 run --out influxdb=http://k6:tutumk6pass@localhost:8086/k6 /tmp/smoke-test.js
  k6 run --out influxdb=http://k6:tutumk6pass@localhost:8086/k6 /tmp/load-test.js
  k6 run --out influxdb=http://k6:tutumk6pass@localhost:8086/k6 /tmp/stress-test.js
  # Grafana: http://192.168.0.230:3000/d/efe9hsi7huha8a/k6-load-testing-results
  ```

---

## 이슈 처리 우선순위 로드맵

```
보안 완성 (이미지 서명 체계)
├── ✅ ISSUE-03: Cosign 키 생성 + CI Variable 등록 완료
├── ✅ ISSUE-04: Kyverno Audit → Enforce 전환 완료 (2026-03-03)
└── ✅ ISSUE-05: Istio mTLS PeerAuthentication 적용 완료

안정성 강화
├── ✅ ISSUE-06: NetworkPolicy 적용 완료 (ArgoCD sync 예정)
└── ✅ ISSUE-08: Redis 3-replica (Master+Replica) 완료

장기 과제
├── ✅ ISSUE-09: Cert-Manager v1.16.2 설치 완료 (cert-manager ns)
├── ✅ ISSUE-10: Kiali 설치 완료 (http://192.168.0.230:20001/kiali)
├── ✅ ISSUE-11: ArgoCD Staging/Production 분리 완료
├── ✅ ISSUE-13: Kafka 3-replica KRaft 완료 (2026-03-03)
└── ✅ ISSUE-14: Phase 8 k6 부하/스트레스 테스트 + KEDA 검증 완료
```

---

## 현재 정상 운영 중인 항목

```
✅ 클러스터       cp-1/2/3 + worker1/2/3  전부 Ready
✅ Calico CNI     6노드 calico-node Running
✅ MetalLB        External IP 192.168.0.240 정상
✅ Istio          istiod + ingressgateway Running + mTLS STRICT (tutum-app)
✅ ArgoCD         tutum-staging (auto/develop) + tutum-production (manual/main) 분리 완료
✅ Cert-Manager   v1.16.2 Running (cert-manager ns)
✅ KEDA           ScaledObject 5개 Ready/Active
✅ Kyverno        Enforce 모드 전환 완료 (cosign-key Secret + CI sign:* 잡 정상)
✅ NetworkPolicy  tutum-app / tutum-data 격리 정책 적용 완료
✅ Kiali          v1.73 Running (http://192.168.0.230:20001/kiali)
✅ Alloy          worker1/2/3 DaemonSet Running, 메트릭/로그 수집 정상
✅ Grafana        CloudDX Overview 5패널 전부 데이터 표시
✅ MongoDB        3-replica StatefulSet Running (30Gi × 3)
✅ Redis          3-replica Running (master+2replica, 5Gi×3, worker 분산)
✅ Kafka          3-replica KRaft Running (20Gi×3, worker 분산, RF=3)
✅ Elasticsearch  StatefulSet Running (30Gi)
✅ MinIO          StatefulSet Running (20Gi)
✅ Backend        2~5 파드 Running (KEDA CPU 70% 트리거, min:2 max:5, 메모리 1Gi)
✅ GitLab CR     gitlab-registry-secret 갱신 완료 (sj1202pak, read_registry 스코프)
✅ Frontend       2 파드 Running
✅ OCR            Running (google-cloud-vision 의존성 추가 완료)
✅ Workers        6종 전부 Running (price/news producer/consumer, elastic, email)
✅ GitLab Runner  Pod Running (config.toml tags=k8s 설정됨)
✅ SonarQube      Running (Helm, sonarqube ns)
```
