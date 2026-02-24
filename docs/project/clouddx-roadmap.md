# CloudDX 프로젝트 기능 완성도 및 개발 순서 가이드

> **문서 목적**: 현재 프로젝트 구현 상태 파악 + 논리적인 개발 순서 제안
> 
> **프로젝트 유형**: 풀스택 모노레포 (FastAPI Backend + Next.js Frontend)

---

## 1. 현재 구현 상태

### 1.1 인증 시스템 (Authentication)

| 기능 | 상태 | 비고 |
|------|------|------|
| 회원가입 API (`/api/v1/auth/register`) | [x] 완료 (2026-02-02) | 이메일 중복 체크, bcrypt 해싱 |
| 회원가입 UI | [x] 완료 (2026-02-02) | Zod 스키마 검증, 비밀번호 강도 피드백 |
| 로그인 API (`/api/v1/auth/login`) | [x] 완료 (2026-02-02) | JWT 토큰 발급 |
| 로그인 UI | [x] 완료 (2026-02-02) | 페이지 구현됨 |
| `/auth/me` 엔드포인트 | [x] 완료 (2026-02-02) | 사용자 정보 반환 구현됨 |
| AuthContext 백엔드 연동 | [x] 완료 (2026-02-02) | 실제 API 연동 및 쿠키 동기화 |
| JWT 토큰 저장/관리 | [x] 완료 (2026-02-02) | localStorage + Cookie 이중 저장 (Middleware 대응) |
| 이메일 인증 발송 | [ ] 미구현 | UI는 "발송 완료" 표시하지만 실제 발송 없음 |
| 이메일 인증 검증 (`/verify-email`) | [ ] 미구현 | 엔드포인트 없음 |
| 비밀번호 재설정 | [ ] 미구현 | 엔드포인트 및 UI 없음 |
| 닉네임 중복 체크 | [ ] 미구현 | 검증 로직 없음 |

### 1.2 소셜 로그인 (OAuth)

| 기능 | 상태 | 비고 |
|------|------|------|
| Google OAuth 백엔드 | [x] 완료 (2026-02-02) | `/api/v1/auth/google/callback`, `prompt=select_account` |
| Google OAuth 프론트엔드 | [x] 완료 (2026-02-02) | 로그인 버튼 + 콜백 처리 |
| Kakao OAuth 백엔드 | [ ] 미구현 | Placeholder만 존재 |
| Kakao OAuth 프론트엔드 | [ ] 미구현 | 버튼 없음 |
| 네이버 OAuth 백엔드 | [x] 완료 (2026-02-02) | `/api/v1/auth/naver/callback`, `auth_type=reauthenticate` |
| 네이버 OAuth 프론트엔드 | [x] 완료 (2026-02-02) | 로그인 버튼 + 콜백 처리 |

### 1.3 자산 관리 (Assets)

| 기능 | 상태 | 비고 |
|------|------|------|
| 자산 목록 조회 API | [x] 완료 (2026-01-30) | CRUD 구현 |
| 자산 생성/수정/삭제 API | [x] 완료 (2026-01-30) | |
| CSV 대량 업로드 (`/api/v1/assets/bulk`) | [x] 완료 (2026-01-30) | |
| 포트폴리오 페이지 | [x] 완료 (2026-01-27) | |
| 자산 등록 모달 | [x] 완료 (2026-01-27) | |
| CSV 업로드 마법사 | [x] 완료 (2026-01-27) | |

### 1.4 마켓 데이터 (Market Data)

| 기능 | 상태 | 비고 |
|------|------|------|
| KIS API 연동 (국내/해외 주식) | [x] 완료 (2026-01-30) | 한국투자증권 |
| Upbit API 연동 (암호화폐) | [x] 완료 (2026-01-30) | CCXT 사용 |
| 실시간 차트 | [x] 완료 (2026-01-27) | lightweight-charts |

### 1.5 UI/UX

| 기능 | 상태 | 비고 |
|------|------|------|
| Radix UI 컴포넌트 | [x] 완료 (2026-01-15) | |
| 다크모드 지원 | [x] 완료 (2026-01-15) | next-themes |
| Tailwind CSS 커스텀 테마 | [x] 완료 (2026-01-15) | |
| Toast 에러 메시지 | [ ] 미구현 | 현재 alert() 사용 |
| React Error Boundary | [ ] 미구현 | |

