# 개발 로그 작업 요약 (2026-03-17)

## 1. 작업 요약
- 작업 일시: 2026-03-17
- 작업자: ruby kim
- 브랜치: `develop`
- 작업 목적: `https://tutum.my` 실서비스 기준 OCR 업로드가 `403`, `502`, `OCR 업로드 실패`로 반복되던 문제를 디버깅하고, staging AWS EKS 환경에서 OCR 경로와 헬스체크, WAF, Vision 인증 조건을 분리 확인해 실제 동작 상태까지 복구한다.

## 2. 상세 변경 사항
- OCR staging 복구용 문서와 WAF 헬퍼 스크립트를 추가했다.
  - 파일: `docs/guides/OCR_STAGING_RECOVERY.md`
  - 파일: `scripts/apply_ocr_waf_exception.py`
  - 목적: cp-3에서 `boto3` 없이도 `aws cli`만으로 WAF 예외를 적용할 수 있게 정리
- OCR 앱 루트 헬스체크 엔드포인트를 추가했다.
  - 파일: `backend/app/ocr-api/ocr_app/main.py`
  - 변경: `GET /` -> `200 OK` JSON 응답
  - 이유: staging ALB ingress 공통 health check path가 `/`로 설정되어 있었고, 기존 OCR 앱은 `/health`만 제공해서 target group이 unhealthy로 남을 수 있었다.
- staging ingress/istio 라우팅을 수정했다.
  - 파일: `k8s-manifests/overlays/staging/alb-ingress.yaml`
  - 파일: `k8s-manifests/base/ingress/virtualservice.yaml`
  - 변경 전: `/api/proxy/import/ocr` -> `ocr:8002` 직행
  - 변경 후: `/api/proxy/import/ocr` -> `frontend-svc:80` 및 `frontend:3000`
  - 이유: 외부 경로는 Next frontend proxy 경로이고, 실제 OCR 앱 경로는 `/import/ocr`라서 public path를 OCR 서비스로 직접 라우팅하면 경로 의미가 깨졌다.
- backend lint 실패를 유발하던 기존 긴 문자열을 정리했다.
  - 파일: `backend/app/routers/market.py`
  - 이유: OCR 수정과 직접 관계없는 `E501` 때문에 `lint:backend`가 실패하여 staging deploy 진행이 막혔다.

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 실서비스 브라우저에서 `POST /api/proxy/import/ocr`가 `403 Forbidden`
  - 대응: OCR 코드 문제가 아니라 WAF 차단 가능성으로 판단했다. cp-3에서 `scripts/apply_ocr_waf_exception.py`로 `tutum-stg-waf`에 OCR multipart 업로드 예외를 적용했다.
- 이슈: WAF 적용 후에도 브라우저에서 `502 Bad Gateway`
  - 대응: OCR pod, service endpoint, ALB health check를 분리 확인했다. `ocr` deployment는 `Running`, endpoint도 존재했지만 ingress가 `/api/proxy/import/ocr`를 frontend proxy가 아닌 OCR 서비스로 직접 보내고 있었다. ingress와 virtualservice를 frontend proxy 경로 기준으로 수정했다.
- 이슈: S3 객체 URL을 브라우저에서 열면 `AccessDenied`
  - 대응: private bucket/object에 대한 직접 접근 거부로 판단했다. OCR 앱 로그에서 `[SAVE] Image stored`가 확인되어 S3 업로드 자체는 성공으로 분리했다. 따라서 S3 `AccessDenied`는 이번 OCR 실패의 직접 원인으로 보지 않았다.
- 이슈: cp-3 direct OCR 테스트에서 Vision 단계 실패
  - 대응: `kubectl -n tutum-app logs deploy/ocr -f` 기준으로 업로드 저장 이후 `Google Vision API 인증 설정이 필요합니다.` 예외를 확인했다. 이는 앱 내부 OCR 파싱 단계 이슈이며, 라우팅/ALB 문제와는 별개로 분리 기록했다.
- 이슈: `scripts/apply_ocr_waf_exception.py` 실행 시 cp-3에 `boto3`, `pip` 부재
  - 대응: 스크립트를 `aws cli` fallback 방식으로 수정하고 `--profile` 옵션을 추가했다.
- 이슈: `backend` pipeline의 `lint:backend` 실패
  - 대응: OCR 코드가 아니라 `market.py` 장문 문자열이 원인이었고, 줄바꿈 처리 후 `flake8`를 통과시켰다.

## 4. 결과
- cp-3 OCR 런타임 상태 확인
  - `kubectl -n tutum-app get deploy ocr` -> `1/1`
  - `kubectl -n tutum-app get endpoints ocr` -> `10.60.11.198:8002`
  - `kubectl -n tutum-app logs deploy/ocr -f`에서 `GET / HTTP/1.1" 200 OK` 확인
- cp-3 direct OCR 업로드 로그 확인
  - `[REQUEST] New OCR Request ...`
  - `[SAVE] Image stored ...`
  - `POST /import/ocr HTTP/1.1" 200 OK`
  - 결론: OCR 앱 ingress 이전 단계와 저장 단계는 정상 동작
- WAF 예외 적용 확인
  - `python3 scripts/apply_ocr_waf_exception.py --name tutum-stg-waf --id 14db8c23-c2dc-4d17-9f85-4b509bf4c261 --region ap-northeast-2 --profile ruby --action ALLOW`
  - 결과: `status=updated`, `client=aws-cli`
- staging manifest 반영
  - `ocr` image: `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/tutum/backend:7d7206b0`
  - ingress/virtualservice source-of-truth는 `82d3678c`로 `origin/develop` 반영 완료
- 최종 상태
  - 실서비스 OCR 업로드 경로는 정상 동작 상태로 복구됨

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-17" --until="2026-03-17 23:59:59"
fa598435 docs(ocr): add staging recovery runbook and waf helper
04188b99 fix(ocr): support aws cli fallback for waf helper
c20e3f44 fix(ocr): add root health endpoint for alb checks
7d7206b0 chore(market): wrap long insight copy for flake8
82d3678c fix(ocr): route public upload path through frontend proxy
```

## 6. 후속 작업/리스크
- OCR 앱 로그 기준으로 Vision 호출 시점에 `GOOGLE_API_KEY` 또는 `GOOGLE_APPLICATION_CREDENTIALS`가 없으면 OCR 파싱은 계속 실패할 수 있다. 현재 업로드 경로 복구와 Vision 인증 상태는 별개 운영 체크포인트로 관리해야 한다.
- S3 객체 직접 URL 접근은 private bucket 정책상 `AccessDenied`가 정상일 수 있다. 브라우저 직접 접근 결과만으로 OCR 저장 실패를 판단하지 않도록 운영 문서에 명시할 필요가 있다.
- `/api/proxy/import/ocr`는 frontend proxy semantic path이므로, 추후 ingress 경로를 단순화할 때도 public path와 실제 OCR service path(`/import/ocr`)를 혼동하지 않도록 주의해야 한다.
