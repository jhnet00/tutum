2. tutum 회원가입 SQS/SES 이메일 인증 시스템 구축
   목표 (흐름)

회원가입 요청 → 인증 토큰 생성/저장 → SQS에 “메일 발송 작업” enqueue

Worker가 SQS 메시지 consume → SES로 메일 발송

유저가 링크 클릭 → 토큰 검증 → 계정 verified 처리

Steps

DB 스키마: email_verification_tokens (userId, tokenHash, expiresAt, usedAt)

API:

POST /auth/signup (토큰 생성 + SQS enqueue)

GET /auth/verify?token=... (검증/만료/1회성 처리)

SQS:

queue 이름 tutum-email-verify-queue

DLQ 설정 (실패 재시도 후 이동)

SES:

발신자 도메인/이메일 검증

템플릿(간단한 HTML)

보안:

token은 DB에 hash 저장

링크 token은 TTL 짧게 (예: 15분~1시간)

관측:

실패/성공 로그 + 메트릭(보내기 성공률)

-

TASK: Implement signup email verification using AWS SQS + SES
CONTEXT:

- Backend: FastAPI
- Async email send via SQS consumer worker
- Token-based verify link (one-time, expires)
  OUTPUT:

1. DB schema (SQL) for verification tokens
2. FastAPI endpoints (signup + verify) with clean code
3. SQS producer code + worker consumer code
4. SES sending code (boto3) + basic HTML email template
5. IAM least-privilege policy for SQS+SES
6. Local dev plan (mock/LocalStack or env toggle)
   CONSTRAINTS:

- Never store plaintext tokens in DB
- Config via env vars; secrets not committed
- Add retries + DLQ guidance

-
