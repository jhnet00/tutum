# TUTUM 통합 문서 (2026-03-04)

## 0) 문서 목적
- 범위: K8s 구조, 현재까지 성과, 전체 시스템, 토폴로지 표, 4인 역할분담, 3/5~3/12 실행 일정
- 기준: **GitLab 단일 운영(소스/CI-CD)**, GitHub 미사용
- AWS 마이그레이션 단일 기준 문서: `docs/plans/infra/AWS_MIGRATION_PLAN_2026-03-03.md`

---

## 1) 전체 시스템 요약

| 레이어 | 현재 구성 | 핵심 목적 |
|---|---|---|
| Frontend | Next.js | 대시보드/포트폴리오/뉴스/관리자 UI |
| Backend | FastAPI + Worker | 인증/OAuth, 자산 API, OCR/뉴스/시세 파이프라인 |
| Data | MongoDB, MariaDB, Redis, Kafka, Elasticsearch, MinIO | 영속/캐시/비동기 이벤트/검색/오브젝트 저장 |
| Observability | LGTM( Loki, Grafana, Tempo, Mimir/Prometheus ) + k6 | 장애 탐지, 성능 추적, 부하 검증 |
| Delivery | GitLab Repo + GitLab CI + ECR + ArgoCD | 빌드/검증/배포 자동화(GitOps) |
| Security | Istio mTLS, NetworkPolicy, Kyverno/Cosign(진행) | 네트워크 격리/배포 무결성 강화 |

---

## 2) K8s 구조 설명

### 2-1. 노드 토폴로지 (물리/VM 기준)

| 구분 | 노드명 | IP | 역할 |
|---|---|---|---|
| Control Plane | cp-1 | 192.168.0.220 | API 기준 노드, 클러스터 제어 |
| Control Plane | cp-2 | 192.168.0.221 | 제어 평면 HA |
| Control Plane | cp-3 | 192.168.0.222 | 제어 평면 HA |
| Worker | worker1 | 192.168.0.223 | 앱 워크로드 |
| Worker | worker2 | 192.168.0.224 | 앱 + 컨슈머 |
| Worker | worker3 | 192.168.0.225 | 데이터/상태성 워크로드 |
| Observability VM | monitoring | 192.168.0.230 | Grafana/Loki/Tempo/Mimir/k6 |
| Data VM | mongodb | 192.168.0.231 | DB 보조/운영용 |

### 2-2. 네임스페이스 토폴로지

| Namespace | 주요 리소스 | 트래픽 방향 | 비고 |
|---|---|---|---|
| `tutum-app` | frontend, backend, price/news/ocr/email workers | Ingress -> FE -> BE -> Data | 서비스 엔트리 |
| `tutum-data` | MongoDB, Redis, Kafka, Elasticsearch, Kibana | App/Worker -> Data | 상태성 데이터 |
| `tutum-storage` | MinIO | App/OCR -> MinIO | 파일 저장 |
| `monitoring` | LGTM stack | Cluster -> Monitoring | 메트릭/로그/트레이스 |
| `argocd` | ArgoCD app controller | GitOps -> Cluster | deploy 자동화 |

### 2-3. 표 기반 K8s 트래픽 토폴로지

| 단계 | 경로 | 목적 |
|---|---|---|
| 1 | User -> Ingress/Gateway | 외부 요청 진입 |
| 2 | Ingress -> Frontend | UI 라우팅 |
| 3 | Frontend -> Backend API | 인증/자산/뉴스/시세 API 처리 |
| 4 | Backend -> Redis/Mongo/MariaDB | 캐시 및 데이터 조회/저장 |
| 5 | Producer -> Kafka -> Consumer | 비동기 파이프라인 처리 |
| 6 | OCR API -> MinIO -> OCR Parser -> Backend | 이미지 OCR 후 자산 데이터 반영 |
| 7 | App/Infra -> LGTM | 장애/성능 관측 |
| 8 | GitLab CI -> ECR -> ArgoCD -> K8s | 배포 파이프라인 |

### 2-4. 한눈에 보는 텍스트 다이어그램

```text
User
 -> Ingress
 -> Frontend(Next.js)
 -> Backend(FastAPI)
    -> Redis / MongoDB / MariaDB
    -> Kafka (price/news events)
    -> MinIO (OCR image/object)
 -> Workers(price/news/ocr/email/elastic-consumer)

Observability:
 App + K8s -> Prom/Mimir + Loki + Tempo -> Grafana

Delivery (GitLab only):
 Commit -> GitLab CI -> ECR -> ArgoCD -> K8s Rollout
```

---

## 3) 지금까지 완료한 핵심 성과 (요약)

