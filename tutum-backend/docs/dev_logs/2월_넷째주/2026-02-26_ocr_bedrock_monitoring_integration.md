# 개발 로그 작업 요약 (2026-02-26)

## 1. 작업 요약

- 작업 일시: 2026-02-26
- 작업자: 김루비 (Ruby Kim)
- 협업: CloudDX
- 작업 목적: OCR 서비스 배포, Bedrock AI 챗봇 연동 최적화, Grafana 대시보드 도메인 연결 설정

---

## 2. 상세 변경 사항

### 2-1. OCR 서비스 및 인프라 구축

- **Backend 의존성**: `requirements.txt`에 `google-cloud-vision` 추가.
- **K8s Manifest**: OCR 전용 Deployment/Service (`ocr.yaml`) 생성 및 `kustomization.yaml` 등록.
- **Secrets**: `backend-secret`에 `GOOGLE_API_KEY` 추가하여 Vision API 인증 환경 조성.

### 2-2. Frontend OCR 및 프록시 라우팅 수정

- **Hardcoding 제거**: `ocr/page.tsx`의 `localhost:8002`를 `/api/proxy` 상대 경로로 변경.
- **Proxy 라우팅**: `route.ts`에 `/api/proxy/import/*` 요청을 내부 `ocr:8002` 서비스로 전달하는 조건문 추가.

### 2-3. Bedrock 및 Grafana 연동 점검

- **Bedrock**: AWS Access Key/Secret Key 및 `anthropic.claude-3-5-sonnet` 모델 ID 설정 확인.
- **Grafana**: Admin 페이지 내 Iframe 주소를 운영 도메인(`admin.tutum.my`)에 맞춰 검토.

---

## 3. 작업 중 발생 이슈 및 대응

| 이슈                       | 원인                                         | 대응                                     |
| -------------------------- | -------------------------------------------- | ---------------------------------------- |
| `ocr/page.tsx` 업로드 오류 | `localhost:8002` 하드코딩으로 인한 연결 거부 | 프록시 라우팅(`api/proxy`) 적용으로 해결 |
| OCR 구동 실패              | Google Vision API 인증 정보(API KEY) 누락    | `.env`에서 키 추출하여 K8s Secret에 반영 |
| K8s 리소스 미반영          | `kustomization.yaml`에 `ocr.yaml` 누락       | 리소스 목록 등록 완료                    |

---

## 4. 결과 (진행 중)

- [x] OCR 서비스 매니페스트 작성 및 등록 완료
- [x] 프론트엔드 API 프록시 라우팅 최적화 완료
- [ ] OCR Pod 배포 및 실제 이미지 업로드 테스트 (진행 예정)
- [ ] Bedrock 실시간 채팅 스트리밍 검증 (진행 예정)

---

## 5. 비고

- OCR 기능 활성화를 위해 `GOOGLE_API_KEY`를 사용하는 방식이 안정적으로 설정되었으나, 도메인 등록 정책에 따른 추가 확인 필요.
- Grafana 대시보드 정상 로딩을 위해 `admin.tutum.my` 도메인의 SSL/Tunnel 상태 재점검 요망.
