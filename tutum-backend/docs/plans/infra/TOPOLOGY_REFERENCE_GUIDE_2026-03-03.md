# TUTUM Topology Reference Guide (On-Prem / K8s / AWS Sample)

작성일: `2026-03-03`  
작성자: `ruby + codex`  
용도: draw.io 토폴로지(온프렘, k8s, aws sample) 작성 시 공통 기준 문서

---

## 1) 확정 전제 (이번 합의)

1. 소스코드/형상관리/CI-CD/Registry는 **전부 GitLab**
2. GitHub는 사용하지 않음
3. Harbor는 현재 실운영 경로에서 제외(레거시 흔적만 일부 존재)
4. 보안정책(Kyverno/Cosign)은 팀원(`cp-2`)이 진행 중
5. 데이터 저장은 현재 MongoDB + MariaDB
6. 하이브리드 운영을 위해 MinIO는 유지
7. 아카이브는 `MinIO -> S3 -> Glacier` 방향
8. AWS sample은 `self-managed k8s on EC2` 기준 (EKS 미사용 전제)

---

## 2) 기술 스택 정렬표 (AS-IS / TO-BE)

## 2-1. 관리/협업

| 영역 | 기술 | AS-IS | TO-BE | 비고 |
|---|---|---|---|---|
| 이슈/WBS | Jira | 사용중 | 유지 | Epic/Story/Task/Sub-task + Sprint |
| 커뮤니케이션 | Slack | 사용중 | 유지 | 배포/장애/운영 알림 채널 연동 |
| 형상관리/PR | GitLab | 사용중 | 유지 | main/develop/feature + tag 전략 |
| 문서/ADR | Notion | 사용중 | 유지 | 회의록/결정사항/운영 시나리오 |

주의:
- 기존 "GitHub 기반 전략" 레퍼런스는 현재 프로젝트에는 적용하지 않음

## 2-2. 개발 계층

| 영역 | 기술 | AS-IS | TO-BE | 비고 |
|---|---|---|---|---|
| Frontend | Next.js | 사용중 | 유지 | dashboard/portfolio/news/search/chat UI |
| Backend | FastAPI | 사용중 | 유지 | REST API + worker 연동 |
| DB(정형/핵심) | MariaDB | 사용중 | 유지(단계적 AWS 전환 검토) | 인증/계정/트랜잭션 계열 |
| DB(비정형) | MongoDB | 사용중 | 유지(단계적 AWS 전환 검토) | 뉴스/문서/확장 데이터 |
| Cache/Session | Redis | 사용중 | 유지(관리형 전환 후보) | 세션/캐시/레이트리밋 |
| Event Bus | Kafka | 사용중 | 유지 | 뉴스/시세/비동기 파이프라인 |
| Object Storage | MinIO | 사용중 | 유지 + S3 아카이브 | 하이브리드 핵심 |

## 2-3. AWS 확장(후속 단계 후보)

| 영역 | 기술 | AS-IS | TO-BE | 비고 |
|---|---|---|---|---|
| Orchestration | self-managed K8s | 사용중 | 유지 | EKS는 현재 범위 밖 |
| Autoscaling | HPA/KEDA | 일부 사용중 | 강화 | 트래픽/큐 기반 확장 |
| DNS/TLS | Route53 + ACM | 부분 | 목표 | 도메인/인증서 표준화 |
| Edge 보호 | AWS WAF | 미적용 | 목표 | ALB 또는 CloudFront 앞단 |
| Registry | GitLab Registry | 사용중 | 유지 | Harbor 대체 완료 방향 |
| GitOps | Argo CD | 사용중(문서 기준) | 유지 | manifests repo sync |
| Queue/Integration | SQS/EventBridge/Lambda | 일부/검토 | 단계적 적용 | 운영 알림/비동기 |
| AI | Amazon Bedrock | 사용중(기능별) | 유지 | 요약/인사이트 |
| Object Archive | S3/Glacier | 미완성 | 목표 | MinIO 아카이브 목적지 |

## 2-4. 관측/운영/테스트/설계도구

| 영역 | 기술 | AS-IS | TO-BE | 비고 |
|---|---|---|---|---|
| Metrics/Alert | CloudWatch + Prometheus/Grafana | 혼용/부분 | 정합화 | 장애 지표 표준 |
| Logs | EFK(Fluentd/ES/Kibana) | 부분 사용 | 유지/보완 | 장애 분석/행동 분석 |
| Traces | OTel/Tempo | 부분 사용 | 강화 | 요청 경로 추적 |
| Load Test | k6/nGrinder | 미완성 | 목표 | HPA/KEDA 검증 시 필수 |
| UI/UX | Figma | 사용중 | 유지 | 디자인 시스템 |
| Flow 설계 | Cacoo | 사용중 | 유지 | 요구사항/업무 플로우 |
| Infra 도식 | draw.io | 사용중 | 유지 | 토폴로지 산출물 |

---

## 3) DNS / WAF / Cloudflare 설계 결론

