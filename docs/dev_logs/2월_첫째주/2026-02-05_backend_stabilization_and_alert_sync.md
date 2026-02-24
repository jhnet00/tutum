# 개발 로그 - 2026-02-05: 백엔드 안정화 및 알림 시스템 통합

## 개요

백엔드 서비스의 비정상 가동 문제를 해결하고, `kyk/0205-alert-system` 브랜치의 기능을 `develop` 브랜치에 성공적으로 통합함.

## 변경 사항

### 1. 백엔드 안정화 (Backend Stabilization)

- **Redis 비정상 연결 대응**: `backend/app/cache.py`를 수정하여 Redis 서버가 꺼져 있어도 메인 API 서버가 정상적으로 시작되도록 함 (Non-fatal connection).
- **KIS API 토큰 Fallback**: Redis 연결 실패 시 토큰을 로컬 파일(`.kis_token`)에 캐싱하여 API 호출 횟수 제한(Rate Limit) 문제를 방지함.
- **프로세스 관리**: 중복 실행되던 수십 개의 Python, Node, PowerShell 프로세스를 정리하고 표준화된 실행 환경 구축.

### 2. 브랜치 병합 및 충돌 해결 (Git Management)

- **`ruby/merge` 브랜치**: 작업 내용 보존을 위해 별도 브랜치 생성 및 `ruby-backup0205` 병합.
- **충돌 해결**: `AssetContext.tsx` (자산 관리 기능 통합), `tooltip.tsx`, `dropdown-menu.tsx` (머지 마커로 인한 빌드 에러 수정).
- **`develop` 브랜치 통합**: 모든 안정화 및 기능 추가 사항을 최종 `develop` 브랜치에 반영.

### 3. 알림 시스템 통합 (Alert System Integration)

- `kyk/0205-alert-system` 브랜치의 알림 UI 요소(`Popover`, 헤더 알림 아이콘 등)를 현재 프로젝트 구조에 맞게 통합함.

## 검증 결과

- **백엔드(8000)**: 정상 가동 (MongoDB 연결, Redis 미연결 상태에서도 안정적)
- **OCR API(8002)**: 정상 가동
- **프론트엔드(3000)**: 정상 빌드 및 가동 확인

## 향후 과제

- Redis 서버 가동 확인 및 완전한 캐시 기능 복구
- 병합된 알림 기능의 실제 데이터 연동 테스트
