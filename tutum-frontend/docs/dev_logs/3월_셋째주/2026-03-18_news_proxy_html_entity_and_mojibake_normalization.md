# 개발 로그 작업 요약 (2026-03-18)

## 1. 작업 요약
- 작업 일시: 2026-03-18
- 작업자: 김정호
- 브랜치: `develop`
- 작업 목적: 메인 뉴스 카드와 관련 뉴스 화면에서 제목에 `&quot;`, `&amp;` 같은 문자열이 그대로 노출되는 현상을 프론트 프록시 단계에서도 보정한다.

## 2. 상세 변경 사항
- `frontend/app/api/public/news/route.ts`
  - `decodeHtmlEntities()`를 추가해 `&quot;`, `&amp;`, `&lt;`, `&gt;`, `&nbsp;` 등을 일반 문자로 변환하도록 했다.
  - `looksLikeMojibake()`와 `repairMojibake()`를 추가해, 프록시 응답에서 깨진 UTF-8 문자열 패턴이 보이면 복구를 시도하도록 했다.
  - `normalizeInlineText()`, `normalizeBodyText()`를 만들어 제목, 카테고리, 소스, 본문에 각각 맞는 정규화를 적용했다.
  - `mapNewsItem()`이 title/content/section/source를 모두 정규화 함수로 통과시키도록 수정했다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 백엔드 API 단계 보정만으로도 대부분 해결되지만, 실제 화면은 Next.js 프록시 응답을 거쳐 렌더링되어 이전 데이터나 fallback 응답에서 동일한 문제가 다시 보일 수 있었다.
- 대응: 프론트 프록시에서도 같은 종류의 문자열 보정을 한 번 더 수행하도록 추가 방어선을 넣었다.

## 4. 결과
- 검증 항목: 대상 파일 lint 검사
- 검증 결과: `npm run lint -- --file frontend/app/api/public/news/route.ts` 통과 예정 기준으로 수정
- 확인 항목: 로컬/원격 브랜치 차이
- 확인 결과: 작업 시작 시 `develop == origin/develop` 상태에서 진행

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-18" --until="2026-03-18 23:59:59"
```

## 6. 후속 작업/리스크
- 데이터 원천 단계에서 이미 잘못 저장된 문자열은 수집기 정규화 로직을 추가로 점검할 필요가 있다.
- 화면 반영 후에도 일부 소스만 동일 증상이 남으면, 해당 소스별 본문/제목 저장 포맷을 별도로 확인해야 한다.
