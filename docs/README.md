# CloudDX 문서 인덱스

프로젝트 문서를 목적별로 분리해 빠르게 찾을 수 있도록 구성했습니다.

## 디렉토리 구조

- `docs/policies`: 협업 규칙, 작업 순서, 공용 계약 문서
- `docs/project`: 로드맵/프로젝트 개요
- `docs/guides`: 구현·운영 가이드 (AI, OCR, DB, Kafka)
- `docs/plans/infra`: 인프라/마이그레이션 계획
- `docs/work-plans`: 단기 실행 계획(날짜/기능 단위)
- `docs/reports`: 코드 점검/리뷰 리포트
- `docs/dev_logs`: 일일 작업 로그 및 스크린샷
- `docs/ruby`: Ruby 담당 문서(계획/QA/트러블슈팅)
- `docs/assets`: 문서용 이미지/데이터 파일
- `docs/archive/backups`: 백업 파일(`*.bak`)

## 빠른 링크

### 프로젝트/정책
- [프로젝트 로드맵](project/clouddx-roadmap.md)
- [작업 순서](policies/00_WORK_ORDER.md)
- [협업 규칙](policies/00_COLLABORATION_RULES.md)
- [Kafka 계약](policies/09_KAFKA_CONTRACT.md)

### 가이드
- [AI 파이프라인 가이드](guides/AI_PIPELINE_GUIDE.md)
- [AI 가이드](guides/AI_GUIDE.md)
- [OCR 빠른 시작](guides/OCR_QUICKSTART.md)
- [MongoDB 설정 가이드](guides/MONGODB_SETUP_GUIDE.md)
- [Kafka 마이그레이션 가이드](guides/KAFKA_MIGRATION_GUIDE.md)

### 인프라 계획
- [K8S 마이그레이션 계획](plans/infra/K8S_MIGRATION_PLAN.md)
- [K8S CI/CD LGTM 계획](plans/infra/K8S_CICD_LGTM_SETUP_PLAN.md)
- [K8S 기술 스택](plans/infra/K8S_TECH_STACK.md)
- [Kafka 도입 계획](plans/infra/KAFKA_ADOPTION_PLAN.md)
- [DB HA 전략](plans/infra/DB_HA_STRATEGY.md)

### 리포트
- [API Gateway 리뷰](reports/API_GATEWAY_REVIEW.md)
- [코드 리뷰 이슈](reports/CODE_REVIEW_ISSUES.md)
- [코드 리뷰 진행 현황](reports/CODE_REVIEW_PROGRESS.md)
- [코드 이슈 리포트](reports/CODE_ISSUES_REPORT.md)

### 작업 기록
- [작업 계획 모음](work-plans/)
- [개발 로그 가이드](dev_logs/DEV_LOGS_GUIDE.md)
- [개발 로그 목록](dev_logs/)

## 문서 배치 규칙

1. 단기 실행 계획은 `docs/work-plans`에 작성합니다.
2. 완료된 개발 이력은 `docs/dev_logs`에 기록합니다.
3. 장기 참고 문서는 `docs/guides` 또는 `docs/plans/infra`에 둡니다.
4. 백업 파일은 `docs/archive/backups`에만 보관합니다.
