# TUTUM draw.io Page Checklist (On-Prem / K8s / AWS)

작성일: `2026-03-03`  
목적: 토폴로지 다이어그램을 빠르게, 동일한 품질로 작성하기 위한 실무 체크리스트

참조 문서:
- `docs/plans/infra/TOPOLOGY_REFERENCE_GUIDE_2026-03-03.md`

---

## 0. 공통 작성 규칙

## 0-1. 페이지 구성
1. `P1_OnPrem_Current`
2. `P2_K8s_Current`
3. `P3_AWS_Sample`
4. `P4_Network_Security`
5. `P5_Data_Flow_Scenarios`
6. `P6_GitLab_CICD_GitOps`

## 0-2. 선/색상 규칙
- 요청(Request): 파란 실선
- 이벤트(Event/Kafka/Queue): 보라 점선
- 저장(Storage write): 초록 실선
- 배포(Deploy): 주황 실선
- 보안(정책/차단): 빨간 실선

## 0-3. 라벨 규칙
- 모든 주요 화살표에 번호 부여: `F-01`, `D-03`, `CI-02` 같은 형태
- 번호 옆에 동작 단어 표기: `cache-read`, `publish`, `sync`, `archive`
- 외부 서비스는 아이콘 + 도메인/엔드포인트 텍스트 함께 표기

## 0-4. 상태 태그
- 확정 구성: `AS-IS`
- 목표 구성: `TO-BE`
- 진행중: `WIP`

---

## 1. P1_OnPrem_Current 체크리스트

## 1-1. 박스(필수)
- User/Browser
- Edge/LB (on-prem ingress)
- Frontend (Next.js)
- Backend (FastAPI)
- Worker Group (price/news/email/ocr)
- MongoDB
- MariaDB
- Redis
- Kafka
- Elasticsearch/Kibana
- MinIO
- GitLab (Repo/CI/Registry)
- Jira/Slack/Notion

## 1-2. 화살표(필수)
1. User -> Edge -> Frontend
2. Frontend -> Backend API
3. Backend -> MongoDB / MariaDB / Redis
4. Worker(price) -> Kafka -> Worker(consumer) -> Redis
5. Worker(news) -> Kafka -> MongoDB/Elasticsearch
6. OCR worker -> MinIO
7. GitLab CI -> Registry -> Cluster 배포 경로
8. 장애/배포 알림 -> Slack

## 1-3. 검수
- 사용자 요청 경로와 배치/이벤트 경로가 시각적으로 분리되어 있는가
- DB와 캐시의 역할이 분리 표기되어 있는가
- 운영도구(Jira/Slack/Notion/GitLab)가 서비스 경로와 혼동되지 않는가

---

## 2. P2_K8s_Current 체크리스트

## 2-1. 박스(필수)
- Namespace: `tutum-app`, `tutum-data`, `tutum-storage`
- `tutum-app`:
  - frontend deployment/service
  - backend deployment/service
  - workers (price/news/email/ocr/elastic-consumer)
- `tutum-data`:
  - mongodb statefulset
  - redis statefulset
  - kafka statefulset
  - elasticsearch statefulset
  - kibana
- `tutum-storage`:
  - minio statefulset/service

## 2-2. 화살표(필수)
1. ingress/gateway -> frontend
2. frontend -> backend
3. backend -> data services
4. producer -> kafka -> consumer
5. ocr -> minio
6. news-consumer -> mongo/es

## 2-3. 표기(필수)
- 이미지 소스: `registry.gitlab.com/...`
- 보안정책: `Kyverno/Cosign (WIP by cp-2)`
- ingress 계층 혼재 시 `current active path` 별도 강조(예: nginx 또는 istio)

## 2-4. 검수
- namespace 경계가 명확한가
- 서비스 통신 방향이 실제 코드/매니페스트와 일치하는가
- WIP 영역이 명시되어 오해를 막는가

---

## 3. P3_AWS_Sample 체크리스트

## 3-1. 박스(필수)
- Region: `ap-northeast-2`
- VPC (2AZ)
- Public Subnet:
  - ALB
  - Bastion(optional)
- Private Subnet:
  - self-managed k8s nodes
  - data nodes (Mongo/Maria/Redis/Kafka/ES)
