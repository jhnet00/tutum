# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: Kyung Yoon Kim
- 브랜치: develop
- 작업 목적: 뉴스 임베딩 인덱싱 상시 운영을 위해 `elastic-consumer` 활성화 및 임베딩 플래그를 ON 상태로 정렬

## 2. 상세 변경 사항
- `k8s-manifests/base/workers/elastic-consumer.yaml`
  - `replicas: 0 -> 1`
- `k8s-manifests/base/workers/news-configmap.yaml`
  - `ENABLE_BEDROCK_EMBEDDING: "false" -> "true"`
- `backend/workers/elastic_consumer.py`
  - `env_bool()` 헬퍼 추가
  - `ENABLE_BEDROCK_EMBEDDING` 파싱을 `"1"` 고정 비교에서 불리언 파싱(`1/true/t/yes/y/on`)으로 변경

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 기존 코드가 `ENABLE_BEDROCK_EMBEDDING == "1"`만 인식하여 ConfigMap 값을 `"true"`로 둘 경우 임베딩이 실제로 비활성화되는 리스크 존재
- 대응: 환경변수 불리언 파싱 헬퍼를 도입해 `true/1` 계열 값을 모두 수용하도록 수정

## 4. 결과
- 검증 항목:
  - 매니페스트 값 확인
  - 임베딩 플래그 파싱 코드 확인
  - Python 문법 검증
- 검증 결과:
  - `rg -n "replicas:|ENABLE_BEDROCK_EMBEDDING" k8s-manifests/base/workers/elastic-consumer.yaml k8s-manifests/base/workers/news-configmap.yaml backend/workers/elastic_consumer.py`
    - `elastic-consumer.yaml: replicas: 1`
    - `news-configmap.yaml: ENABLE_BEDROCK_EMBEDDING: "true"`
    - `elastic_consumer.py: ENABLE_BEDROCK_EMBEDDING = env_bool(...)`
  - `python -m py_compile backend/workers/elastic_consumer.py` 정상 종료(에러 없음)
- 참고:
  - 이 로그는 Git 기준 반영/코드 검증까지 완료한 상태이며, 실제 클러스터 롤아웃/Pod 상태 확인은 별도 `kubectl` 접근 가능한 환경에서 확인 필요

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-27" --until="2026-02-27 23:59:59"
```

## 6. 후속 작업/리스크
- 후속 작업:
  - ArgoCD 또는 `kubectl apply -k k8s-manifests/base`로 반영
  - `kubectl -n tutum-app rollout status deploy/elastic-consumer` 확인
  - `kubectl -n tutum-app logs deploy/elastic-consumer --tail=200`에서 임베딩 생성 로그/오류 확인
- 리스크:
  - `news-pipeline-secret`의 AWS 자격증명/권한 미충족 시 Bedrock 임베딩 생성 실패 가능
  - ES 인덱스 매핑/클러스터 리소스 부족 시 인덱싱 지연 가능
