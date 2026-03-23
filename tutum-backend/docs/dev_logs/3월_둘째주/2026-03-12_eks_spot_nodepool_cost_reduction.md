# 2026-03-12 EKS Karpenter NodePool Spot 전환 + 비용 절감

## 작업자
박성준

## 작업 배경
- 이틀에 $140 청구 ($70/일) — 10일 추가 운영 시 $700 예상
- 목표: $17.5/일 이하 (현재의 1/4)
- 원인 분석: NodePool이 `on-demand`만 허용 + 인스턴스 크기 제한 없음

## 원인 분석

### 1. on-demand 전용 NodePool (4개 전부)
- `private-general`, `private-system` (커스텀) + `general-purpose`, `system` (EKS Auto Mode 기본) 4개 모두 `capacity-type: on-demand`만 허용
- 특히 `general-purpose`가 9개 노드를 유지하고 있었음 — 비용의 주범
- Spot 인스턴스 미사용 → on-demand 대비 ~70% 추가 비용 발생

### 2. 인스턴스 크기 무제한
- `instance-category: c, m, r` + `generation > 4`만 지정
- Karpenter가 bin-packing 효율을 위해 c5.xlarge($0.17/hr), m5.2xlarge($0.38/hr) 등 대형 인스턴스 선택 가능
- 소수의 xl/2xl 인스턴스가 비용을 크게 끌어올렸을 가능성 높음

## 적용된 변경사항

### k8s-manifests/overlays/staging/private-nodepools.yaml

`private-general`, `private-system` 두 NodePool 동일하게 적용:

```yaml
# 1. Spot 우선, on-demand fallback
- key: karpenter.sh/capacity-type
  operator: In
  values:
    - spot        # 우선 시도 (~70% 절감)
    - on-demand   # spot 없을 때 fallback

# 2. 인스턴스 크기 large 이하로 제한
- key: eks.amazonaws.com/instance-size
  operator: In
  values:
    - small
    - medium
    - large       # xl/2xl/4xl 차단

# 3. NodePool 총량 상한 추가
limits:
  cpu: 32        # private-general
  memory: 64Gi
# (private-system: cpu:16, memory:32Gi)
```

### k8s-manifests/overlays/staging/eks-builtin-nodepools.yaml (신규)

EKS Auto Mode 기본 NodePool(`general-purpose`, `system`)에 동일한 변경 적용:
- `general-purpose`: 9개 노드 운영 중, NodeClass `default` (NAT 없음, ECR VPC endpoint로 이미지 pull)
- `system`: 2개 노드, arm64 아키텍처 추가 허용, `CriticalAddonsOnly` taint 유지
- `kubectl patch`로 즉시 반영 + ArgoCD 관리 대상으로 git에 추가 (영구 유지)

### 최종 상태 (4개 NodePool 전부)

| NodePool | 변경 전 | 변경 후 |
|----------|--------|--------|
| `general-purpose` (9노드) | on-demand, 크기 무제한 | spot+on-demand, large 이하, cpu:32 |
| `private-general` (3노드) | on-demand, 크기 무제한 | spot+on-demand, large 이하, cpu:32 |
| `private-system` (1노드) | on-demand, 크기 무제한 | spot+on-demand, large 이하, cpu:16 |
| `system` (2노드) | on-demand, 크기 무제한 | spot+on-demand, large 이하, cpu:16 |

## 예상 절감 효과

| 항목 | 변경 전 | 변경 후 |
|------|--------|--------|
| EC2 compute | on-demand 100% | spot 우선 (70% 절감) |
| 인스턴스 크기 | xl/2xl 허용 | large 이하만 |
| NodePool 총량 | 무제한 | cpu 32 / mem 64Gi 상한 |
| 일일 shutdown | 적용 중 | 적용 중 |

**추정 일 비용:**
- EC2: $40-50 → ~$3/일 (spot × 9.5h 운영)
- 고정(EKS+NAT+EBS+ALB+WAF): ~$7-9/일
- **합계: ~$10-12/일** (목표 $17.5/일 달성 ✅)

## 주의사항
- **Spot 인터럽션**: MongoDB/Kafka/Elasticsearch 등 StatefulSet이 spot 노드에서 종료될 수 있음
  - 스테이징 환경이므로 데이터 유실 허용 가능
  - Karpenter가 새 노드 프로비저닝 후 pod 자동 재시작
- **레플리카셋(MongoDB/Kafka/Redis)**: 변경하지 않음 — 기존 3-replica 유지

## 커밋
- `8e81d3a` — fix(staging): switch Karpenter NodePools to spot+on-demand with size limits
- `333955d` — fix(staging): add spot+size limits to EKS built-in NodePools (general-purpose, system)
- `fed7bc8` — docs(dev_logs): update 2026-03-12 cost reduction log with all 4 NodePool changes