질문 요점:
- Route53 중심으로 가면서 WAF 가능?
- 외부노출에 Cloudflare를 반드시 써야 하는가?
- 혼용이 맞는가?

결론:
1. `Route53 + ALB + AWS WAF + ACM` 조합은 가능하고 권장 패턴
2. Cloudflare는 필수 아님
3. Tunnel 리스크를 피하려면 Cloudflare Tunnel은 사용하지 않는 게 맞음
4. authoritative DNS는 한 주체로 단일화 권장

권장안(A):
- `Route53(public hosted zone) -> ALB(HTTPS 종료) -> AWS WAF -> k8s ingress -> frontend/backend`

Cloudflare 사용 시 선택지:
- 선택지 B1: Cloudflare 완전 전면(Proxy/CDN/WAF) + AWS는 origin
- 선택지 B2: Route53/AWS WAF만 사용(운영 단순성 우선)

현재 프로젝트 성격(비용/운영 단순화) 기준 권장:
- **B2 (Route53 + AWS WAF 단일 경계)**

---

## 4) 토폴로지 3종 산출물 범위

draw.io에서 아래 3장을 필수로 작성:

1. **On-Prem Topology (AS-IS)**
2. **K8s Topology (Current)**
3. **AWS Sample Topology (TO-BE Reference)**

추가 권장 3장:
4. Network/Security Policy View
5. Data Flow Scenarios (검색/뉴스/OCR/시세/인증)
6. GitLab CI/CD + GitOps View

---

## 5) On-Prem Topology 기준 요소

## 5-1. 컴포넌트 그룹
1. User/Browser
2. Edge 진입점(LB/Ingress/Proxy)
3. FE(Next.js), BE(FastAPI)
4. Worker(뉴스/시세/OCR/메일)
5. Data(MongoDB/MariaDB/Redis/Kafka/ES/Kibana/MinIO)
6. Ops(Jira/Slack/Notion/GitLab CI)

## 5-2. 표시해야 할 핵심 경로
1. 사용자 요청 경로
2. 비동기 이벤트 경로(Kafka/Queue)
3. 저장 경로(DB/Object)
4. 배포 경로(GitLab -> Registry -> Cluster)
5. 모니터링/알람 경로

---

## 6) K8s Topology 기준 요소 (현재 레포 반영)

## 6-1. Namespace
- `tutum-app`
- `tutum-data`
- `tutum-storage`

## 6-2. App
- frontend, backend
- workers:
  - price-producer / price-consumer
  - news-producer / news-consumer
  - elastic-consumer
  - email-worker
  - ocr (+ service)

## 6-3. Data
- MongoDB StatefulSet
- Redis StatefulSet
- Kafka StatefulSet
- Elasticsearch StatefulSet + Kibana
- MinIO StatefulSet

## 6-4. 배포/레지스트리
- 이미지: `registry.gitlab.com/...`
- CI/CD: GitLab pipeline
- CD: ArgoCD/GitOps 경로(운영 기준)

## 6-5. 보안정책 상태
- Kyverno/Cosign: 진행중(WIP)
- 토폴로지에 WIP 태그 표시 권장

---

## 7) AWS Sample Topology (self-managed k8s on ec2)

## 7-1. 네트워크 구조
1. Region: `ap-northeast-2`
2. VPC 1개
3. AZ 2개
4. Public Subnet:
   - ALB
   - Bastion(옵션)
5. Private Subnet:
   - k8s control-plane/worker
   - data 노드(초기 self-managed)

## 7-2. Edge/Security
1. Route53 Hosted Zone
2. ACM 인증서
3. ALB HTTPS listener
4. AWS WAF Web ACL
5. SG/NACL 최소허용

## 7-3. App/Data
1. K8s app namespace (frontend/backend/workers)
2. Data layer (Mongo/Maria/Redis/Kafka/ES)
3. MinIO 유지
4. S3 아카이브
5. S3 Lifecycle -> Glacier

## 7-4. CI/CD/GitOps
1. GitLab push
2. GitLab CI (lint/test/scan/build/push/deploy)
3. manifests repo update
4. ArgoCD sync

---

## 8) 데이터 이동 시나리오 (상세)

아래 흐름은 발표용/토폴로지용으로 번호를 붙여 도식화한다.

## 8-1. 시나리오 A: 사용자 종목 검색

1. User -> Frontend `/search` 입력
2. Frontend -> `/api/public/*` 또는 `/api/proxy/*`
3. Backend 검색 API 호출
4. Backend:
   - Redis cache 조회
   - 없으면 Mongo/Maria 조회
   - 필요 시 외부 API(KIS/Upbit/Binance 등) 호출
5. 결과 병합/정렬 후 응답
6. 인기/최근 검색어는 캐시 또는 DB에 저장
7. 메트릭/로그/트레이스 기록(관측)

그림 라벨 예:
- `REQ-A1`, `CACHE-HIT`, `CACHE-MISS`, `EXT-A`, `RESP-A`

## 8-2. 시나리오 B: 실시간 시세