### 1.6 테스트

| 기능 | 상태 | 비고 |
|------|------|------|
| pytest 설정 | [ ] 미구현 | 테스트 파일 전무 |
| 백엔드 유닛 테스트 | [ ] 미구현 | |
| Playwright 설정 | [ ] 미구현 | |
| 프론트엔드 E2E 테스트 | [ ] 미구현 | |

### 1.7 인프라

| 기능 | 상태 | 비고 |
|------|------|------|
| Docker Compose | [x] 완료 (2026-01-15) | 로컬 개발용 |
| Docker 멀티스테이지 빌드 | [ ] 미구현 | 이미지 최적화 필요 |
| Health Check 엔드포인트 | [ ] 미구현 | K8S 배포 시 필요 |
| K8S Deployment/Service | [ ] 미구현 | |
| K8S ConfigMap/Secret | [ ] 미구현 | |
| K8S Ingress + TLS | [ ] 미구현 | |
| HPA (오토스케일링) | [ ] 미구현 | |

### 1.8 보안

| 기능 | 상태 | 비고 |
|------|------|------|
| bcrypt 비밀번호 해싱 | [x] 완료 (2026-02-02) | Python 3.13 호환 해결 |
| JWT 토큰 인증 | [x] 완료 (2026-02-02) | |
| CORS 설정 | [x] 부분 완료 (2026-02-02) | localhost:3000만 허용 |
| HTTPS 리다이렉트 | [ ] 미구현 | |
| Rate Limiting | [ ] 미구현 | |
| CSRF 보호 | [ ] 미구현 | |

---

## 2. 미완성 기능 목록 (우선순위순)

### 우선순위 1: 필수 (지금 당장 해결 필요)

> 이 항목들이 해결되지 않으면 **기본적인 서비스 이용이 불가능**합니다.

#### 1. /auth/me 엔드포인트 완성
- **현재 상태**: 더미 응답만 반환
- **문제**: AuthContext가 이 API에 의존하여 사용자 정보를 가져옴
- **선행 작업**: 없음
- **파일**: `backend/app/api/v1/auth.py`
- **추천 카테고리+스킬**: `category="unspecified-high"`, `skills=["git-master"]`

#### 2. AuthContext 백엔드 연동
- **현재 상태**: 하드코딩된 Mock 계정(`test/test`)만 작동
- **문제**: 회원가입해도 로그인 불가, 실제 사용자 경험 완전 차단
- **선행 작업**: /auth/me 엔드포인트 완성
- **파일**: `frontend/src/context/AuthContext.tsx`, `frontend/src/lib/api.ts`
- **추천 카테고리+스킬**: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

#### 3. 이메일 인증 구현
- **현재 상태**: UI는 "인증 메일 발송 완료" 표시하지만 실제 발송 없음
- **문제**: 보안 취약 (가짜 이메일로 가입 가능), 미인증 사용자도 로그인 가능
- **선행 작업**: AWS SES 설정
- **구성 요소**:
  - 백엔드: 이메일 발송 서비스, `/verify-email` 엔드포인트
  - 프론트엔드: 인증 대기 페이지, 인증 완료 페이지
- **추천 카테고리+스킬**: 
  - 백엔드: `category="unspecified-high"`, `skills=["git-master"]`
  - 프론트엔드: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

---

### 우선순위 2: 중요 (핵심 기능 완성)

> 서비스 출시 전 **반드시 필요한 기능**들입니다.

#### 4. Kakao OAuth
- **현재 상태**: Placeholder만 존재
- **문제**: 국내 사용자 대다수가 선호하는 로그인 방식 미제공
- **선행 작업**: Kakao Developers 앱 등록
- **구성 요소**:
  - 백엔드: `/api/v1/auth/kakao`, `/api/v1/auth/kakao/callback`
  - 프론트엔드: Kakao 로그인 버튼
- **추천 카테고리+스킬**: 
  - 백엔드: `category="unspecified-high"`, `skills=["git-master"]`
  - 프론트엔드: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

#### 5. 네이버 OAuth
- **현재 상태**: 구현 없음
- **문제**: 국내 사용자 접근성 제한
- **선행 작업**: 네이버 개발자센터 앱 등록, Kakao OAuth 완료 (패턴 재사용)
- **구성 요소**:
  - 백엔드: `/api/v1/auth/naver`, `/api/v1/auth/naver/callback`
  - 프론트엔드: 네이버 로그인 버튼
