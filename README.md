# TUTUM

TUTUM은 사용자의 투자 자산을 한 곳에서 관리하고, 실시간 시세, 맞춤형 뉴스, OCR 기반 자산 등록, AI 질의응답까지 연결하는 AI 기반 투자 지원 플랫폼입니다.

이 저장소는 프로젝트의 주요 서비스를 한 곳에서 함께 볼 수 있도록 정리한 GitHub 통합 저장소입니다.

- `tutum-backend`
- `tutum-frontend`
- `auth`

## 프로젝트 개요

TUTUM은 분산된 투자 정보를 한 곳에서 통합해 보여주고, 사용자의 실제 보유 자산과 연결된 정보 탐색 경험을 제공하는 것을 목표로 했습니다.

프로젝트 주요 목표는 다음과 같습니다.

- 자산 및 포트폴리오 통합 관리
- 실시간 시세 조회와 차트 데이터 처리
- 보유 종목 기반 개인화 뉴스 제공
- OCR 기반 자산 등록 자동화
- AI 기반 투자 정보 질의응답 지원
- Kubernetes, CI/CD, 모니터링, 보안, 백업, AWS 운영 환경 구축

## 저장소 구조

```text
tutum/
├─ tutum-backend/     FastAPI 백엔드, 워커, 데이터 파이프라인, Kubernetes 매니페스트, 인프라 문서
├─ tutum-frontend/    Next.js 프론트엔드, BFF 프록시 라우트, 사용자/관리자 UI
└─ auth/              FastAPI 인증 서비스, JWT/OAuth/이메일 인증
```

## 주요 기능

- 포트폴리오 자산 등록 및 관리
- 실시간 시세 조회 및 차트 데이터 처리
- 사용자 보유 자산 기반 맞춤형 뉴스 추천
- OCR 기반 자산 업로드 및 등록
- AI 챗 기반 투자 정보 질의응답
- 관리자용 운영 및 모니터링 화면
- CI/CD, Kubernetes, AWS 기반 운영 자동화

## 아키텍처

### Frontend

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- `/api/proxy`, `/api/public/*` 기반 BFF 구조

### Backend

- FastAPI
- 자산, 포트폴리오, 시세, 뉴스, 알림, 채팅, 관리자 API 제공
- Kafka 기반 비동기 데이터 처리
- OCR 및 AI 연동 기능 포함

### Auth

- FastAPI
- JWT / Refresh Token / CSRF Cookie 기반 인증 처리
- Google / Kakao / Naver OAuth
- 이메일 인증 및 계정 관련 인증 기능 전담

### Data Layer

- MariaDB: 사용자, 포트폴리오, 거래 등 정형 데이터
- MongoDB: 뉴스 원본 및 문서성 데이터
- Redis: 캐시 및 실시간 가격 조회
- Kafka: 비동기 이벤트 스트리밍
- Elasticsearch: 검색, 색인, RAG 검색용 데이터 활용

## 인프라 및 운영

이 프로젝트는 애플리케이션 개발뿐 아니라 인프라와 운영 체계 구축도 중요한 범위였습니다.

- Docker / Docker Compose 기반 개발 환경
- Kubernetes 기반 서비스 분리 및 오케스트레이션
- AWS 마이그레이션 및 EKS 기반 배포
- GitLab CI/CD 파이프라인 구성 및 안정화
- ArgoCD 기반 GitOps 배포
- KEDA 기반 이벤트 스케일링
- Karpenter + Spot 기반 비용 최적화
- WAF, GuardDuty, CloudTrail, KMS, Secrets Manager 기반 보안 구성
- S3 및 RDS 중심 백업 전략

## 모니터링

운영 가시성을 위해 LGTM 계열 스택을 활용했습니다.

- Grafana
- Loki
- Tempo
- Mimir

주요 운영 지표는 다음과 같습니다.

- API latency
- error rate
- Kafka lag
- worker 상태
- 데이터 계층 가용성

## 데이터 흐름 요약

### 뉴스 파이프라인

- Python 워커가 외부 뉴스 소스를 수집
- producer가 Kafka로 원본 뉴스 전달
- MongoDB consumer가 원본 문서 저장
- Elasticsearch consumer가 검색 및 RAG 활용용 색인 처리

### 시세 파이프라인

- price producer가 외부 시세 공급원에서 데이터 수집
- Kafka 토픽을 현재가용 / 캔들용으로 분리
- Redis에 최신 시세 캐시 저장
- 캔들 집계 로직이 차트용 시계열 데이터 생성

## 이 저장소를 만든 이유

원래 프로젝트 작업은 서비스별로 나뉘어 있었지만, GitHub에서는 전체 프로젝트를 한 번에 검토할 수 있도록 `frontend`, `backend`, `auth`를 한 저장소에서 볼 수 있게 정리했습니다.

즉, 이 저장소는 단일 애플리케이션 저장소라기보다 프로젝트 전체를 함께 확인하기 위한 통합 진입점 역할을 합니다.

## 시작하기

각 서비스는 개별 디렉터리에서 확인하고 실행하면 됩니다.

- [tutum-backend](./tutum-backend)
- [tutum-frontend](./tutum-frontend)
- [auth](./auth)

실행 방법과 환경 변수 설정은 각 디렉터리 내부의 `README` 및 `.env.example` 파일을 참고하면 됩니다.

## 참고 사항

- 프론트엔드만 실행하면 UI 껍데기 확인은 가능하지만, 로그인, 맞춤 뉴스, 실시간 데이터 기능은 백엔드 및 의존 서비스가 필요합니다.
- 백엔드는 MariaDB, MongoDB, Redis, 일부 흐름에서는 Kafka와 Elasticsearch까지 필요로 합니다.
- 이 저장소는 코드뿐 아니라 배포, 모니터링, 백업, 보안, 비용 최적화까지 포함한 운영 관점의 결과도 함께 담고 있습니다.
