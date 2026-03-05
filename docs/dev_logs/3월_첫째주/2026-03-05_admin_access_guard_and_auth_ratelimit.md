# Admin 접근 제어 강화 및 인증 엔드포인트 Rate Limit 적용

**날짜**: 2026-03-05
**작업자**: 김경윤
**브랜치**: develop

---

## 배경

기존 `/api/v1/admin/*` 엔드포인트는 로그인 여부만 확인하고 접근 가능했음.
운영 보안 정책에 따라 **로그인 + 허용 IP 대역** 이중 조건으로 강화.
기존 이메일 allowlist 분기 방식은 제거.

---

## 변경 내용

### 1. Admin 접근 가드 (`backend/app/routers/admin.py`)

**변경 전**: 이메일 allowlist 또는 IP 기반 혼합 분기
**변경 후**: CIDR 기반 IP allowlist 단일 정책

```python
_DEFAULT_ADMIN_NETWORKS = "127.0.0.1/8,192.168.0.0/24"

_ADMIN_IP_ALLOWLIST = _parse_admin_networks(
    os.getenv("ADMIN_IP_ALLOWLIST", _DEFAULT_ADMIN_NETWORKS)
)

async def require_admin_access(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
) -> UserResponse:
    client_ip = _extract_client_ip(request)
    if not _is_ip_allowed(client_ip):
        raise HTTPException(status_code=403, detail="Admin access denied for this network.")
    return current_user
```

**IP 추출 우선순위**: `X-Real-IP` → `X-Forwarded-For` (마지막 hop) → `request.client.host`

**접근 조건**:
- 로그인 필수 (JWT 미인증 → 401)
- 클라이언트 IP가 CIDR 범위 내 필수 (범위 외 → 403)

**환경변수**:
```
ADMIN_IP_ALLOWLIST=127.0.0.1/8,192.168.0.0/24   # 기본값 (운영 환경 별도 재정의 가능)
```

---

### 2. 인증 엔드포인트 Rate Limit 적용 (`backend/app/routers/auth.py`)

기존에 rate limit이 누락된 엔드포인트에 일괄 적용:

| 엔드포인트 | 적용된 rate limit |
|------------|-------------------|
| `POST /auth/register` | 3회 / 1시간 |
| `POST /auth/login` | 5회 / 5분 |
| `POST /auth/check-email` | 15회 / 5분 (신규) |

---

### 3. Rate Limit 정책 확장 (`backend/app/middleware/rate_limit.py`)

**신규 추가된 rate limit 키**:

```python
"check_email": {"max_requests": 15, "window_seconds": 300},  # 15회/5분
"admin_ai":    {"max_requests": 6,  "window_seconds": 600},  # 6회/10분
```

**Redis 미연결 시 차단 대상 확장**:

```python
# Before
security_endpoints = {"login", "register"}

# After
security_endpoints = {"login", "register", "check_email", "chat", "admin_ai"}
```

Redis 없이 서비스 중단 시 보안/과금 민감 엔드포인트 전체 차단.

---

### 4. `.env.example` 정리

`ADMIN_EMAIL_ALLOWLIST` 제거, `ADMIN_IP_ALLOWLIST` 중심으로 정리:
```env
# Allowed CIDRs for /api/v1/admin/* (requires login + source IP in this list)
ADMIN_IP_ALLOWLIST=127.0.0.1/8,192.168.0.0/24
```

---

## 운영 배포 체크리스트

- [x] `python -m compileall backend/app/routers/admin.py` 검증
- [x] GitLab CI 푸시 (develop 브랜치)
- [ ] ArgoCD backend 롤아웃 확인
- [ ] `192.168.0.x` 대역 → `/api/v1/admin/nodes` **200** 확인
- [ ] 외부망 → `/api/v1/admin/nodes` **403** 확인
- [ ] 미인증 → `/api/v1/admin/nodes` **401** 확인

---

## 비고

- `ADMIN_IP_ALLOWLIST`가 Secret에 없으면 코드 기본값 사용 (`127.0.0.1/8,192.168.0.0/24`)
- 외부망 특정 IP 허용 필요 시 `backend-secret`에 `ADMIN_IP_ALLOWLIST` 추가