- **추천 카테고리+스킬**: 
  - 백엔드: `category="unspecified-high"`, `skills=["git-master"]`
  - 프론트엔드: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

#### 6. 비밀번호 재설정
- **현재 상태**: 기능 없음
- **문제**: 비밀번호 분실 시 복구 방법 없음 → 사용자 이탈
- **선행 작업**: 이메일 발송 서비스 (AWS SES)
- **구성 요소**:
  - 백엔드: `/forgot-password`, `/reset-password` 엔드포인트
  - 프론트엔드: 비밀번호 재설정 페이지
- **추천 카테고리+스킬**: 
  - 백엔드: `category="unspecified-high"`, `skills=["git-master"]`
  - 프론트엔드: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

---

### 우선순위 3: 권장 (사용자 경험 개선)

> 없어도 서비스는 작동하지만, **UX가 크게 향상**됩니다.

#### 7. 닉네임 중복 체크
- **현재 상태**: 검증 로직 없음
- **문제**: 동일 닉네임 사용자 혼란 가능
- **선행 작업**: 없음
- **구성 요소**:
  - 백엔드: `/api/v1/auth/check-nickname` 엔드포인트
  - 프론트엔드: 실시간 중복 체크 (debounce 적용)
- **추천 카테고리+스킬**: `category="quick"`, `skills=["git-master"]`

#### 8. Toast 에러 핸들링
- **현재 상태**: 에러 시 `alert()` 사용
- **문제**: UX 불량, 현대적인 UI 아님
- **선행 작업**: 없음
- **구성 요소**:
  - react-hot-toast 또는 Radix Toast 도입
  - Axios interceptor 공통 에러 처리
- **추천 카테고리+스킬**: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

#### 9. React Error Boundary
- **현재 상태**: 미구현
- **문제**: 컴포넌트 에러 시 전체 앱 크래시
- **선행 작업**: 없음
- **추천 카테고리+스킬**: `category="visual-engineering"`, `skills=["frontend-ui-ux"]`

---

### 우선순위 4: 선택 (추후 개선)

> 나중에 진행해도 되는 **개선 사항**들입니다.

#### 10. 백엔드 테스트 (pytest)
- **현재 상태**: 테스트 파일 전무
- **선행 작업**: 없음
- **구성 요소**: pytest 설정, conftest.py, 인증 API 유닛 테스트
- **추천 카테고리+스킬**: `category="unspecified-high"`, `skills=["git-master"]`

#### 11. 프론트엔드 E2E 테스트 (Playwright)
- **현재 상태**: 테스트 파일 전무
- **선행 작업**: 인증 시스템 완성
- **구성 요소**: Playwright 설정, 회원가입/로그인 E2E 테스트
- **추천 카테고리+스킬**: `category="visual-engineering"`, `skills=["playwright", "dev-browser"]`

#### 12. 구조화된 로깅
- **현재 상태**: print문 사용
- **선행 작업**: 없음
- **구성 요소**: structlog 또는 loguru 도입
- **추천 카테고리+스킬**: `category="unspecified-high"`, `skills=["git-master"]`

---

## 3. 추천 개발 순서

### Phase 1: 인증 시스템 완성 (핵심)

> **목표**: 사용자가 실제로 회원가입하고 로그인할 수 있게 만들기
> 
> **완료 조건**: Mock 계정 없이 실제 회원가입 → 이메일 인증 → 로그인 흐름 작동

**작업 흐름**:
```
Step 1: /auth/me 엔드포인트 완성 ─────────────────┐
                                                   │
Step 2: AWS SES 설정 (병렬 진행 가능) ─────────────┤
                                                   ↓
Step 3: AuthContext 백엔드 연동 (Mock 제거) ←─── Step 1 완료 필요
        │
        ↓ 이제 실제 계정으로 로그인 가능
        │
Step 4: 이메일 발송 서비스 구현 ←─────────────── Step 2 완료 필요
        │
        ↓
Step 5: /verify-email 엔드포인트 구현
        │
        ↓
Step 6: 이메일 인증 UI (대기 페이지, 완료 페이지)
        │
        ↓ 완전한 회원가입 흐름 완성
```

