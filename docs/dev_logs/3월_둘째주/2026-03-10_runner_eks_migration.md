# 2026-03-10 GitLab Runner EKS 이전

- 작업자: 박성준
- 작업 시간: 2026-03-10 (오후)

## 작업 배경

GitLab Runner가 온프렘 VirtualBox K8s 클러스터(192.168.0.x)에서 운영 중이었음.
팀원 노트북(PC)이 꺼지면 worker 노드가 사라져 파이프라인이 실패하는 구조적 문제 발생.
AWS 마이그레이션 계획에 따라 Runner를 EKS(tutum-stg-eks)로 이전.

## 발생 이슈 및 해결

### 이슈 1: registry.gitlab.com ImagePullBackOff

```
Failed to pull image "registry.gitlab.com/gitlab-org/gitlab-runner:alpine-v18.9.0":
dial tcp 35.227.35.254:443: i/o timeout
```

- **원인**: EKS private/public subnet 노드 모두 외부 레지스트리(registry.gitlab.com) 접근 불가
- **해결**: crane으로 ECR에 미러링
  ```
  903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/gitlab-org/gitlab-runner:alpine-v18.9.0
  903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/gitlab-org/gitlab-runner-helper:x86_64-v18.9.0
  ```

### 이슈 2: gitlab.com 연결 불가 (runner 등록 실패)

```
ERROR: Verifying runner... failed
status=execute JSON request: Post "https://gitlab.com/api/v4/runners/verify":
dial tcp 172.65.251.78:443: i/o timeout
```

- **원인**: Runner pod가 public subnet(10.60.2.x) 노드에 스케줄됨
  - Public subnet 노드: public IP 없음, NAT GW 없음 → 인터넷 접근 불가
  - Private subnet 노드(10.60.11.x, 10.60.12.x): NAT GW 경유 인터넷 접근 가능
- **해결**: Helm values에 `nodeSelector` 추가

  ```yaml
  nodeSelector:
    eks.amazonaws.com/nodeclass: private-only  # private subnet 노드 전용 레이블
  ```

### 노드 분류 (EKS Karpenter NodeClass)

| nodeclass | 서브넷 | 인터넷 |
|-----------|--------|--------|
| `private-only` | 10.60.11.x, 10.60.12.x | NAT GW 경유 가능 ✅ |
| `default` | 10.60.1.x, 10.60.2.x | public IP 없음 ❌ |

## 최종 결과

```
gitlab-runner-97d7ccbb6-ztr92   1/1   Running   10.60.12.130   i-00415ea9ac623e7dd
```

- Runner pod: private subnet (10.60.12.130) ✅
- 등록 로그: `Runner registered successfully.` ✅
- 온프렘 runner: Helm uninstall 완료 ✅

## Helm 릴리즈 정보 (EKS tutum-stg-eks)

| 항목 | 값 |
|------|-----|
| Release | `gitlab-runner` |
| Namespace | `gitlab-runner` |
| Chart | `gitlab/gitlab-runner v0.86.0` |
| Runner | v18.9.0 |
| Image | ECR 미러 (alpine-v18.9.0) |
| Tags | `k8s` |
| Concurrent | 10 |
| NodeSelector | `eks.amazonaws.com/nodeclass: private-only` |

## ECR 신규 레포

- `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/gitlab-org/gitlab-runner`
- `903913341620.dkr.ecr.ap-northeast-2.amazonaws.com/gitlab-org/gitlab-runner-helper`

## values 파일

`k8s-manifests/base/runner/gitlab-runner-values.yaml` (runnerToken 제외, --set으로 주입)
