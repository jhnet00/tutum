# Tutum 최종 발표 슬라이드 초안 (2026-03-15)

목표:
- `50장 이내` 발표 자료 초안
- `docs/plans/infra` 기준으로 확정된 기술 내용만 반영
- 첨부한 참고 PDF의 일반적인 최종발표 흐름(표지 → 목차 → 문제정의 → 설계 → 구현/검증 → 결과 → 회고/Q&A)에 최대한 맞춘 구성

주요 근거 문서:
- `K8S_MIGRATION_PLAN.md`
- `K8S_TECH_STACK.md`
- `K8S_CICD_LGTM_SETUP_PLAN_2.md`
- `AWS_MIGRATION_PLAN_2026-03-03.md`
- `AWS_MIGRATION_DETAIL_GUIDE.md`
- `ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`
- `APP_MONGO_INTEGRATION_CHECKLIST.md`
- `RUBY_MINIO_SES_OCR_K8S_QA.md`

주의:
- 이 문서는 `슬라이드별 텍스트 원고`다.
- 실제 PPT 제작 시 디자인은 첨부 PDF의 톤과 페이지 구성을 참고하되, `기술 사실`은 이 문서를 우선한다.
- 과장 금지: `온프레미스 완전 철수`, `SonarQube AWS 이전`, `Kafka EC2 이전`, `MinIO 완전 종료`는 아직 완료로 말하면 안 된다.

---

## Slide 01. 표지

제목:
- `Tutum 인프라 현대화 프로젝트`
- `온프레미스 Kubernetes에서 AWS EKS 기반 운영 구조로의 마이그레이션`

부제:
- 기간: `2026.03`
- 팀/발표자 정보는 최종본에서 삽입

발표 포인트:
- 이번 발표는 “기능 개발”보다 `운영 가능한 클라우드 구조로의 전환`에 초점을 둔다.
- 핵심 키워드는 `EKS`, `RDS`, `S3`, `GitOps`, `Observability`, `점진적 Cutover`다.

---

## Slide 02. 목차

본문:
- 1. 프로젝트 배경과 문제 정의
- 2. 기존 인프라(AS-IS) 분석
- 3. 목표 아키텍처(TO-BE)와 기술 선택
- 4. 마이그레이션 실행 내용
- 5. 검증 결과와 현재 상태
- 6. 남은 과제와 결론

발표 포인트:
- 참고 PDF처럼 `문제 → 설계 → 구현 → 검증 → 회고` 흐름을 유지한다.

---

## Slide 03. 프로젝트 한 줄 요약

본문:
- Tutum은 자산 관리/분석 서비스를 운영하는 프로젝트이며, 기존에는 `온프레미스 VirtualBox + kubeadm + 다수 수동 운영 요소`에 의존했다.
- 이번 프로젝트의 목적은 이를 `AWS EKS 중심의 운영 구조`로 전환해 안정성, 배포 일관성, 확장성, 관측 가능성을 확보하는 것이었다.
- 단순 이전이 아니라 `실제 서비스 경로를 AWS 기준으로 정본화`하는 것이 핵심이었다.

발표 포인트:
- “클라우드로 복사”가 아니라 `운영 모델 자체를 재정의`한 프로젝트라는 점을 강조한다.

---

## Slide 04. 프로젝트 배경

본문:
- 기존 환경은 `온프레미스 VM 8대`와 `kubeadm 기반 Kubernetes`를 함께 운영하고 있었다.
- 앱, 데이터, 모니터링, 스토리지, CI/CD 관련 요소가 여러 위치에 분산돼 있었다.
- 운영/배포/장애 대응 시 사람 의존도가 높아 구조적 리스크가 컸다.