**병렬 처리 가능한 작업**:
- Step 1 (`/auth/me`)과 Step 2 (AWS SES)는 **독립적** → 동시 진행 가능
- Step 4 (이메일 발송)와 Step 5 (`/verify-email`)는 **동시 진행 가능**

**각 Step 상세**:

| Step | 작업명 | 파일 | 내용 | 카테고리+스킬 |
|------|--------|------|------|--------------|
| 1 | /auth/me 완성 | `backend/app/api/v1/auth.py` | JWT에서 user_id 추출 → MongoDB 조회 → 사용자 정보 반환 | `unspecified-high`, `["git-master"]` |
| 2 | AWS SES 설정 | AWS 콘솔 | IAM 역할 생성, 도메인/이메일 인증, 샌드박스 해제 요청 | `unspecified-high`, `["git-master"]` |
| 3 | AuthContext 연동 | `frontend/src/context/AuthContext.tsx` | Mock 로직 제거, `/api/v1/auth/login` 실제 호출, JWT 저장 | `visual-engineering`, `["frontend-ui-ux"]` |
| 4 | 이메일 발송 서비스 | `backend/app/services/email.py` | boto3로 SES 발송, 인증 토큰 생성 (UUID + 만료) | `unspecified-high`, `["git-master"]` |
| 5 | /verify-email | `backend/app/api/v1/auth.py` | 토큰 검증, 만료 확인, `is_verified` 업데이트 | `unspecified-high`, `["git-master"]` |
| 6 | 이메일 인증 UI | `frontend/src/app/verify-email/` | 인증 대기 페이지, 재발송 버튼, 인증 완료 페이지 | `visual-engineering`, `["frontend-ui-ux"]` |

---

### Phase 2: 소셜 로그인 확장

> **목표**: Google 외에 Kakao, 네이버 로그인 추가
> 
> **완료 조건**: 3가지 OAuth 모두 정상 작동

**작업 흐름**:
```
Step 1: Kakao OAuth 백엔드 ──────────────────────┐
        │                                        │
        ↓                                        │ (병렬 가능)
Step 2: Kakao 로그인 UI                          │
        │                                        │
        ↓                                        │
Step 3: 네이버 OAuth 백엔드 (Kakao 패턴 재사용) ←┘
        │
        ↓
Step 4: 네이버 로그인 UI
```

**병렬 처리 가능한 작업**:
- Kakao 백엔드와 UI 작업은 **병렬 불가** (백엔드 먼저)
- 네이버는 Kakao 패턴 재사용하므로 Kakao 완료 후 빠르게 진행 가능

**각 Step 상세**:

| Step | 작업명 | 파일 | 내용 | 카테고리+스킬 |
|------|--------|------|------|--------------|
| 1 | Kakao OAuth 백엔드 | `backend/app/api/v1/auth.py` | `/auth/kakao`, `/auth/kakao/callback` 엔드포인트 | `unspecified-high`, `["git-master"]` |
| 2 | Kakao 로그인 UI | `frontend/src/app/auth/login/page.tsx` | 노란색 Kakao 버튼, 콜백 처리 | `visual-engineering`, `["frontend-ui-ux"]` |
| 3 | 네이버 OAuth 백엔드 | `backend/app/api/v1/auth.py` | `/auth/naver`, `/auth/naver/callback` 엔드포인트 | `unspecified-high`, `["git-master"]` |
| 4 | 네이버 로그인 UI | `frontend/src/app/auth/login/page.tsx` | 초록색 네이버 버튼, 콜백 처리 | `visual-engineering`, `["frontend-ui-ux"]` |

**선행 작업**:
- Kakao Developers 앱 등록 + Redirect URI 설정
- 네이버 개발자센터 앱 등록 + Redirect URI 설정

---

### Phase 3: 사용자 경험 개선

> **목표**: 비밀번호 복구, 닉네임 검증 등 부가 기능 추가
> 
> **완료 조건**: 완성도 높은 인증 시스템

**작업 흐름**:
```
Step 1: 비밀번호 재설정 API ←─── 이메일 발송 서비스 필요 (Phase 1에서 완료)
        │
        ↓
Step 2: 비밀번호 재설정 UI
        │
        ↓ (독립적)
Step 3: 닉네임 중복 체크 API
        │
        ↓
Step 4: 닉네임 실시간 검증 UI
        │
        ↓ (독립적)
Step 5: Toast 에러 핸들링
```

