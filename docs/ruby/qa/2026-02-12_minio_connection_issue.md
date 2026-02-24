# 🐛 QA & Troubleshooting Log (2026-02-12)

## 🚨 Issue: MinIO Connection Timeout from Host

### 📝 증상

- 호스트 머신(Windows)에서 Node2(192.168.0.28)의 MinIO 서비스 포트(9000)로 직접 접근 시 연결 타임아웃 발생.
- `ping 192.168.0.28`은 성공하나, `curl http://192.168.0.28:9000/minio/health/live` 실패.
- Node2 내부에서는 `localhost:9000` 접속 가능.

### 🔍 원인 분석

1. **네트워크 바인딩**: `netstat -tln` 확인 결과 `0.0.0.0:9000`으로 바인딩되어 있어 문제 없음.
2. **방화벽/네트워크 격리**: VirtualBox 또는 OS 레벨의 방화벽이 외부 접근을 차단하고 있거나, Host-only 네트워크 어댑터 설정의 미묘한 이슈로 추정됨.

### ✅ 해결 방법 (Workaround)

SSH 포트 포워딩을 통해 안전한 터널링 연결을 구축함.

```bash
# 로컬 포트 9000, 9001을 원격 Node2의 포트로 포워딩
ssh -p 2212 -L 9000:localhost:9000 -L 9001:localhost:9001 clouddx@192.168.0.28 -N
```

이후 `.env` 설정을 다음과 같이 변경하여 해결:

```bash
MINIO_ENDPOINT="localhost:9000"
```

---

## 🧪 QA 체크리스트 (MinIO Integration)

| 항목             | 테스트 내용                             | 결과 | 비고                           |
| :--------------- | :-------------------------------------- | :--: | :----------------------------- |
| **Connectivity** | 호스트 -> Node2 MinIO 연결 (SSH Tunnel) |  ✅  | `setup_minio.py` script        |
| **Buckets**      | `ocr-images` 버킷 생성 확인             |  ✅  | Initialized via docker-compose |
| **Buckets**      | `profile-images` 버킷 생성 확인         |  ✅  | Initialized via docker-compose |
| **OCR Service**  | 이미지 업로드 시 MinIO 저장 (메모리 x)  |  ✅  | Logs verified                  |
| **OCR Service**  | MinIO 장애 시 메모리 Fallback 동작      |  ✅  | Code logic verified            |
