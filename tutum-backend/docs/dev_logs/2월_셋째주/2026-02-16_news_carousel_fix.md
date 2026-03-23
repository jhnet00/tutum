# 2026-02-16 개발 로그: 뉴스 로딩 실패 및 캐러셀 깜빡임 수정

## 1. 이슈 요약

- **뉴스 미출력 (비로그인 메인페이지)**: Market News 섹션에 뉴스가 로딩되지 않고 빈 페이지네이션만 표시됨.
- **뉴스 캐러셀 깜빡임 (로그인 후 포트폴리오)**: "사용자 자산 기준 추천 뉴스" 캐러셀이 무한 re-render로 깜빡이며, 날짜에 "Invalid Date" 표시.

## 2. 원인 분석

### 뉴스 미출력 (404 에러)
- `frontend/app/api/public/news/route.ts`에서 백엔드 API URL에 **trailing slash**(`/api/v1/news/`)가 포함되어 있었음.
- 백엔드 FastAPI 설정이 `redirect_slashes=False`이므로 `/api/v1/news/`는 404를 반환.
- `@router.get("")` 라우트는 `/api/v1/news`(슬래시 없음)만 매칭.

### 캐러셀 무한 깜빡임
- `asset/page.tsx`에서 `assetKeywords = holdings.map(h => h.name || h.symbol)`를 직접 계산하여 prop으로 전달.
- 매 렌더링마다 새 배열 참조가 생성되어 `PersonalizedNewsCarousel`의 `useEffect([keywords])` 의존성이 매번 변경으로 감지됨.
- 결과: fetch → setState → re-render → 새 keywords → fetch → ∞ (무한 루프).

### Invalid Date 표시
- Next.js 프록시 라우트가 백엔드의 `published_at` → `time`, `section` → `category`로 필드를 변환하여 응답.
- `PersonalizedNewsCarousel.tsx`는 변환 전 필드명(`published_at`, `section`)을 참조하여 `new Date(undefined)` → "Invalid Date" 발생.

## 3. 수정 내용

### 파일별 변경사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/app/api/public/news/route.ts` | API URL trailing slash 제거 (`/api/v1/news/` → `/api/v1/news`) |
| `frontend/app/portfolio/asset/page.tsx` | `assetKeywords`를 `useMemo`로 래핑하여 참조 안정화 |
| `frontend/components/PersonalizedNewsCarousel.tsx` | interface 필드 정렬 (`time`/`category`), `useMemo`로 키워드 키 안정화 |

### 핵심 코드 변경

```typescript
// asset/page.tsx - useMemo 적용
const assetKeywords = useMemo(() => holdings.map(h => h.name || h.symbol), [holdings]);

// PersonalizedNewsCarousel.tsx - 안정화된 의존성
const keywordsKey = useMemo(() => keywords.slice(0, 2).join(","), [keywords]);
useEffect(() => { fetchNews(); }, [keywordsKey]); // 배열 대신 문자열 의존성

// interface 수정: published_at → time, section → category (프록시 응답 스키마에 맞춤)
```

## 4. 결과 확인

- 비로그인 메인페이지: Market News 섹션에 뉴스 6건 정상 출력, 페이지네이션 작동.
- 로그인 후 포트폴리오: 추천 뉴스 캐러셀이 한 번만 로딩되고 안정적으로 표시됨.
- 날짜 표시: "3분 전", "2시간 전" 등 정상 출력 (Invalid Date 해결).

## 5. 커밋 정보

- **브랜치**: `kyk/0216`
- **커밋**: `2141f3b` - fix: resolve news loading failures and carousel flickering
- **변경 파일**: 3개 (route.ts, asset/page.tsx, PersonalizedNewsCarousel.tsx)