발표 포인트:
- 이 슬라이드는 “왜 클라우드 마이그레이션이 필요했는가”에 대한 출발점이다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md`
- `ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`

---

## Slide 05. 기존 인프라 구조 (AS-IS)

본문:
- 인프라: `VirtualBox 8대 (cp1~3, worker1~3, monitoring, mongodb)`
- 클러스터: `kubeadm`, `containerd`, `Calico`, `MetalLB`
- 데이터: `MongoDB Atlas/legacy Mongo`, `MariaDB(학원 서버)`, `Redis`, `Kafka`, `Elasticsearch`, `MinIO`
- 모니터링: `별도 monitoring VM의 Grafana/Loki/Tempo/Mimir/Kiali/InfluxDB`

발표 포인트:
- 이미 Kubernetes는 사용하고 있었지만, `온프레미스 + 수동 운영 + 잔존 레거시`가 얽혀 있었다.

근거 문서:
- `K8S_MIGRATION_PLAN.md`
- `K8S_TECH_STACK.md`
- `ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`

---

## Slide 06. 기존 구조의 문제점

본문:
- 인프라 중복: `온프레미스 live cluster`와 `AWS 대상 구조`가 한동안 병행됨
- 데이터 경로 혼재: `Atlas`, `legacy Mongo VM`, `on-prem K8s Mongo`, `RDS 이전 전 MariaDB 외부 연결`
- 운영 복잡도 증가: `cloudflared`, `MetalLB`, `on-prem monitoring`, `MinIO`, `on-prem runner` 등 잔존
- 완전한 GitOps/Cloud Native 운영으로 보기 어려운 요소가 많았음

발표 포인트:
- 단순히 서버가 많은 게 아니라, `정본(source of truth)`이 분산되어 있었던 것이 가장 큰 문제였다.

---

## Slide 07. 이번 마이그레이션의 목표

본문:
- 앱 정본 경로를 `AWS EKS + RDS + S3 + monitoring EC2` 기준으로 정리
- 배포 파이프라인을 `GitLab SaaS → ECR → ArgoCD → EKS`로 일원화
- 관측/운영 체계를 `LGTM + Grafana Alloy` 기준으로 정리
- 데이터 경로를 `Mongo ReplicaSet`, `RDS`, `S3` 중심으로 재정의
- 온프레 잔존 리소스는 즉시 종료가 아니라 `단계적 shutdown` 기준으로 관리

성공 기준:
- `tutum.my` 핵심 사용자 경로가 AWS 기준으로 정상 동작
- Mongo/MariaDB/object storage/monitoring의 정본 경로가 명확
- 남은 리스크가 문서화되어 있고 shutdown 순서가 정의됨

---

## Slide 08. 핵심 설계 결정 요약

본문:
- 소스/CI는 `GitLab SaaS` 유지
- 이미지 레지스트리는 `ECR` 사용
- 배포 대상은 `EKS`
- 외부 진입은 `Route53 + ALB`, 내부 서비스 메시 기능은 `Istio`
- 모니터링 백엔드는 `전용 EC2`, K8s 내부에는 `Alloy DaemonSet`만 둠
- 스토리지는 `MinIO 유지`가 아니라 장기적으로 `S3` 기준으로 전환

발표 포인트:
- 이 슬라이드는 기술 선택의 최종 합의사항을 한 장에 모아 보여주는 역할이다.

근거 문서:
- `AWS_MIGRATION_PLAN_2026-03-03.md`
- `K8S_MIGRATION_PLAN.md`

---

## Slide 09. 최종 기술 스택

본문:
- 클러스터: `EKS Auto Mode`, `Bottlerocket`, `AWS VPC CNI`
- 배포/운영: `GitLab CI`, `ArgoCD`, `Kustomize`
- 서비스 메시: `Istio`
- 오토스케일링: `KEDA`, `Karpenter(구조 반영)`
- 보안: `Trivy`, `Cosign`, `Kyverno`, `WAF`, `Shield Standard`, `IRSA`, `Secrets Manager`, `KMS`
- 모니터링: `Grafana`, `Loki`, `Tempo`, `Mimir`, `Alloy`, `Kiali`

발표 포인트:
- 참고 PDF와 비슷하게 “한눈에 보는 기술 스택” 한 장을 넣으면 발표 흐름이 안정된다.

근거 문서:
- `K8S_TECH_STACK.md`
- `K8S_MIGRATION_PLAN.md`
- `AWS_MIGRATION_PLAN_2026-03-03.md`

---

## Slide 10. 목표 AWS 아키텍처

본문:
- 단일 VPC: `10.60.0.0/16`
- Public Subnet: `ALB`, `NAT Gateway`
- Private Subnet: `EKS worker`, `monitoring EC2`, `RDS`
- 외부 도메인: `Route53 → ALB → Ingress → Service`
- DB/Storage: `RDS MariaDB`, `EKS Mongo/Redis/Kafka/Elasticsearch`, `S3`

발표 포인트:
- 이 장에서는 큰 그림만 보여주고, 다음 슬라이드들에서 세부 영역을 분리해 설명한다.

근거 문서:
- `AWS_MIGRATION_PLAN_2026-03-03.md`
- `AWS_MIGRATION_DETAIL_GUIDE.md`

---

## Slide 11. 애플리케이션/데이터 네임스페이스 구조

본문:
- `tutum-app`: frontend, backend, auth, ocr, workers
- `tutum-data`: MongoDB, Redis, Kafka, Elasticsearch
- `tutum-storage`: MinIO(on-prem 기준), AWS에서는 S3 중심으로 전환
- `argocd`, `gitlab-runner`, `istio-system`, `keda`, `kyverno` 별도 운영

발표 포인트:
- 서비스 단위보다 `운영 경계`를 기준으로 네임스페이스를 분리한 점을 설명한다.

근거 문서:
- `K8S_MIGRATION_PLAN.md`

---

## Slide 12. CI/CD 및 GitOps 구조

본문:
- `GitLab SaaS`
  → `Lint/Test`
  → `SonarQube`
  → `Trivy`
  → `ECR Push`
  → `Cosign Sign`
  → `Manifest Update`
  → `ArgoCD Sync`
- 결과적으로 배포 기준은 `이미지`가 아니라 `Git manifest`가 된다.

발표 포인트:
- “빌드 성공”과 “배포 반영”을 분리한 GitOps 운영 흐름을 강조한다.

근거 문서:
- `K8S_MIGRATION_PLAN.md`
- `AWS_MIGRATION_PLAN_2026-03-03.md`

---

## Slide 13. 보안 설계

본문:
- 외부 보호: `AWS Shield Standard`, `AWS WAF`, `ACM`, `ALB`
- 내부 보호: `Istio mTLS`, `NetworkPolicy`, `Security Group`
- 시크릿 관리: `AWS Secrets Manager + External Secrets`
- 공급망 보안: `Trivy + Cosign + Kyverno`

발표 포인트:
- 이 프로젝트는 단순 인프라 이전이 아니라 `운영 보안 수준을 한 단계 올린 작업`이라는 점을 설명한다.

---

## Slide 14. Observability 구조

본문:
- K8s 내부: `Grafana Alloy DaemonSet`
- 외부 monitoring EC2: `Grafana`, `Loki`, `Tempo`, `Mimir`, `Kiali`, `InfluxDB`
- 이유: 모니터링 백엔드까지 클러스터 내부에 올리면 리소스 부담이 너무 크기 때문

발표 포인트:
- “왜 LGTM을 EKS 안에 다 올리지 않았는가”를 질문받을 가능성이 높으니 분리 근거를 명확히 말한다.

근거 문서:
- `K8S_MIGRATION_PLAN.md`
- `AWS_MIGRATION_DETAIL_GUIDE.md`

---

## Slide 15. 데이터베이스 전략

본문:
- 회원/인증 데이터: `MariaDB → 최종적으로 RDS`
- 자산/포트폴리오/AI/뉴스 데이터: `MongoDB ReplicaSet`
- 캐시/세션: `Redis`
- 이벤트 처리: `Kafka`
- 검색: `Elasticsearch`

발표 포인트:
- 관계형/문서형 DB를 목적별로 분리한 `하이브리드 DB 전략`을 보여준다.

근거 문서:
- `K8S_MIGRATION_PLAN.md`
- `AWS_MIGRATION_DETAIL_GUIDE.md`

---

## Slide 16. 스토리지 및 백업 전략

본문:
- 기존 object storage: `on-prem MinIO`
- 목표 방향: `S3` 중심 운영
- 백업: MongoDB, MariaDB, Redis, Elasticsearch, etcd를 정책적으로 관리
- 보관 정책: S3/Glacier lifecycle 고려

발표 포인트:
- “데이터를 옮겼다”가 아니라 `백업과 복구 기준까지 클라우드 기준으로 다시 설계했다`고 설명한다.

---

## Slide 17. 전체 마이그레이션 로드맵

본문:
- Phase A: AWS 기반 준비
- Phase B: EKS 및 핵심 addon 이식
- Phase C: CI/CD 전환
- Phase D: 데이터/모니터링/스토리지 cutover
- Phase E: 트래픽 컷오버 및 온프레 철수 판단

발표 포인트:
- 이 장은 전체 일정의 지도 역할을 한다.
- 뒤에서는 “어떤 Phase에서 무엇을 끝냈는지”를 결과 중심으로 보여준다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md`

