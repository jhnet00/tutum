# 개발 로그 작업 요약 (2026-03-13)

## 1. 작업 요약
- 작업 일시: 2026-03-13
- 작업자: 김정호
- 브랜치: develop
- 작업 목적: `https://tutum.my/portfolio/chart` 우측 마켓 사이드바의 주식/코인 목록 수가 너무 적고, 종목 수를 늘릴 경우 실시간 시세 호출과 차트 히스토리가 불안정해질 수 있어 목록 확장과 라이브 동기화 로직을 함께 보강했다.

## 2. 상세 변경 사항
- `frontend/public/data/watchlist-stocks.json`
  - 기존 소수 종목만 있던 주식 목록을 실제 사용 가능한 데이터 기준으로 20개까지 확장했다.
  - 미국 주식과 국내 주식을 함께 포함하고, 종목별 최근 히스토리와 표시 가격/등락률을 갱신했다.
- `frontend/public/data/watchlist-crypto.json`
  - 코인 목록을 18개까지 확장했다.
  - 메이저 코인 외에 알트코인도 추가하고 최근 히스토리를 함께 갱신했다.
- `frontend/components/ChartSidebar.tsx`
  - 주식 실시간 등락률을 `changeRate`만 보던 구조에서 `raw.output.rate`, `raw.output.prdy_ctrt`, `change_percent`까지 읽도록 보강했다.
  - 목록 종목이 많아질 때 시세 API가 한 번에 몰리지 않도록 주식/코인 요청을 배치로 나누어 호출하도록 변경했다.
- `frontend/lib/types/chart-asset.ts`
  - 차트 종목 메타에 `history` 필드를 추가해 목록 JSON의 히스토리를 컴포넌트에서 재사용할 수 있게 했다.
- `frontend/app/portfolio/chart/page.tsx`
  - watchlist JSON의 `history`를 `ChartAsset`으로 넘기도록 변경했다.
  - 선택 종목 정보가 목록 데이터와 병합되도록 정리해 선택 후 라이브 가격/등락률 반영이 끊기지 않도록 했다.
- `frontend/components/AdvancedChart.tsx`
  - 히스토리 API가 간헐적으로 placeholder 값이나 실제 가격대와 맞지 않는 값을 돌려주는 경우, watchlist JSON에 저장된 최근 히스토리로 fallback 하도록 보강했다.
  - 외화 종목은 현재 가격과 히스토리 종가 비율을 다시 계산해 차트 스케일이 실제 표시 가격과 최대한 맞도록 조정했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 종목 수를 한 번에 늘리면 주식 시세 API가 요청량 때문에 일부 종목을 `0` 가격이나 rate limit 응답으로 반환했다.
- 대응: `ChartSidebar`에서 주식/코인 요청을 배치로 분할하고 요청 간 짧은 간격을 두어 한 번에 몰리지 않게 했다.

- 이슈: 일부 종목은 히스토리 API가 간헐적으로 실제 가격대와 맞지 않는 placeholder 성격의 값을 반환해 차트가 비정상적으로 보일 수 있었다.
- 대응: 종목 목록 JSON에 최근 히스토리를 같이 저장하고, `AdvancedChart`에서 API 히스토리가 현재 가격과 비정상적으로 어긋나는 경우 목록 히스토리로 fallback 하도록 처리했다.

- 이슈: 종목 수만 늘리면 가격은 실제인데 등락률은 갱신되지 않는 케이스가 있었다.
- 대응: 주식은 `rate` / `prdy_ctrt`, 코인은 `change_percent`를 읽도록 실시간 등락률 매핑을 수정했다.

## 4. 결과
- 검증 항목: watchlist JSON 파싱
- 검증 결과: `watchlist-stocks.json` 20개, `watchlist-crypto.json` 18개로 정상 파싱 확인

- 검증 항목: chart 관련 변경 파일 lint
- 검증 결과: `npm run lint -- --file app/portfolio/chart/page.tsx --file components/ChartSidebar.tsx --file components/AdvancedChart.tsx` 통과

- 검증 항목: 원격 최신 반영 여부
- 검증 결과: 원격 `develop` 4커밋을 먼저 fast-forward로 반영했고, 작업 파일과 충돌 없이 병합 완료

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-13" --until="2026-03-13 23:59:59"
```

## 6. 후속 작업/리스크
- 현재 차트/목록은 더 많은 종목을 안정적으로 보여주도록 보강했지만, 백엔드 시장 데이터 API 자체의 간헐적인 값 흔들림은 별도 모니터링이 필요하다.
- 실제 브라우저에서 목록 스크롤, 종목 선택, 주식/코인 탭 전환 시 체감 성능을 한 번 더 확인하는 것이 좋다.
- 필요하면 다음 단계로는 watchlist 데이터를 수동 JSON이 아니라 주기적으로 생성하는 스크립트/배치 작업으로 정리할 수 있다.
