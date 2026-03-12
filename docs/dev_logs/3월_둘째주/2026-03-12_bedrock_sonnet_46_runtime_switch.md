# 개발 로그 작업 요약 (2026-03-12)

## 1. 작업 요약
- 작업 일시: 2026-03-12
- 작업자: 김경윤
- 브랜치: develop
- 작업 목적: AWS Bedrock runtime 설정 드리프트를 정리하고 운영 AI 채팅 모델을 Claude Sonnet 4.6 inference profile 기준으로 통일

## 2. 상세 변경 사항
- 설정 드리프트 확인
  - `backend/.env`와 운영 `backend-secret`은 기존 `anthropic.claude-3-5-sonnet-20240620-v1:0` 계열 값을 유지
  - `backend/app/config.py`는 default 값이 `global.anthropic.claude-sonnet-4-5-20250929-v1:0`로 분리되어 있었음
  - `backend/app/routers/admin.py`에는 예전 Sonnet 3.5 fallback 문자열이 남아 있었음
- 모델 및 비용 검토
  - AWS Bedrock 문서 기준 `2026-03-12` 시점 Sonnet 4.6은 `ap-northeast-2`에서 inference profile로 사용 가능
  - 기본 input/output token 단가는 Sonnet 4.5 및 사용 중이던 3.5 Sonnet과 동일 수준으로 확인
- 소스 및 시크릿 변경
  - `backend/app/config.py`
    - `BEDROCK_MODEL_ID` 기본값을 `global.anthropic.claude-sonnet-4-6`으로 변경
  - `backend/app/routers/admin.py`
    - 남아 있던 3개 fallback model ID를 `global.anthropic.claude-sonnet-4-6`으로 통일
  - `k8s-manifests/base/backend/secret.yaml`
    - `BEDROCK_MODEL_ID`를 `global.anthropic.claude-sonnet-4-6`으로 변경
  - AWS Secrets Manager `tutum/backend-secret`
    - live runtime model 값을 동일하게 갱신
- 런타임 검증
  - AWS 직접 호출: `ap-northeast-2`에서 `global.anthropic.claude-sonnet-4-6` invoke `200`
  - backend pod 내부 확인: `BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6`
  - backend pod 내부 `boto3` invoke 결과 `200`, 응답 모델 `claude-sonnet-4-6`
  - 외부 확인: `https://tutum.my/api/proxy/api/v1/chat/health` → `200`

## 3. 작업 중 발생 이슈 및 대응
- 이슈: 코드 default, `.env`, 운영 secret, admin fallback 값이 서로 다른 모델 ID를 가리켜 실제 운영 모델이 불명확했음
- 대응: source code, k8s secret, AWS Secrets Manager 값을 모두 `global.anthropic.claude-sonnet-4-6`으로 통일
- 이슈: Sonnet 4.6은 기존 직접 모델 ID 형식이 아니라 inference profile 형식으로 써야 함
- 대응: `global.anthropic.claude-sonnet-4-6`로 변경 후 리전 직접 호출과 backend pod 내부 호출까지 이중 검증
- 이슈: backend rollout 중 일부 파드가 메모리 압박으로 늦게 수렴
- 대응: 서비스 엔드포인트에서 4.6 호출이 정상인 것을 먼저 확인하고, rollout 수렴 상태는 별도로 점검

## 4. 결과
- 검증 항목:
  - model ID 통일 여부
  - AWS Bedrock 직접 호출 성공 여부
  - backend pod 내부 runtime 호출 성공 여부
  - 외부 chat health 응답 여부
- 검증 결과:
  - 운영 AI 채팅 모델이 Claude Sonnet 4.6 inference profile로 통일됨
  - 비용 기준으로는 Sonnet 4.5 대비 추가 인상 없이 전환 가능
  - backend 내부와 외부 health 모두 정상 응답 확인

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-12" --until="2026-03-12 23:59:59"
```

- 관련 커밋:
  - `e0edcd7` `fix(ai): normalize sonnet 4.6 config diff`

## 6. 후속 작업/리스크
- 실제 웹 AI 채팅 시나리오로 응답 품질까지 추가 확인 필요
- backend rollout 중 메모리 압박이 반복되면 노드/리소스 재점검 필요
- `.env` 같은 로컬 참고값과 운영 secret이 다시 드리프트하지 않도록 기준 문서를 유지해야 함
