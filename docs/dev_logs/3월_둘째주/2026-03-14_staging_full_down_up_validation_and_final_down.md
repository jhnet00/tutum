# 개발 로그 작업 요약 (2026-03-14)

## 1. 작업 요약
- 작업 일시: 2026-03-14
- 작업자: 김민수
- 브랜치: develop
- 작업 목적: `STAGING_FULL_DOWN_OPERATION_GUIDE_2026-03-13.md` 기준으로 staging `full down -> full up` 왕복 검증을 수행하고, 복구 기준선 확인 후 최종 `full down`을 실행한다.

## 2. 상세 변경 사항
- `scripts/eks-cost-down.sh`
  - Windows PowerShell 환경에서도 `bash scripts/eks-cost-down.sh`가 바로 동작하도록 LF 줄바꿈 기준으로 정리했다.
- `scripts/eks-cost-up.sh`
  - Windows PowerShell 환경에서도 `bash scripts/eks-cost-up.sh`가 바로 동작하도록 LF 줄바꿈 기준으로 정리했다.
- `scripts/decommission-prod-eks.sh`
  - 동일한 shell 실행 안정성을 위해 LF 줄바꿈 기준으로 정리했다.
- `.gitattributes`
  - `*.sh text eol=lf` 규칙을 추가해 이후 체크아웃에서도 shell 스크립트가 LF로 유지되도록 설정했다.
- 운영 실행
  - 기준선 확인 후 `full down` 실행
  - `full up` 실행 및 복구 상태 확인
  - 복구 기준선 확인 후 최종 `full down` 재실행

## 3. 작업 중 발생 이슈 및 대응
- 이슈: Windows에서 `bash scripts/eks-cost-down.sh`를 직접 실행하면 `set: pipefail: invalid option name` 오류로 즉시 실패했다.
- 대응:
  - 원인을 CRLF 줄바꿈으로 확인했고, shell 스크립트 3종과 `.gitattributes`를 LF 기준으로 정리했다.
- 이슈: `full up` 실행 시 monitoring EC2 시작 단계에서 경고가 발생했다.
- 대응:
  - 인스턴스 상태를 확인해 `stopped` 상태임을 확인했고, `aws ec2 start-instances`를 수동 재시도해 `running` 상태까지 복구했다.
- 이슈: `sonar.tutum.my`는 왕복 테스트 이전부터 `503`이었다.
- 대응:
  - 복구 판정 기준을 “모든 경로 200”이 아니라 “왕복 테스트 전 기준선으로 복귀했는지”로 두고 검증했다.

## 4. 결과
- 기준선 확인
  - `kubectl get app -n argocd tutum-staging` -> `Synced / Healthy`
  - `curl -I https://tutum.my/` -> `200`
  - `curl -I https://sonar.tutum.my/` -> `503` (왕복 테스트 전 기준선)
  - `curl -I https://kiali.tutum.my/kiali/` -> `200`
- 왕복 테스트
  - `full down` 실행 후 `tutum.my`, `sonar.tutum.my`, `kiali.tutum.my/kiali/` 모두 `503`
  - `full up` 실행 후 `tutum-staging`이 `Synced / Healthy`로 복귀
  - 복구 후 `tutum.my` -> `200`, `kiali` -> `200`, `sonar` -> `503`으로 기준선 복귀 확인
  - monitoring EC2 -> `running`
- 최종 상태
  - 최종 `full down` 재실행 완료
  - 현재 `tutum.my`, `kiali.tutum.my/kiali/` -> `503`
  - monitoring EC2 -> `stopping`
- 스크립트 검증
  - `bash -n scripts/eks-cost-down.sh`
  - `bash -n scripts/eks-cost-up.sh`
  - `bash -n scripts/decommission-prod-eks.sh`
  - 모두 통과

## 5. 커밋 로그
```bash
git log --oneline --since="2026-03-14 00:00:00" --until="2026-03-14 23:59:59"
```

## 6. 후속 작업/리스크
- 현재 staging은 의도적으로 `full down` 상태이므로 `tutum.my`, `kiali`, `sonar` 공개 경로는 비정상 응답이 정상이다.
- `sonar.tutum.my`는 왕복 테스트 이전부터 `503` 기준선이었으므로, 별도 원인 분석이 필요하다.
- 비용은 줄었지만 0원이 되지는 않으며 EKS control plane, NAT, EBS/PVC, RDS, ALB, Route53, WAF, CloudWatch 비용은 계속 발생한다.
