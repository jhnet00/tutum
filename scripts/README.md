# 배포/운영 스크립트 가이드

`/scripts`는 Node 환경에서 사용하는 Docker 정리/빌드/푸시 스크립트를 담고 있습니다.

## 파일 목록

- `cleanup-docker.sh`: Docker 리소스 정리
- `build-and-push.sh`: 이미지 빌드 + Harbor 푸시 + 로컬 latest 유지

## 1) cleanup-docker.sh

불필요한 컨테이너/이미지/볼륨/빌더 캐시를 정리해 디스크 공간을 확보합니다.

실행:

```bash
chmod +x scripts/cleanup-docker.sh
./scripts/cleanup-docker.sh
```

정리 대상:

- stopped container
- dangling/unused image
- unused volume/network
- build cache

## 2) build-and-push.sh

Frontend/Backend/Workers 이미지를 순차 빌드한 뒤 Harbor에 푸시합니다.
기본 태그는 `latest`, 인자를 주면 해당 태그로 푸시합니다.

실행:

```bash
chmod +x scripts/build-and-push.sh
./scripts/build-and-push.sh
./scripts/build-and-push.sh v1.0.0
```

현재 스크립트 기본값:

- Registry: `192.168.56.12:8080`
- Project: `tutum`

환경이 다르면 스크립트 상단 변수(`HARBOR_REGISTRY`, `PROJECT`)를 먼저 수정하세요.

## 권장 운영 순서

1. 최신 코드 동기화

```bash
git checkout develop
git pull origin develop
```

2. 디스크 정리(필요 시)

```bash
./scripts/cleanup-docker.sh
```

3. 빌드/푸시

```bash
./scripts/build-and-push.sh
```

4. 배포 서버에서 pull 후 compose 재기동

```bash
docker compose pull
docker compose up -d
```

## 주의 사항

1. 스크립트 실행 전에 `docker login <harbor-registry>`를 완료하세요.
2. 민감 정보(계정/비밀번호)는 스크립트에 직접 넣지 마세요.
3. 운영 배포에서는 태그를 고정(`vX.Y.Z`)하는 방식을 권장합니다.

## 관련 문서

- 루트 개요: `../README.md`
- 인프라 가이드: `../infra/README.md`
- 작업 계획: `../docs/work-plans/`
