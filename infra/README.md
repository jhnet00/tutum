# CloudDX Infra

인프라 관련 설정 파일을 관리하는 디렉토리입니다.
개발/검증용 Compose와 운영 참고용 Harbor/Kibana 설정이 포함되어 있습니다.

## 구성

- `infra/docker-compose.minio.yml`: MinIO 단독 실행 및 버킷 초기화
- `infra/harbor/`: Harbor 설치/참고 파일
- `infra/kibana/`: Kibana 설정 파일

## MinIO 실행 (로컬/개발)

```bash
docker compose -f infra/docker-compose.minio.yml up -d
```

기본 포트:

- API: `9000`
- Console: `9001`

기본 버킷 초기화:

- `ocr-images`
- `profile-images`

## Harbor 참고

운영 환경에서는 `infra/harbor/INSTALL.md`의 절차대로 공식 설치 방식을 권장합니다.
`infra/harbor/docker-compose.yml`은 개발/테스트 참고용입니다.

## Kibana 참고

- 설정 파일: `infra/kibana/kibana.yml`
- Elasticsearch 연동 시 포트 포워딩/네트워크 정책을 먼저 점검하세요.

## 운영 시 주의

1. 레지스트리 주소, 계정, 비밀번호는 문서에 하드코딩하지 않습니다.
2. 민감 정보는 `.env` 또는 시크릿 저장소(예: Vault, K8S Secret)로 관리합니다.
3. 운영용 배포 설정은 VM/K8S별로 분리해 버전 관리합니다.

## 관련 문서

- 루트 개요: `../README.md`
- 스크립트 가이드: `../scripts/README.md`
- 인프라 계획: `../docs/plans/infra/`
