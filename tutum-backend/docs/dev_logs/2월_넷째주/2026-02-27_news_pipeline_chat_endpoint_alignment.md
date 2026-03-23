# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: Kyung Yoon Kim
- 브랜치: develop
- 작업 목적: 뉴스 파이프라인(크롤링/인덱싱)과 AI 응답 엔드포인트 간 불일치를 제거해 운영 경로를 일관화

## 2. 상세 변경 사항
- `k8s-manifests/base/workers/news-producer.yaml`
  - `LIMIT`/`PAGES` 환경변수의 ConfigMap 키를 실제 존재 키로 정렬
  - `key: LIMIT -> PRODUCER_LIMIT`
  - `key: PAGES -> PRODUCER_PAGES`
- `k8s-manifests/base/workers/elastic-consumer.yaml`
  - 임베딩 워커가 Bedrock 자격증명을 명시적으로 읽도록 `env` 추가
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`를 `backend-secret`에서 주입
- `k8s-manifests/base/workers/news-secret.yaml`
  - 빈 AWS 키 항목(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) 제거
  - `MONGO_URI`만 유지
- `backend/app/routers/chat.py`
  - `/api/v1/chat` SSE 엔드포인트 유지
  - `/api/v1/chat/bedrock` JSON 엔드포인트 신규 추가
  - `prompt` 또는 `message` 입력을 받아 내부 SSE 스트림을 합쳐 `response` 문자열로 반환
- `frontend/app/portfolio/trading-analysis/page.tsx`
  - 호출 경로를 `/api/v1/chat/bedrock`에서 `/api/proxy/api/v1/chat/bedrock`로 변경

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `news-producer`가 ConfigMap에 없는 키(`LIMIT`, `PAGES`)를 직접 참조하는 불일치 존재
- 대응: 워커 코드(`producer_news.py`)와 ConfigMap 기준(`PRODUCER_*`)으로 키를 통일
- 이슈: 프론트 일부 화면이 존재하지 않는 백엔드 경로를 호출
- 대응: 백엔드에 `/api/v1/chat/bedrock` 추가 + 프론트 호출을 공용 프록시 경로로 정렬
- 이슈: 임베딩 워커의 AWS 자격증명 소스가 비어있는 `news-secret`에 의존
- 대응: `backend-secret`에서 명시 주입하도록 변경

## 4. 결과
- 검증 항목:
  - 워커 키 매핑 정합성
  - 임베딩 워커 AWS 주입 경로
  - 챗 라우터 엔드포인트 존재
  - 프론트 호출 경로 정합성
  - Python 구문 검증
- 검증 결과:
  - `news-producer.yaml`에서 `PRODUCER_LIMIT`, `PRODUCER_PAGES` 참조 확인
  - `elastic-consumer.yaml`에서 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`의 `backend-secret` 참조 확인
  - `chat.py`에서 `@router.post("")`, `@router.post("/bedrock")`, `@router.get("/health")` 확인
  - `trading-analysis/page.tsx`에서 `/api/proxy/api/v1/chat/bedrock` 호출 확인
  - `python -m py_compile backend/app/routers/chat.py backend/workers/elastic_consumer.py` 통과
- 참고:
  - 본 검증은 저장소/정적 검증 기준이며, 실제 클러스터 rollout 상태는 kubectl context 환경에서 별도 확인 필요

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-27" --until="2026-02-27 23:59:59"
```

## 6. 후속 작업/리스크
- 후속 작업:
  - ArgoCD sync 또는 `kubectl apply -k k8s-manifests /base`
  - `kubectl -n tutum-app rollout status deploy/news-producer deploy/elastic-consumer`
  - `kubectl -n tutum-app logs deploy/news-producer --tail=200`
  - `kubectl -n tutum-app logs deploy/elastic-consumer --tail=200`
- 리스크:
  - `backend-secret` 내 AWS 키/권한이 유효하지 않으면 임베딩 생성은 실패 가능
  - `/api/v1/chat/bedrock`는 SSE를 서버에서 합치는 구조라 응답 지연 시 타임아웃 튜닝 필요 가능
