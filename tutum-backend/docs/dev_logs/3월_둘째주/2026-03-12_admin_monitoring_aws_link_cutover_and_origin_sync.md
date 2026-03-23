# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: `tutum.my/admin` 모니터링 경로의 AWS cutover 누락을 정리하고, 팀원이 반영한 `origin/develop` 최신 상태 위에서 운영 변경과 문서를 동기화

## 2. 상세 변경 사항
- `backend/app/routers/admin.py`
  - `TEMPO_URL`, `GRAFANA_URL` 기본값을 온프레미스 `192.168.0.230`에서 AWS monitoring EC2 `10.60.11.95`로 정정
- `k8s-manifests/base/frontend/deployment.yaml`
  - frontend 컨테이너 startup patch에 `/app/.next/server/app/admin/page.js` 치환 로직 추가
  - Traces 탭 상단 고정 링크 `Grafana Tempo ->`의 legacy URL `http://192.168.0.230:3000/explore`를 AWS monitoring URL `http://10.60.11.95:3000/explore`로 통째로 치환하도록 보정
- 원격 동기화 확인
  - `origin/develop` 최신 커밋 `6bf51f4`, `90861bb`, `dde38bc`, `2c1bfc2`, `8f4ec16` 반영 상태를 기준으로 후속 작업 수행
  - `node-exporter` 이미지가 Docker Hub가 아닌 ECR mirror를 사용하도록 최신 상태 확인

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 로컬 `develop` 워크트리에 운영 점검용 수정과 untracked 파일이 많아 직접 rebase/merge 시 기존 작업을 오염시킬 위험이 있었음
- 대응: 원격 최신 상태는 fetch로 확인하고, commit/push는 clean temp clone 기준으로 처리하도록 분리
- 이슈: 프론트 소스(`frontend/app/admin/page.tsx`)가 저장소에 없고 `.next` 산출물만 있어 링크 수정이 source 레벨이 아니라 build artifact와 startup patch 둘 다 필요했음
- 대응: Deployment startup patch가 컨테이너 내부 `.next` 산출물을 직접 치환하도록 바꿔 새 이미지 재빌드 없이도 링크 경로를 보정할 수 있게 함
- 이슈: live frontend 이미지의 `page.js`는 로컬 확인본과 minified 형태가 달라 `href:\"\".concat(...)` 타깃 치환이 실제 컨테이너에서 동작하지 않았음
- 대응: 특정 AST 형태가 아니라 legacy Grafana URL 문자열 전체를 `replaceAll`로 치환하도록 보강

## 4. 결과
- 검증 항목:
  - `origin/develop` 최신 커밋 반영 여부
  - frontend startup patch가 `/app/.next/server/app/admin/page.js` 대상 링크를 치환하도록 구성됐는지 확인
  - live frontend Deployment가 startup patch로 admin page link를 교체할 수 있는지 확인
  - live cluster의 `node-exporter`가 ECR image로 수렴했는지 확인
- 검증 결과:
  - `origin/develop` 최신 HEAD: `6bf51f42f397ced24be8da2f86188aafbfedec8f`
  - live frontend Deployment args는 아직 admin link patch가 없는 상태여서, 이번 commit 반영 후 rollout 필요
  - local verification 기준 `/app/.next/server/app/admin/page.js` 대상 링크 치환 문자열을 startup patch에서 확인
  - live frontend pod 내부 `page.js` 확인 시 legacy URL이 남아 있는 것을 재현했고, generic URL 치환 방식으로 후속 수정
  - `kubectl -n monitoring get ds node-exporter -o jsonpath='{.spec.template.spec.containers[0].image}'`
    - `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/prometheus/node-exporter:v1.8.2`

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

- 원격 선반영 확인:
  - `6bf51f4` `docs(devlog): record staging recovery and node exporter fix`
  - `90861bb` `fix(monitoring): limit node-exporter to amd64 nodes`
  - `dde38bc` `fix(monitoring): mirror node-exporter to ecr`
  - `2c1bfc2` `fix(monitoring): switch node-exporter off docker hub`
  - `8f4ec16` `fix(staging): restore backend admin patch newlines`
- 관련 운영/문서 커밋:
  - `d2a534c` `fix(monitoring): restore admin observability data`
  - `db29721` `docs(infra): update onprem migration status`
  - `1b06d67` `fix(monitoring): match legacy loki selector patch`

## 6. 후속 작업/리스크
- 이번 frontend admin link 보정은 `origin/develop` 반영 후 rollout이 끝나야 live 브라우저에서 실제 링크가 바뀜
- `frontend` 소스가 아닌 `.next` 산출물을 직접 관리 중이라, 추후 프론트 재빌드 파이프라인 정리가 필요
- admin page의 실데이터는 대부분 복구됐지만, Kafka lag 메트릭 적재 경로는 계속 별도 점검이 필요
