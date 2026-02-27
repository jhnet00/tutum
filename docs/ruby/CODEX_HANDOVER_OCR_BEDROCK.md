# Codex 핸드오버: OCR, Bedrock 및 모니터링 연동 지침

현재 `tutum.my` 인프라와 백엔드 기본 라우팅은 안정화되었으며, OCR 및 AI 연동을 위한 사전 인프라 구성 단계까지 완료되었습니다. 다음 어시스턴트는 이 지침을 바탕으로 실 서비스 연동을 완료하시기 바랍니다.

---

## 1. 현재 상태 요약 (Working vs Pending)

### ✅ 정상 작동 (Working)

- **도메인 라우팅**: `https://tutum.my` API 프록시 및 CORS/Charset 문제 해결.
- **인증**: 일반 로그인 및 Google/Naver 소셜 로그인 연동 완료.
- **데이터 파이프라인**: Upbit/KIS 시세의 Redis 캐싱(`price:{symbol}`).

### 🛠️ 구현 완료 (검증 필요)

- **OCR 프론트엔드**: `ocr/page.tsx` 하드코딩 제거 및 `/api/proxy` 라우팅 적용.
- **OCR 프록시**: `route.ts` 내 `/api/proxy/import/*` → `ocr:8002` 내부 라우팅 로직 추가.
- **인프라**: OCR Deployment/Service 매니페스트(`ocr.yaml`) 및 Secret(`GOOGLE_API_KEY`) 등록.

### ❌ 미해결/진행 예정 (Pending)

- **OCR Pod**: 매니페스트는 작성되었으나, 실제 Pod 기동 및 헬스체크 확인 필요.
- **MinIO**: OCR 이미지 저장 시 MinIO 버킷(`ocr-images`)과의 통신 검증.
- **Bedrock**: AWS 자격 증명은 설정되었으나, AI 챗봇의 실시간 스트리밍(SSE) 응답성 최종 확인.
- **Grafana**: Admin 페이지 내 대시보드 Iframe이 `admin.tutum.my`를 통해 정상 표시되는지 확인.

---

## 2. Codex 수행 지침 (Action Items)

### 1단계: OCR 서비스 최종 배포 및 검증

- [ ] SSH를 통해 K8s 클러스터에 접속하여 OCR Pod 상태 확인:
  ```bash
  kubectl apply -f k8s-manifests/base/workers/ocr.yaml
  kubectl get pods -n tutum-app | grep ocr
  ```
- [ ] 프론트엔드 OCR 페이지에서 이미지 업로드를 수행하고, 브라우저 콘솔 및 프록시 로그 확인.

### 2단계: Bedrock AI 챗봇 연결 테스트

- [ ] 챗봇 페이지에서 질문을 입력하여 `bedrock-runtime` 호출 시 권한 오류나 타임아웃이 발생하는지 점검.
- [ ] `StreamingResponse`가 브라우저까지 끊김 없이 도달하는지 네트워크 탭 확인.

### 3단계: 모니터링 대시보드 최적화

- [ ] `admin/page.tsx` 접속 시 Grafana 패널이 정상 출력되는지 확인.
- [ ] 필요 시 Cloudflare Tunnel의 `admin.tutum.my` 서비스 대상을 Grafana SVC로 정정.

---

## 3. 핵심 참고 파일

- **환경 변수**: `backend/.env` (모든 API 키 및 패스워드 포함)
- **K8s 구성**: `k8s-manifests/base/workers/ocr.yaml`
- **프록시 로직**: `frontend/app/api/proxy/[...path]/route.ts`
- **OCR UI**: `frontend/app/asset-upload/ocr/page.tsx`