| 기간 | 핵심 완료 항목 | 결과 |
|---|---|---|
| 2월 중순~말 | GitHub/Harbor 중심 흐름 제거, GitLab 단일화 + AWS ECR 전환 결정 | 소스/CI-CD 경로 단순화 및 AWS 배포 경로 명확화 |
| 2월 말 | K8s 마이그레이션 안정화(cp/worker 복구, routing 정리) | 서비스 가용성 회복 |
| 2월 말~3월 초 | Admin + Grafana/Loki/메트릭 연동 강화 | 운영 가시성 개선 |
| 3월 3일 | ArgoCD staging/production 분리, cert-manager, 보안정책 진전 | 배포 통제력/보안 기반 강화 |
| 3월 3일 | Redis/Kafka 고가용 구성(복제) 및 k6 검증 | 확장/내결함성 검증 |
| 3월 3일 | OCR 의존성/파서/포트폴리오 소수점 처리 보완 | 사용자 기능 정확도 개선 |

---

## 4) Dev Logs 기반 팀원 4명 역할분담

| 담당 | 주요 역할 | 최근 근거(로그/커밋 성격) |
|---|---|---|
| 김루비 | PM/통합 조율 + 기능 QA + UX 회귀 점검 + 마이그레이션 문서화 | OCR/포트폴리오 보정, AWS 계획서 정리, 병합/파이프라인 안정화 |
| 김경윤 | Backend/Observability/관리자 대시보드 | Admin 지표 복구, Alloy/OTel, backend lint/RBAC/메모리 튜닝 |
| 박성준 | 플랫폼/보안/데이터 인프라 | ArgoCD 분리, Cert-Manager, mTLS/NetworkPolicy/Kyverno, Redis/Kafka 복제, k6 |
| 김정호 | CI 알림/뉴스 파이프라인/운영 문서 | Slack/Jira 알림 파이프라인, news-producer 안정화, CI 구조 정리 |

---

## 5) 3/5~3/12 실행 일정 (AWS Migration + 발표 준비)

### 5-1. 주차 계획

| 주차 | 기간 | AWS Migration 목표 | 발표 준비 목표 |
|---|---|---|---|
| Week 1 | 3/5~3/8 | AWS 기초 인프라 확정(VPC/IAM/ECR/EKS 기본) + GitLab->ECR 배포 경로 검증 | 발표 구조 확정, 토폴로지 1차 완성 |
| Week 2 | 3/9~3/12 | 스테이징 워크로드 이관 리허설 + 관측/보안 체크 + 복구 시나리오 점검 | 데모 시나리오/리허설/최종 슬라이드 완성 |

### 5-2. 일자별 체크포인트

| 날짜 | 마이그레이션 작업 | 발표 준비 작업 | Done 기준 |
|---|---|---|---|
| 3/5(목) | AWS 계정/네트워크/IAM/비용가드레일 확정 | 발표 아젠다 확정(문제-해결-성과) | 공용 체크리스트 승인 |
| 3/6(금) | ECR repo + GitLab CI 변수 + image push 테스트 | K8s 현재구조 슬라이드 초안 | develop 기준 이미지 1회 배포 성공 |
| 3/7(토) | EKS 클러스터/ALB Controller 기본 설치 | On-Prem/K8s/AWS 토폴로지 3종 초안 | `kubectl get nodes` + ingress 기본 확인 |
| 3/8(일) | ArgoCD 앱 연결(staging 우선) | 운영흐름(요청->데이터->관측) 시나리오 문서화 | GitOps sync 기반 앱 기동 |
| 3/9(월) | 앱/워커 일부 이관 리허설(API, OCR 우선) | 데모 시나리오 1차 리허설 | 기능 smoke test 통과 |
| 3/10(화) | MinIO->S3 복제 PoC + S3 lifecycle(Glacier) 검증 | 데이터 흐름 슬라이드/질문리스트 준비 | 비용/보존정책 확인 |
| 3/11(수) | LGTM + CloudWatch 알람 연동 점검 | 장애대응/롤백 시나리오 리허설 | 알람 1회 이상 실수신 확인 |
| 3/12(목) | 전체 점검(E2E + 롤백) | 최종 발표 리허설(시간 측정) | 데모/슬라이드 동결 |

---

## 6) 핵심 포인트 (발표용)
- 우리는 **GitLab 단일체계**로 소스/레지스트리/CI-CD를 통합했고 운영 복잡도를 줄였다.
- K8s는 3CP+3Worker 기반으로 가용성과 역할 분리를 달성했다.
- 관측은 LGTM 중심으로 메트릭/로그/트레이스 통합 가시성을 확보했다.
- AWS 전환은 무리한 전면 교체가 아니라, ECR/EKS 중심의 단계적 이전과 MinIO->S3->Glacier 하이브리드 전략으로 비용/리스크를 통제한다.

---

## 7) 바로 확인할 명령어(멘토링 데모 직전)

```bash
# cluster
kubectl get nodes -o wide
kubectl get pods -A | grep -E "CrashLoopBackOff|Error|Pending"

# app/data/storage
kubectl -n tutum-app get deploy,svc
kubectl -n tutum-data get sts,pods
kubectl -n tutum-storage get sts,pods,svc

# gitlab pipeline (로컬)
git branch --show-current
git log --oneline -10
```
