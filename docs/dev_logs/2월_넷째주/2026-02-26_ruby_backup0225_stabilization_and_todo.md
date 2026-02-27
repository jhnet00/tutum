# 개발 로그 작업 요약 (2026-02-26)

## 1. 작업 요약

- 작업 일시: 2026-02-26
- 작성자: ruby
- 작업 브랜치: `ruby-backup0225`
- 작업 목적: GitLab 기준 배포 안정화, 시장가/뉴스/OAuth 장애 복구, WebSocket/프록시 경로 정리

---

## 2. 주요 작업 내역

### 2-1. 브랜치/배포 기준 정리

- `github` remote 제거 및 GitLab(`origin`) 기준으로만 운영 확인
- 모든 수정/커밋/푸시를 `ruby-backup0225`에서 진행
- GitLab 파이프라인 성공 확인 후 실제 Pod 롤링 재시작으로 런타임 반영 검증

### 2-2. 시장가 API 안정화

- 주식(KIS) 실데이터 응답 경로 정상화 확인
- 코인 API 개선:
  - `BTC-USDT`, `ETH-USDT` 등 non-KRW 티커를 Binance public API fallback으로 처리
  - `KRW-*`에서 Upbit 실패 시 Binance+환율 fallback으로 mock 의존 완화

### 2-3. 프론트 프록시/WS 경로 복구

- 장애 원인 확정:
  - `/api/proxy/*` 라우팅이 어긋나 404 발생
  - WS가 `/api/proxy/api/v1/market/ws`로 연결되어 403 반복 발생
- 조치:
  - Istio VirtualService에 `/api/proxy` -> frontend 우선 라우팅 추가
  - 프론트 WS URL을 `wss://<host>/api/v1/market/ws` 경로로 정정

### 2-4. OAuth 동작 보정

- `GOOGLE_REDIRECT_URI`를 공개 도메인 콜백(`https://tutum.my/api/v1/auth/google/callback`)으로 교정
- 로그인 시작 엔드포인트에서 307 리다이렉트 헤더 정상 확인

### 2-5. Grafana 확인

- `admin.tutum.my` 접속 200 확인
- `UID=PAE45454D0EDB9216`는 현재 운영 Grafana API 기준 `Dashboard not found(404)` 확인
- Invalid UID/Panel 에러는 대상 대시보드 미존재로 판단

---

## 3. 최종 상태

- `ruby-backup0225` 최신 커밋 기준 파이프라인 성공
- `/api/proxy/api/v1/news` 응답 정상(200)
- `/api/proxy/api/v1/market/prices/stocks` 응답 정상(200)
- `/api/proxy/api/v1/market/prices/crypto` 응답 정상(실데이터)
- WS 403 루프 원인 경로 수정 완료

---

## 4. 내일 TODO (2026-02-27)

- [ ] Grafana dashboard integration 완료시키기
- [ ] Kafka 뉴스 불러오지 못하는 문제 debugging
- [ ] 오늘 마무리하지 못한 OCR, SES, MinIO 테스트 진행
- [ ] 사용자 대시보드 및 Quick Bar UI 수정
- [ ] `/chart`에서 Quick Bar가 종목 내용을 가리는 현상 해결
- [ ] AWS migration 준비하기

---

## 5. 관련 커밋(오늘)

- `747668f6` fix: sync develop backend/k8s updates and stabilize OCR/chat market routing
- `ca807469` fix: support non-KRW crypto tickers via binance fallback
- `1f8057d7` fix: fallback KRW crypto prices via binance and fx when upbit fails
- `45bc83ed` fix: restore api proxy routing and websocket path for market stream