---

## Slide 18. Phase A-B: AWS 기반 구축 및 EKS 준비

본문:
- VPC, Subnet, NAT, Security Group 설계 확정
- EKS 클러스터 생성 및 기본 운영 기반 확보
- ALB, Ingress, Istio, ArgoCD 등 핵심 기반 이식
- EKS 환경에서 실제 앱 워크로드를 받을 수 있는 상태까지 진입

발표 포인트:
- 이 구간은 “기반 공사” 단계였다.

---

## Slide 19. Phase C: CI/CD 전환

본문:
- GitLab CR 중심 구조에서 `ECR` 중심 구조로 전환
- Docker 이미지 경량화: `Alpine` 기반
- 보안 파이프라인: `Trivy + Cosign`
- 배포 구조: `Manifest 업데이트 → ArgoCD 동기화`

발표 포인트:
- 개발자 경험과 운영 일관성을 함께 개선한 단계라고 설명한다.

근거 문서:
- `AWS_MIGRATION_PLAN_2026-03-03.md`
- `AWS_MIGRATION_DETAIL_GUIDE.md`

---

## Slide 20. 핵심 데이터 마이그레이션 1: MariaDB → RDS

본문:
- 배경: 학원 서버 MariaDB 의존성 제거 필요
- 목표: `EKS Backend → RDS MariaDB`
- 완료 결과:
  - `tutum-mariadb` 생성 완료
  - 데이터 덤프/복원 완료
  - backend secret를 RDS 기준으로 패치 완료

