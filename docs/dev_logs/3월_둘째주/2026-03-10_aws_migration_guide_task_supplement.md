# 개발 로그 작업 요약 (2026-03-10)

## 1. 작업 요약
- 작업 일시: 2026-03-10
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: AWS 마이그레이션 세부 가이드(`AWS_MIGRATION_DETAIL_GUIDE.md`)에 누락된 이전 작업 태스크 보충 및 전체 진행률 정리

---

## 2. 상세 변경 사항

### 변경 파일
- `docs/plans/infra/AWS_MIGRATION_DETAIL_GUIDE.md`

### 추가된 섹션

#### B-16. ArgoCD · KEDA ECR 이미지 미러링
- ArgoCD 이미지 (quay.io) → ECR 미러링 스크립트 작성
- KEDA 이미지 3종 (ghcr.io: keda-operator, metrics-apiserver, admission-webhooks) → ECR 미러링 + Helm upgrade ECR 경로로 재설치 절차
- ArgoCD 컨테이너 이미지 `kubectl set image` 패치 명령 포함
- **필요 배경**: EKS private subnet + VPC Endpoint 환경에서 외부 레지스트리(quay.io/ghcr.io) pull 시 NAT GW 경유 또는 차단 위험 존재

#### B-17. 파이프라인 온프레미스 의존성 체크
- GitLab CI 파이프라인이 온프레미스 K8s API/Harbor에 의존하는 단계 잔존 여부 확인 절차
- EKS GitLab Runner Helm 설치 절차 (`gitlab/gitlab-runner` chart, `eks` 태그)
- `.gitlab-ci.yml`에서 온프레미스 IP·Harbor 참조 grep 체크 명령 포함
- 온프레미스 의존 5개 항목 표로 정리 (GitLab Runner 위치, Harbor 참조, ArgoCD destination, COSIGN 키 등)

#### D-9. MongoDB 독립 VM → EC2 이전
- 독립 VM (192.168.0.231, MongoDB v7.0.30) → EC2 standalone 이전 전체 절차
  1. MongoDB EC2 생성 (t3.large, 100GB gp3, private subnet 10.60.11.x)
  2. MongoDB 전용 SG 생성 (EKS Cluster SG → 27017 inbound)
  3. SSM으로 MongoDB 7.0 설치
  4. 독립 VM mongodump → S3 업로드 → EC2 복원 (mongorestore)
  5. K8s StatefulSet 최신 데이터 EC2 동기화 (선택)
  6. `backend-secret` MONGODB_URL EC2 IP로 변경 + rolling restart

#### D-9-V. LGTM 어드민 페이지 동작 확인
- 파이프라인 정상 동작 후 모니터링 EC2(10.60.11.95) Grafana 검증 절차
- Alloy DaemonSet → Mimir(메트릭) · Loki(로그) 수신 확인 PromQL/LogQL 예시
- Grafana 대시보드 "Kubernetes / Compute Resources / Namespace" tutum-app 지표 확인

#### D-10. Kafka EC2 이전 (Docker Compose)
- K8s StatefulSet KRaft 3-replica → EC2 Docker Compose(단일 브로커 KRaft) 이전 절차
  1. Kafka EC2 생성 (t3.large, 50GB gp3)
  2. Kafka 전용 SG 생성 (EKS → 9092/9093 inbound)
  3. `confluentinc/cp-kafka:7.6.0` Docker Compose 설정 (KRaft 모드, ADVERTISED_LISTENERS EC2 내부 IP)
  4. S3 경유 docker-compose.yml EC2 전달 + `docker compose up`
  5. 온프레미스 토픽 목록 복제 + EC2 Kafka에 동일 토픽 생성
  6. `backend-secret` KAFKA_BOOTSTRAP_SERVERS EC2 IP로 변경
  7. KEDA ScaledObject `bootstrapServers` EC2 IP로 변경 + `kubectl apply`
  8. Consumer 3종 (price/news/elastic-consumer) rolling restart + 로그 확인