**병렬 처리 가능한 작업**:
- 비밀번호 재설정, 닉네임 중복, Toast는 **모두 독립적** → 동시 진행 가능

**각 Step 상세**:

| Step | 작업명 | 파일 | 내용 | 카테고리+스킬 |
|------|--------|------|------|--------------|
| 1 | 비밀번호 재설정 API | `backend/app/api/v1/auth.py` | `/forgot-password`, `/reset-password` | `unspecified-high`, `["git-master"]` |
| 2 | 비밀번호 재설정 UI | `frontend/src/app/auth/` | 이메일 입력, 새 비밀번호 설정 페이지 | `visual-engineering`, `["frontend-ui-ux"]` |
| 3 | 닉네임 중복 체크 API | `backend/app/api/v1/auth.py` | `/check-nickname` | `quick`, `["git-master"]` |
| 4 | 닉네임 실시간 검증 UI | `frontend/src/app/auth/register/` | debounce 적용, 시각적 피드백 | `visual-engineering`, `["frontend-ui-ux"]` |
| 5 | Toast 에러 핸들링 | `frontend/src/lib/api.ts`, `frontend/src/components/ui/` | react-hot-toast 또는 Radix Toast | `visual-engineering`, `["frontend-ui-ux"]` |

---

### Phase 4: 테스트 인프라 구축

> **목표**: 안정적인 코드 품질 확보
> 
> **완료 조건**: 핵심 기능에 대한 테스트 커버리지 확보

**작업 흐름**:
```
Step 1: pytest 설정 (conftest.py, fixture)
        │
        ↓
Step 2: 인증 API 유닛 테스트
        │
        ↓ (독립적)
Step 3: Playwright 설정
        │
        ↓
Step 4: 회원가입/로그인 E2E 테스트
```

**각 Step 상세**:

| Step | 작업명 | 파일 | 내용 | 카테고리+스킬 |
|------|--------|------|------|--------------|
| 1 | pytest 설정 | `backend/tests/conftest.py`, `backend/pytest.ini` | 테스트 DB, 클라이언트 fixture | `unspecified-high`, `["git-master"]` |
| 2 | 인증 API 테스트 | `backend/tests/test_auth.py` | 회원가입, 로그인, OAuth 테스트 | `unspecified-high`, `["git-master"]` |
| 3 | Playwright 설정 | `frontend/playwright.config.ts` | 브라우저 설정, baseURL | `visual-engineering`, `["playwright"]` |
| 4 | E2E 테스트 | `frontend/tests/auth.spec.ts` | 전체 인증 흐름 테스트 | `visual-engineering`, `["playwright", "dev-browser"]` |

---

### Phase 5: K8S 배포 준비

> **목표**: Kubernetes 환경에 배포 가능한 상태로 만들기
> 
> **완료 조건**: K8S 매니페스트 완성, 로컬 minikube 테스트 통과

**작업 흐름**:
```
Step 1: Docker 멀티스테이지 빌드 ─────────────────┐
                                                   │
Step 2: Health Check 엔드포인트 (/health, /ready) ─┤ (병렬 가능)
                                                   │
Step 3: ConfigMap/Secret 템플릿 ───────────────────┘
        │
        ↓ 모든 준비 완료 후
Step 4: K8S Deployment/Service 작성
        │
        ↓
Step 5: Ingress + TLS 설정
        │
        ↓
Step 6: HPA (Horizontal Pod Autoscaler) 설정
```

**병렬 처리 가능한 작업**:
- Step 1, 2, 3은 **모두 독립적** → 동시 진행 가능
- Step 4~6은 순차적 진행 권장

**각 Step 상세**:

| Step | 작업명 | 파일 | 내용 | 카테고리+스킬 |
|------|--------|------|------|--------------|
| 1 | Docker 최적화 | `backend/Dockerfile`, `frontend/Dockerfile` | 멀티스테이지 빌드, 이미지 크기 최적화 | `unspecified-high`, `["git-master"]` |
| 2 | Health Check | `backend/app/main.py` | `/health`, `/ready` 엔드포인트 | `quick`, `["git-master"]` |
| 3 | ConfigMap/Secret | `infra/k8s/configmap.yaml`, `infra/k8s/secret.yaml` | 환경 변수 분리 | `unspecified-high`, `["git-master"]` |
| 4 | Deployment/Service | `infra/k8s/backend/`, `infra/k8s/frontend/` | Pod, Service 정의 | `unspecified-high`, `["git-master"]` |
| 5 | Ingress + TLS | `infra/k8s/ingress.yaml` | 라우팅, cert-manager | `unspecified-high`, `["git-master"]` |
| 6 | HPA | `infra/k8s/backend/hpa.yaml` | CPU 기반 오토스케일링 | `unspecified-high`, `["git-master"]` |

