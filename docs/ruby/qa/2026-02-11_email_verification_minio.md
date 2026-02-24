# QA Test Report (2026-02-11)

## Feature: Email Verification & Infrastructure

### 1. Email Verification Flow

Verification of the complete asynchronous email auth pipeline.

| Test Case                    | Procedure                                            | Result                                                                 | Status  |
| :--------------------------- | :--------------------------------------------------- | :--------------------------------------------------------------------- | :------ |
| **New Registration**         | Call `POST /auth/register` with new email            | User created (`is_verified=false`), SES email sent, Token hashed in DB | ✅ Pass |
| **Duplicate Email Check**    | Call `POST /auth/check-email` with existing user     | Returns `available: false` with specific message                       | ✅ Pass |
| **Social Account Detection** | Call `POST /auth/check-email` with a Google user     | Returns message: "GOOGLE 계정으로 이미 가입된 이메일입니다"            | ✅ Pass |
| **Verification Link**        | Click verification link (Direct API call with token) | User status updated to `VERIFIED`, token marked as `USED`              | ✅ Pass |
| **Unverified Login**         | Attempt login with `is_verified=false`               | Backend returns `403 Forbidden`                                        | ✅ Pass |
| **Verified Login**           | Attempt login with `is_verified=true`                | Backend returns JWT Token (200 OK)                                     | ✅ Pass |
| **Token Expiry**             | Check invalid/expired token link                     | Backend returns `400 Bad Request`                                      | ✅ Pass |

### 2. Infrastructure (MinIO)

Verification of object storage availability on private cluster.

| Test Case                 | Procedure                                | Result                                               | Status  |
| :------------------------ | :--------------------------------------- | :--------------------------------------------------- | :------ |
| **Node2 Deployment**      | Verify container health on Node2         | `tutum-minio` status: `healthy`                      | ✅ Pass |
| **Bucket Initialization** | Check `ocr-images`, `profile-images`     | Buckets exist and are correctly initialized via `mc` | ✅ Pass |
| **Backend Connectivity**  | `list_buckets()` call from Node1 backend | Connection established via `192.168.56.12:9000`      | ✅ Pass |

## Test Evidence

- **User Verified**: `rubyjeenkim@gmail.com` (Verified at 2026-02-11 08:56:41)
- **MinIO Logs**: `MinIO buckets initialized successfully` confirmed in Node2 logs.

## Observations

- Polling for verification status (`/verification-status`) returns boolean correctly, making it ready for frontend integration.
- Redirects from the email link correctly point to `FRONTEND_URL/verify-email`.