1. Price Producer가 외부 시세 source poll
2. Kafka topic publish
3. Price Consumer consume
4. Redis(shared price cache) write
5. Backend `/market/prices/*`, `/market/ws` 제공
6. Frontend quick bar/chart 실시간 반영
7. 지연/실패 지표 모니터링

## 8-3. 시나리오 C: 뉴스 수집/추천

1. News Producer 수집
2. Kafka publish
3. News Consumer 정제 후 Mongo 저장
4. Elastic Consumer 인덱싱(검색용)
5. Backend `/news`, `/news/recommended`
6. 사용자 선호/보유자산 기반 추천 로직 적용

## 8-4. 시나리오 D: OCR 업로드

1. User가 이미지 업로드
2. Frontend proxy(`/api/proxy/import/*`) -> OCR service
3. OCR service:
   - 이미지 MinIO 저장
   - OCR 파싱/구조화
4. 결과를 FE에 반환
5. FE가 자산 등록 플로우(`/assets/bulk`)로 연결
6. 원본/결과는 정책에 따라 MinIO -> S3 아카이브 대상

## 8-5. 시나리오 E: 회원가입/인증

1. Frontend `POST /auth/register`
2. Backend가 인증 작업 enqueue
3. Email worker가 SES 발송
4. User verify 링크 클릭
5. `/auth/verify` 처리 후 계정 활성화
6. 인증 이벤트/오류는 로깅 및 알림 파이프라인으로 전달

---

## 9) MinIO -> S3 -> Glacier 운영 패턴

## 9-1. 목적
- 운영 경로는 MinIO 유지
- 클라우드 내 장기보관/DR/감사 로그는 S3/Glacier 사용

## 9-2. 복제 원칙
1. 단방향 복제(`MinIO -> S3`)
2. 충돌 방지를 위해 원본 권한은 MinIO가 우선
3. 아카이브 정책은 S3 Lifecycle에서 관리

## 9-3. 라이프사이클 예시
1. Day 0~30: S3 Standard
2. Day 31~90: S3 IA
3. Day 91+: Glacier IR/Flexible
4. 장기보존(선택): Deep Archive

## 9-4. 메타데이터 권장
- `x-tutum-source=minio`
- `x-tutum-workload=ocr|profile|backup`
- `x-tutum-created-at=<iso8601>`

---

## 10) GitLab CI/CD + GitOps 상세 흐름

1. 개발자가 GitLab 브랜치에 push
2. CI 단계:
   - guard
   - lint/test
   - scan (sonar/trivy)
   - build/push (GitLab Registry)
   - sign (cosign, 진행중)
   - deploy(manifest repo 갱신)
   - notify(slack/jira)
3. ArgoCD가 manifests 변경 감지
4. k8s rolling update
5. 배포 상태/장애를 모니터링 스택으로 검증

토폴로지에는 "배포 실패 시 롤백" 경로도 포함한다.

---

## 11) draw.io 표기 규칙

## 11-1. 레이어
- L1 User/Client
- L2 DNS/Edge
- L3 Ingress/Gateway
- L4 App Service
- L5 Data/Event
- L6 Ops/Sec/Observability

## 11-2. 선 스타일
- 동기 요청: 파란 실선
- 비동기 이벤트: 보라 점선
- 저장/복제: 녹색 실선
- 배포/운영: 주황 실선
- 보안정책/차단: 빨강 실선

## 11-3. 필수 주석
1. 모든 주요 화살표에 번호
2. 번호별 액션 설명(우측 범례)
3. AS-IS/TO-BE를 색상 또는 라벨로 구분
4. WIP 보안영역(Kyverno/Cosign)은 별도 박스

---

## 12) 페이지별 작성 템플릿 (복붙용)

페이지 A: `On-Prem Current`
- User -> Edge -> FE/BE -> Data + Worker + Ops

페이지 B: `K8s Current`
- namespace 기준 박스 + 서비스 통신 + kafka 이벤트 흐름

페이지 C: `AWS Sample`
- Route53/ALB/WAF/ACM + private k8s + S3/Glacier + GitLab CI/CD

페이지 D: `Network & Security`
- SG/NACL/Ingress/egress 및 외부 API 호출 경로

페이지 E: `Data Flow Scenarios`
- 검색/시세/뉴스/OCR/인증 시퀀스

페이지 F: `CI/CD & GitOps`
- GitLab repo -> pipeline -> registry -> manifests -> ArgoCD -> cluster

---

## 13) 리뷰 체크리스트

1. 사용자 액션에서 저장소까지 경로가 끊기지 않고 보이는가
2. 동기/비동기 경로가 명확히 구분됐는가
3. 보안 경계(DNS/WAF/Ingress/Secret)가 표시됐는가
4. 현재 미완료 영역(Kyverno/Cosign)이 누락되지 않았는가
5. 비용 포인트(ALB, S3, Glacier, 데이터 저장소)가 보이는가

---

## 14) 후속 작업 순서

1. 본 문서 기준으로 draw.io 1차안 작성
2. cp-2 보안정책 반영 리뷰
3. 데이터 파이프라인(Airflow 도입 여부 포함) 최종 결정
4. 확정본을 AWS migration 문서에 반영