---

## 4. 의존성 매트릭스

### Phase 1 (인증 시스템)

| 작업 | 선행 작업 | 차단하는 작업 | 병렬 가능 |
|------|----------|--------------|----------|
| /auth/me 완성 | 없음 | AuthContext 연동 | AWS SES 설정 |
| AWS SES 설정 | 없음 | 이메일 발송 서비스 | /auth/me 완성 |
| AuthContext 연동 | /auth/me 완성 | 이메일 인증 UI | 이메일 발송 서비스 |
| 이메일 발송 서비스 | AWS SES 설정 | /verify-email | AuthContext 연동 |
| /verify-email | 없음 | 이메일 인증 UI | 이메일 발송 서비스 |
| 이메일 인증 UI | AuthContext, 이메일 발송, /verify-email | 없음 | 없음 |

### Phase 2 (소셜 로그인)

| 작업 | 선행 작업 | 차단하는 작업 | 병렬 가능 |
|------|----------|--------------|----------|
| Kakao OAuth 백엔드 | Kakao 앱 등록 | Kakao UI, 네이버 백엔드 | 없음 |
| Kakao 로그인 UI | Kakao 백엔드 | 없음 | 네이버 백엔드 |
| 네이버 OAuth 백엔드 | 네이버 앱 등록, Kakao 백엔드 (패턴) | 네이버 UI | Kakao UI |
| 네이버 로그인 UI | 네이버 백엔드 | 없음 | 없음 |

### Phase 3 (사용자 경험)

| 작업 | 선행 작업 | 차단하는 작업 | 병렬 가능 |
|------|----------|--------------|----------|
| 비밀번호 재설정 API | 이메일 발송 서비스 | 비밀번호 재설정 UI | 닉네임 API, Toast |
| 비밀번호 재설정 UI | 비밀번호 재설정 API | 없음 | 닉네임 UI, Toast |
| 닉네임 중복 체크 API | 없음 | 닉네임 UI | 비밀번호 API, Toast |
| 닉네임 실시간 검증 UI | 닉네임 API | 없음 | 비밀번호 UI, Toast |
| Toast 에러 핸들링 | 없음 | 없음 | 전부 |

### Phase 5 (K8S)

| 작업 | 선행 작업 | 차단하는 작업 | 병렬 가능 |
|------|----------|--------------|----------|
| Docker 멀티스테이지 빌드 | 없음 | K8S Deployment | Health Check, ConfigMap |
| Health Check 엔드포인트 | 없음 | K8S Deployment | Docker, ConfigMap |
| ConfigMap/Secret | 없음 | K8S Deployment | Docker, Health Check |
| K8S Deployment/Service | Docker, Health Check, ConfigMap | Ingress | 없음 |
| Ingress + TLS | K8S Deployment | HPA | 없음 |
| HPA | Ingress (optional) | 없음 | 없음 |

---

## 5. 잠재적 문제점

### 보안

| 문제 | 영향도 | 현재 상태 | 해결 방안 |
|------|--------|----------|----------|
| 이메일 미인증 사용자 로그인 가능 | **HIGH** | 발생 중 | Phase 1에서 이메일 인증 구현 |
| HTTPS 리다이렉트 없음 | **HIGH** | 미구현 | Phase 5에서 K8S Ingress TLS 설정 |
| CORS localhost만 허용 | MEDIUM | 개발용 | 배포 시 실제 도메인으로 변경 |
| Rate Limiting 없음 | MEDIUM | 미구현 | API Gateway 또는 미들웨어 추가 |
| CSRF 보호 없음 | MEDIUM | 미구현 | SameSite Cookie 설정 |

### 성능