발표 포인트:
- 이 장은 “AWS에서 실제 인증/회원 경로를 담당하는 DB가 생겼다”는 의미가 크다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md` D-5

---

## Slide 21. 핵심 데이터 마이그레이션 2: MongoDB 정본 전환

본문:
- 이전 상태: `Atlas`, `legacy Mongo VM`, `in-cluster Mongo`가 혼재
- 목표: 앱 정본을 `EKS Mongo ReplicaSet`으로 통일
- 완료 결과:
  - Atlas 데이터 merge
  - `backend/auth/ocr/news-consumer` URI cutover 완료
  - 주요 API health 검증 완료

발표 포인트:
- 이 슬라이드가 이번 발표의 핵심 중 하나다.
- “클라우드 이전”의 본질이 `정본 데이터 경로 통일`이라는 점을 강조한다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md` D-9
- `APP_MONGO_INTEGRATION_CHECKLIST.md`

---

## Slide 22. Monitoring 이전: monitoring EC2 기반 LGTM

본문:
- on-prem monitoring VM의 LGTM stack을 AWS monitoring EC2로 이전
- 접근은 SSH가 아니라 `SSM Session Manager`
- Grafana는 외부 공개가 아니라 `SSM 포트포워딩` 방식
- Alloy의 remote_write 대상도 AWS monitoring EC2 기준으로 변경

