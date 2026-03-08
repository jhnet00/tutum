# 2026-03-09: staging 502 재점검 / 1차 조치

## 요약

- `tutum.my` 접속 시 `curl -I https://tutum.my`에서 지속되던 `HTTP/2 502`를
  **ALB/Ingress 헬스체크 경로 불일치 가능성**으로 판단하고 GitOps 매니페스트를 수정함.
- `frontend`는 `/`는 정상 응답(`200`)이지만 `/health`는 404이므로,
  ALB health check가 `/health`일 경우 `frontend-svc`가 unhealthy로 판정될 수 있었음.

## 수정한 항목

1. `k8s-manifests/overlays/staging/kustomization.yaml`
   - `alb-ingress.yaml`을 `resources`에 포함하여 staging 배포 경로에 반영되도록 함.

2. `k8s-manifests/overlays/staging/alb-ingress.yaml`
   - `alb.ingress.kubernetes.io/healthcheck-path`를 `/health` → `/`로 변경
   - `alb.ingress.kubernetes.io/success-codes`를 `200-399`으로 추가

## 다음 확인 포인트 (사용자 환경에서 실행)

1. staging overlay 적용
   - `kubectl apply -k k8s-manifests/overlays/staging`
2. ALB target health 확인
   - `aws elbv2 describe-target-health --target-group-arn <frontend-tg-arn>`
   - `aws elbv2 describe-target-health --target-group-arn <backend-tg-arn>`
3. 도메인 접속 확인
   - `curl -I https://tutum.my`
   - 기대값: `HTTP/2 200`

## 주의

- `base/kustomization.yaml`에 `infra/cloudflared.yaml`이 여전히 포함되어 있어
  base 자체는 터널 자원을 배포하지만, `overlays/staging/replicas-patch.yaml`에서
  `cloudflared`는 `replicas: 0`으로 유지되어 ALB 라우팅 위주 운영에서는 정지 상태여야 함.