| 문제 | 영향도 | 현재 상태 | 해결 방안 |
|------|--------|----------|----------|
| 이메일 발송 동기 처리 예정 | MEDIUM | 미구현 | FastAPI BackgroundTasks 사용 |
| MongoDB 인덱스 미설정 | MEDIUM | 미확인 | email, nickname 필드 인덱스 추가 |
| Docker 이미지 크기 | LOW | 미최적화 | 멀티스테이지 빌드로 최적화 |

### 기술 부채

| 부채 | 영향도 | 현재 상태 | 해결 방안 |
|------|--------|----------|----------|
| 테스트 전무 | **HIGH** | 발생 중 | Phase 4에서 테스트 인프라 구축 |
| 구조화된 로깅 없음 | MEDIUM | print문 사용 | structlog/loguru 도입 |
| ESLint/Prettier 설정 불명확 | LOW | 기본 설정 | 린트 규칙 정리 |
| React Error Boundary 없음 | MEDIUM | 미구현 | Phase 3에서 추가 |

---

## 6. K8S 확장 시 필요한 작업

> K8S 배포 시 참고할 체크리스트입니다.

### 6.1 Docker 이미지

- [ ] Backend: 멀티스테이지 빌드 (목표: < 500MB)
- [ ] Frontend: Next.js standalone 빌드 (목표: < 300MB)
- [ ] docker-compose 로컬 테스트 통과

### 6.2 Health Check

- [ ] `/health` 엔드포인트 (Liveness Probe용)
- [ ] `/ready` 엔드포인트 (Readiness Probe용, MongoDB/Redis 연결 확인)

### 6.3 설정 분리

**ConfigMap (환경 변수)**:
- `BACKEND_URL`
- `FRONTEND_URL`
- `ENABLE_KAKAO_LOGIN`
- `ENABLE_NAVER_LOGIN`

**Secret (민감 정보)**:
- `JWT_SECRET_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `MONGODB_URI`
- `REDIS_URL`
- `GOOGLE_CLIENT_SECRET`
- `KAKAO_CLIENT_SECRET`
- `NAVER_CLIENT_SECRET`

### 6.4 K8S 리소스

- [ ] Namespace 생성
- [ ] Backend Deployment + Service
- [ ] Frontend Deployment + Service
- [ ] Ingress (TLS 포함)
- [ ] HPA (CPU 기반 오토스케일링)
- [ ] PodDisruptionBudget (선택)

### 6.5 K8S 디렉토리 구조

```
infra/k8s/
├── namespace.yaml
├── configmap.yaml
├── secret.yaml
├── backend/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── hpa.yaml
├── frontend/
│   ├── deployment.yaml
│   └── service.yaml
└── ingress.yaml
```

### 6.6 Docker 이미지 예시

**Backend (FastAPI)**:
```dockerfile
FROM python:3.11-slim as builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --user -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
ENV PATH=/root/.local/bin:$PATH
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Frontend (Next.js)**:
```dockerfile
FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### 6.7 Health Check 예시

```python
# backend/app/main.py

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/ready")
async def readiness_check():
    try:
        # MongoDB 연결 확인
        await db.command("ping")
        # Redis 연결 확인 (있는 경우)
        # await redis.ping()
        return {"status": "ready"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "error": str(e)}
        )
```

---

## 7. 카테고리+스킬 요약

| 카테고리 | 스킬 | 적용 작업 |
|----------|------|----------|
| `visual-engineering` | `["frontend-ui-ux"]` | AuthContext, 이메일 인증 UI, OAuth UI, 비밀번호 재설정 UI, 닉네임 UI, Toast |
| `visual-engineering` | `["playwright", "dev-browser"]` | E2E 테스트 |
| `unspecified-high` | `["git-master"]` | 백엔드 API, AWS SES, 이메일 서비스, Docker, K8S, pytest |
| `quick` | `["git-master"]` | 닉네임 중복 체크 API, Health Check |

---

## 8. 완성도 요약

| 카테고리 | 완료 | 미완료 | 완성도 |
|----------|------|--------|--------|
| 인증 시스템 | 4 | 7 | 36% |
| 소셜 로그인 | 2 | 4 | 33% |
| 자산 관리 | 6 | 0 | 100% |
| 마켓 데이터 | 3 | 0 | 100% |
| UI/UX | 3 | 2 | 60% |
| 테스트 | 0 | 4 | 0% |
| 인프라 | 1 | 6 | 14% |
| 보안 | 3 | 4 | 43% |
| **전체** | **22** | **27** | **45%** |
