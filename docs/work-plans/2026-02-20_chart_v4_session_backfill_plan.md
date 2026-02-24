# 📊 차트 V4 워크플랜 (세션/백필 안정화)
> **작성일**: 2026-02-20  
> **작성자**: Codex + kyk02405  
> **브랜치**: `kyk/realtime-chart-stream`

---

## 1. 목표
- 해외 분봉에서 장 마감 후 오래된 틱(stale tick)으로 이상 캔들이 생기는 문제를 제거한다.
- 장애/재기동 후 Redis 캔들 캐시를 빠르게 복구할 수 있는 replay 경로를 확보한다.
- no-data 사유를 사용자 관점에서 이해 가능한 메시지로 분리한다.

---

## 2. 작업 항목

### A. 세션/품질 처리
- [x] `candle_aggregator`에 tick freshness 필터 추가
  - [x] 주식/코인 각각 stale 허용 시간 분리
  - [x] stale tick은 캔들 집계에서 제외
- [x] 해외 분봉 no-data 사유 세분화
  - [x] 정규장 외(`overseas_market_closed`)
  - [x] 정규장 중 벤더 지연/미지원(`overseas_intraday_vendor_delay_or_unavailable`)

### B. 복구/운영
- [x] Mongo -> Redis 캔들 replay 스크립트 추가
- [x] `docker-compose` ops profile로 replay 실행 경로 추가
- [x] 운영 가이드(`CANDLE_ENGINE_V2_V3_GUIDE.md`) 업데이트

### C. 검증
- [x] AAPL 분봉 장외 요청 시 no-data 사유가 정규장 상태에 맞게 응답
- [x] BTC 1분/5분/60분에서 캔들 소스가 `candle_aggregator`로 유지
- [x] replay 실행 후 Redis 캔들 키 복원 확인

---

## 3. 실행 커맨드
```bash
docker compose up -d --build backend workers price-consumer candle-aggregator
docker compose --profile ops run --rm candle-replay
```

---

## 4. 리스크
- 미국 공휴일 캘린더 미반영: 정규장 판단은 현재 요일/시간 기준(ET) 1차 구현
- 벤더 rate limit 시 분봉 공백 가능: stale 차단과 no-data 메시지로 오인 방지