- Route53
- ACM
- AWS WAF
- S3
- Glacier
- GitLab (Repo/CI/Registry)

## 3-2. 화살표(필수)
1. User -> Route53 -> ALB(HTTPS)
2. ALB -> WAF -> Ingress -> Frontend/Backend
3. App -> Data layer
4. MinIO -> S3 -> Glacier (lifecycle)
5. GitLab CI -> Registry -> K8s (deploy)

## 3-3. 주석(필수)
- `EKS 미사용, self-managed k8s on EC2` 명시
- Cloudflare Tunnel 비사용 명시
- authoritative DNS: Route53 명시

## 3-4. 검수
- 외부 노출 경계가 단일화되었는가(Route53/ALB/WAF)
- 저장소 계층(MinIO, S3, Glacier) 역할이 분명한가
- 비용포인트(ALB, EC2, S3 lifecycle)가 표시되어 있는가

---

## 4. P4_Network_Security 체크리스트

## 4-1. 박스(필수)
- Public/Private subnet 구획
- SG/NACL
- Ingress Controller
- Secrets path (K8s Secret / GitLab Variables)
- WAF/Web ACL
- 외부 API endpoints (KIS/Upbit/Bedrock/SES 등)

## 4-2. 화살표(필수)
1. Inbound: 443/80
2. Internal service-to-service
3. Egress to external APIs
4. Secret distribution path
5. Block/allow 정책 경로

## 4-3. WIP 태그
- Kyverno policy: WIP
- Cosign verify: WIP
- 네트워크 정책(NetworkPolicy) 적용 상태 표시

## 4-4. 검수
- 최소권한 원칙이 그림에서 확인되는가
- egress 허용 경로가 과다하지 않은가
- 인증/시크릿 경로가 평문으로 노출되지 않는가

---

## 5. P5_Data_Flow_Scenarios 체크리스트

## 5-1. 시나리오 A: 검색
1. User action
2. FE request
3. BE cache read
4. DB lookup
5. external API fallback
6. response + cache update

## 5-2. 시나리오 B: 시세
1. producer poll
2. kafka publish
3. consumer update
4. redis cache write
5. ws/rest serve
6. FE update

## 5-3. 시나리오 C: 뉴스
1. crawl/ingest
2. kafka publish
3. consumer store mongo
4. elastic index
5. recommendation API

## 5-4. 시나리오 D: OCR
1. upload
2. proxy to ocr service
3. minio write
4. parse result
5. asset register flow

## 5-5. 시나리오 E: 회원가입 인증
1. register
2. queue/enqueue
3. email worker
4. ses send
5. verify callback

## 5-6. 검수
- 각 시나리오가 최소 5단계 이상으로 표현되었는가
- 동기/비동기 경계가 라인 스타일로 구분되는가
- 실패/재시도 경로(옵션)가 표시되어 있는가

---

## 6. P6_GitLab_CICD_GitOps 체크리스트

## 6-1. 박스(필수)
- Apps Repo (GitLab)
- GitLab CI stages
- GitLab Registry
- Manifests Repo
- ArgoCD
- K8s Cluster
- Slack/Jira notifications

## 6-2. 파이프라인 단계(필수)
1. guard
2. lint/test
3. scan (sonar/trivy)
4. build/push (registry)
5. sign (cosign, WIP)
6. deploy (manifest update)
7. argocd sync
8. notify

## 6-3. 화살표(필수)
- code push -> pipeline start
- image push -> registry
- manifest update -> argocd sync
- argocd -> cluster rollout
- fail -> slack/jira

## 6-4. 검수
- release tag/rollback 경로가 표시되어 있는가
- develop/main 배포 분기 규칙이 표현되어 있는가
- 보안 스캔/서명 단계가 누락되지 않았는가

---

## 7. 최종 품질 체크 (발표 전)

1. 각 페이지에 제목 + 범례 + 날짜 + 버전이 있는가
2. 모든 핵심 화살표에 번호가 있는가
3. AS-IS/TO-BE/WIP 태그가 일관적인가
4. 팀원이 그림만 보고 운영 흐름을 설명할 수 있는가
5. 사용자 질문(검색/OCR/뉴스/배포/장애)에 즉시 역추적 가능한가

