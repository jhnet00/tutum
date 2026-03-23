# Tutum Frontend

CloudDX(Tutum) 프론트엔드 애플리케이션입니다.
Next.js App Router 기반으로 대시보드, 포트폴리오, 인증, 직접입력, OCR 연계 화면을 제공합니다.

## 기술 스택

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS + Radix UI
- lightweight-charts / recharts

## 실행 방법

### 1. 의존성 설치

```bash
cd frontend
npm install
```

### 2. 환경 변수 설정

`frontend/.env.local` 파일 생성:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
# 선택: Next 서버 프록시 경유 시 사용
API_BASE_URL=http://localhost:8000
```

설명:

- `NEXT_PUBLIC_API_URL`: 클라이언트 컴포넌트에서 백엔드 호출할 때 사용
- `API_BASE_URL`: `app/api/proxy/[...path]` 서버 라우트가 업스트림 백엔드 주소로 사용

### 3. 개발 서버 실행

```bash
npm run dev
```

- 접속: `http://localhost:3000`

### 4. 프로덕션 빌드

```bash
npm run build
npm run start
```

### 5. 린트

```bash
npm run lint
```

## 주요 경로

- `app/`: 페이지 라우트(App Router)
- `components/`: 재사용 UI/도메인 컴포넌트
- `lib/hooks/`: 시세/데이터 관련 훅
- `app/api/proxy/[...path]/route.ts`: 백엔드 프록시 API
- `public/data/`: 워치리스트 샘플 데이터

## 프록시 라우트 참고

`/api/proxy/*` 경로는 백엔드 요청을 프록시합니다.
프론트에서 CORS/쿠키 처리가 필요한 경우 이 경로를 우선 사용합니다.

예시:

- 프론트 호출: `/api/proxy/api/v1/market/search?q=NVDA`
- 실제 전달: `${API_BASE_URL}/api/v1/market/search?q=NVDA`

## 관련 문서

- 루트 개요: `../README.md`
- 백엔드 가이드: `../backend/README.md`
- 문서 인덱스: `../docs/README.md`