#### D-11. 온프레미스 VM 워크로드 마이그레이션 — 누락 항목
- 온프레미스 VM 8대 전체 컴포넌트 → AWS 이전 상태 매핑표 작성 (20개 항목)
- 온프레미스 K8s 리소스 스냅샷 명령어 정리 (`kubectl get all -A -o wide` 등)
- 누락 확인 태스크 (EKS vs 온프레미스 Gap, 외부 의존성 grep 체크, CloudTrail 활성화)
- 즉시 처리 필요 항목 / 데이터 이전 항목 / 파이프라인 연동 항목 / 철수 전 확인 항목 분류

### 기존 섹션 업데이트
- **로드맵 진행률**: Phase별 완료율 수치 추가 (A:63%, B:40%, C:63%, D:24%, E:0%, 전체 35%)
- **마이그레이션 체크리스트 Phase B**: B-16·B-17 관련 항목 3개 추가
- **마이그레이션 체크리스트 Phase D**: D-9·D-10·D-11·LGTM 검증 항목 5개 추가, 기존 Kafka 항목을 EC2 이전으로 변경
- **마이그레이션 진행률 대시보드** 섹션 신규 추가 (문서 맨 끝):
  - Phase별 진행 바 시각화
  - 완료 이정표 날짜별 표
  - 다음 우선 작업 12개 (🔴/🟠/🟡 우선순위 분류)

---

## 3. 작업 중 발생 이슈 및 대응

- **이슈**: 기존 문서에서 Kafka·MongoDB를 "EKS StatefulSet 그대로 이식"으로 계획했으나, 사용자 요청에 따라 EC2 독립 서비스로 변경
  - **대응**: 기존 D-3(Kafka EKS 이식) 섹션은 유지하고, 신규 D-10(Kafka EC2)을 별도 섹션으로 추가하여 선택 가능하도록 구성

- **이슈**: 문서 길이가 25,000 토큰 초과로 Read 도구 offset/limit 분할 필요
  - **대응**: 200줄씩 분할 읽기로 전체 내용 파악 후 편집

---

## 4. 결과

### 검증 항목
- `AWS_MIGRATION_DETAIL_GUIDE.md` 파일 정상 편집 확인
- 신규 섹션 (B-16, B-17, D-9, D-9-V, D-10, D-11) 6개 추가 완료
- 진행률 대시보드 섹션 추가 완료

### 검증 결과
- 문서 총 라인 수: ~2,500줄 (기존 ~1,895줄 → 신규 추가로 증가)
- 체크리스트 전체 항목: 62개 (기존 54개 → 8개 추가)
- 완료 항목: 22개 / 전체 62개 = **35%**

---

## 5. 커밋 로그

```bash
git log --oneline --since="2026-03-10" --until="2026-03-10 23:59:59"
```

---

## 6. 후속 작업/리스크

### 즉시 처리 필요 (블로커)
1. **COSIGN_PRIVATE_KEY GitLab 변수 업데이트** → 파이프라인 차단 해제
2. **GitLab CI 파이프라인 실행** (build → scan → sign → deploy 전 구간)
3. **ArgoCD GitLab 리포 연결** + `staging-app.yaml` destination 변경

### 이번 추가 태스크 실행 순서
1. B-16: ArgoCD/KEDA ECR 미러링 → KEDA Helm upgrade
2. B-17: GitLab Runner EKS 설치 → 온프레미스 runner 비활성화
3. D-9: MongoDB EC2 생성 → 데이터 이전 → backend-secret 변경
4. D-9-V: LGTM Grafana 어드민 페이지 동작 확인
5. D-10: Kafka EC2 생성 → Docker Compose 기동 → Consumer 연결 전환

### 리스크
- Kafka를 단일 브로커 EC2로 전환 시 고가용성 저하 (RF=1) — 스테이징 환경 기준으로 허용 가능, 프로덕션 전환 시 3-broker 구성 재검토 필요
- MongoDB EC2 이전 중 K8s StatefulSet과 EC2 간 데이터 동기화 타이밍 — 이전 완료 직후 즉시 backend rolling restart 권장
