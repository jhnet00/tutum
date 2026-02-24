# 🔧 Troubleshooting Report (2026-02-12)

## 🚨 Issue: MinIO Service Unreachable from Host Machine

### 📝 증상

- **환경**: Windows Host -> VirtualBox Host-only Network -> Node2 (Ubuntu, 192.168.0.28)
- **현상**:
  - `ping 192.168.0.28` 성공 (네트워크 연결 정상)
  - `curl http://192.168.0.28:9000` 타임아웃 (서비스 접근 불가)
  - Node2 내부에서 `curl http://localhost:9000` 성공

### 🔍 원인 분석

- VirtualBox Host-only Network 어댑터의 특성상 특정 포트 트래픽이 차단되거나, Node2의 방화벽(UFW 등) 설정이 외부 접근을 막고 있을 가능성.
- Docker 컨테이너의 포트 매핑(`9000:9000`)은 정상이었으나, 호스트 레벨의 라우팅 문제로 추정.

### ✅ 해결 방법 (Workaround: SSH Tunneling)

직접적인 네트워크 설정을 건드리는 대신, 이미 연결이 확인된 SSH 프로토콜을 이용해 포트를 터널링함.

**명령어**:

```powershell
ssh -p 2212 -L 9000:localhost:9000 -L 9001:localhost:9001 clouddx@192.168.0.28 -N
```

**결과**:

- 호스트의 `localhost:9000`이 Node2의 `localhost:9000`으로 안전하게 포워딩됨.
- 개발 환경(`.env`)에서 `MINIO_ENDPOINT="localhost:9000"`으로 설정하여 정상 연동 성공.

---

### 📚 Lessons Learned

- 로컬/원격 하이브리드 개발 환경에서 네트워크 이슈 발생 시, **SSH 터널링**은 가장 빠르고 안전한 우회로를 제공한다.
- 인프라 설정 변경(방화벽 해제 등)보다 터널링이 개발 단계에서는 더 적합할 수 있다.