발표 포인트:
- 관측 체계가 AWS 환경 기준으로 살아 있다는 점을 보여주는 슬라이드다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md` D-5 monitoring 이전 구간
- `K8S_MIGRATION_PLAN.md`

---

## Slide 23. 애플리케이션 경로 기준 현재 상태

본문:
- `frontend/backend/auth/ocr`는 AWS EKS 기준 경로로 동작
- MariaDB는 `RDS`
- MongoDB는 `EKS ReplicaSet`
- Monitoring은 `AWS monitoring EC2`
- Object storage는 `S3 기준` 정리 중이지만 runtime 검증은 일부 남음

발표 포인트:
- 서비스 사용자 입장에서 실제 경로가 어디를 보고 있는지 한 장에 정리한다.

---

## Slide 24. 2026-03-12 기준 라이브 상태 요약

본문:
- AWS에는 `EKS`, `RDS`, `S3`, `monitoring EC2`, `EKS Mongo/Redis/Kafka/Elasticsearch`, `frontend/backend/auth/ocr`가 실제 동작 중
- 동시에 on-prem `cp1~3`, `w1~3`, `monitoring VM`, `mongodb VM`도 아직 일부 live
- 즉, 현재 상태는 `AWS 정본화는 상당 부분 완료`, `온프레 완전 종료는 미완`

발표 포인트:
- 이 장은 솔직하게 현재 상태를 설명하는 슬라이드다.
- 과장하지 않는 것이 신뢰를 만든다.

근거 문서:
- `ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`
- `AWS_MIGRATION_DETAIL_GUIDE.md` D-11

---

## Slide 25. 온프레미스 → AWS 매핑 표

본문 예시:
- control plane → `EKS managed control plane`
- app workloads → `EKS tutum-app`
- MariaDB → `RDS tutum-mariadb`
- monitoring VM → `AWS monitoring EC2`
- object storage → `S3`
- legacy Mongo / old monitoring / cloudflared / MinIO는 정리 대상

발표 포인트:
- 표 형태로 보여주면 발표 듣는 사람이 현재/목표 상태를 바로 비교할 수 있다.

근거 문서:
- `ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`

---

## Slide 26. 검증 결과

본문:
- Mongo cutover 후:
  - `backend 5/5`
  - `auth 2/2`
  - `ocr 1/1`
- 외부 API 검증:
  - `/api/v1/chat/health` → `200`
  - `/api/v1/market/prices/stocks?symbols=NVDA` → `200`
  - `/api/v1/auth/me` → `401` (비로그인 기준 정상)
- RDS 복원 및 secret patch 완료

발표 포인트:
- 수치/상태코드가 들어가면 발표 신뢰도가 올라간다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md`

---

## Slide 27. 운영 자동화 및 확장 전략

본문:
- `KEDA`로 backend/consumer 스케일링
- `Karpenter` 기반 노드 확장 구조 반영
- GitOps로 변경 이력 관리
- 장애/배포/성능은 Grafana와 Slack 중심으로 운영

발표 포인트:
- “이전 후 운영을 어떻게 지속 가능하게 만들었는가”를 보여준다.

근거 문서:
- `K8S_MIGRATION_PLAN.md`
- `K8S_TECH_STACK.md`

---

## Slide 28. 이번 전환으로 얻은 효과

본문:
- 인프라 정본이 AWS 기준으로 정리됨
- 배포 경로가 표준화됨
- 시크릿/보안/관측 체계가 구조화됨
- 데이터 경로와 책임 경계가 더 명확해짐
- 온프레 shutdown 판단 기준이 문서화됨

발표 포인트:
- “기술 나열”이 아니라 `무엇이 개선되었는가`를 말하는 슬라이드다.

---

## Slide 29. 아직 남아 있는 과제

본문:
- on-prem 완전 종료 미완
- `legacy Mongo VM`, `old monitoring VM`, `cloudflared`, `MinIO` 잔존성 확인 필요
- `SonarQube` AWS 이전 여부 미확정
- `Kafka EC2 이전`은 장기 backlog로 분리 가능
- S3 backup/runtime 검증 일부 남음

발표 포인트:
- 완료/미완료를 분리해서 보여주면 발표가 더 설득력 있다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md` D-11, Phase E
- `ONPREM_VM_TO_AWS_MIGRATION_STATUS_2026-03-12.md`

---

## Slide 30. 온프레 shutdown 전략

본문:
- 즉시 종료 금지: `cp1~3`, `w1~3`
- 조건부 종료 가능: `mongodb VM`, `monitoring VM`
- 권장 종료 순서:
  1. `legacy Mongo`
  2. `old monitoring`
  3. `worker`
  4. `control plane`

발표 포인트:
- 이 슬라이드는 운영 안정성을 우선했다는 점을 보여준다.

근거 문서:
- `AWS_MIGRATION_DETAIL_GUIDE.md` D-11

---

## Slide 31. 프로젝트에서 배운 점

본문:
- 마이그레이션은 “인프라 생성”보다 “정본 전환”이 더 어렵다.
- 서비스 이전보다 `secret`, `DNS`, `monitoring`, `legacy dependency` 정리가 더 오래 걸린다.
- 문서화된 체크리스트와 phase 기준이 실제 협업 속도를 높였다.
- 완전 철수는 기술 문제만이 아니라 `운영 검증 문제`다.

발표 포인트:
- 최종발표에서는 항상 기술적 교훈을 한 장으로 정리하는 것이 좋다.

---

## Slide 32. 향후 계획

본문:
- E2E 기준으로 AWS 경로 최종 검증
- S3 / backup / object storage runtime 검증 마무리
- SonarQube 이전 범위 확정
- on-prem shutdown 실행
- 비용 최적화 및 hardening backlog 정리

발표 포인트:
- “이 프로젝트는 끝났지만 운영은 계속된다”는 관점으로 마무리한다.

---

## Slide 33. 결론

본문:
- Tutum은 온프레미스 중심 구조에서 `AWS 중심 운영 구조`로 실질적으로 전환되었다.
- 핵심 앱/DB/모니터링 경로는 AWS 기준으로 상당 부분 정리되었다.
- 남은 과제는 `추가 구축`보다 `잔존 의존성 제거와 종료 판단`에 가깝다.

마무리 한 줄:
- `우리는 서버를 옮긴 것이 아니라, 운영 기준을 AWS로 다시 정의했다.`

---

## Slide 34. Q&A

본문:
- 감사합니다.
- 질문 받겠습니다.

발표 팁:
- 예상 질문:
  - 왜 monitoring은 EKS 내부가 아닌 EC2인가?
  - 왜 MariaDB는 RDS로, Mongo는 EKS ReplicaSet으로 갔는가?
  - 왜 on-prem을 아직 완전히 내리지 않았는가?
  - Kafka EC2 이전은 왜 backlog로 뒀는가?

---

## 발표자 메모: 꼭 지켜야 할 표현

완료로 말해도 되는 것:
- EKS/ECR/ArgoCD 기반 운영 경로 구축
- RDS cutover 완료
- MongoDB 정본을 EKS ReplicaSet으로 전환 완료
- monitoring EC2 기반 LGTM 경로 대부분 복구
- frontend/backend/auth/ocr AWS 경로 동작

완료로 말하면 안 되는 것:
- 온프레미스 완전 철수
- SonarQube AWS 이전
- Kafka EC2 이전
- MinIO 완전 제거
- 모든 runtime 검증 100% 완료

---

## 최종 슬라이드 수 제안

- 본문 34장
- 필요 시 부록 3~5장 추가 가능
- 최종 제출본은 `34~38장` 정도가 가장 안정적
