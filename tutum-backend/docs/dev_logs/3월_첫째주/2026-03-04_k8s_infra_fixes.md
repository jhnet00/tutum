# K8s 인프라 정리 — harbor-secret 제거 / KEDA 충돌 / NetworkPolicy 수정

- 날짜: 2026-03-04
- 작업자: 박성준

---

## 작업 배경

ArgoCD SSH 점검 중 tutum-staging이 OutOfSync + Degraded 상태임을 확인.
원인 추적 결과 세 가지 독립적 문제가 겹쳐 있었음.

---

## 수정 1: harbor-secret 매니페스트 잔존 제거

### 문제
`k8s-manifests/base/backend/secret.yaml` 에 이미 폐기된 Harbor 레지스트리 Secret 정의가 남아 있었음.
ArgoCD auto-sync가 이를 계속 적용해 잘못된 인증 정보(admin:Himedia123!)의 `harbor-secret`을
클러스터에 재생성하고 있었음.

모든 Deployment(backend, frontend, price-producer, price-consumer,
news-producer, news-consumer, elastic-consumer, email-worker)의
`imagePullSecrets`에도 `harbor-secret`이 남아 있었음.

### 조치
- `base/backend/secret.yaml` 에서 harbor-secret Secret 정의(25줄) 전체 제거
- 위 8개 Deployment에서 `- name: harbor-secret` 항목 제거 (`gitlab-registry-secret`만 유지)

---

## 수정 2: KEDA vs Deployment replicas 충돌 해소

### 문제
`overlays/staging/replicas-patch.yaml`에 backend와 frontend에 대해 `replicas: 1`이
명시돼 있었음. 그러나 KEDA ScaledObject는 `minReplicaCount: 2`로 설정되어 있어
ArgoCD가 매 Sync 시 replicas 값 불일치를 감지 → OutOfSync 반복.

### 조치
`replicas-patch.yaml`에서 backend/frontend의 `replicas: 1` 필드 제거.
리소스 limit/request 패치만 유지 (replicas는 KEDA가 전적으로 관리).

---

## 수정 3: tutum-data NetworkPolicy — keda 네임스페이스 허용

### 문제
KEDA operator(`keda` 네임스페이스)가 Kafka(`tutum-data` 네임스페이스) Consumer Lag 메트릭을
읽지 못해 ScaledObject 3개(elastic-consumer, news-consumer, price-consumer) 전부
`READY: False` 상태였음.

에러:
```
error creating kafka client: kafka: client has run out of available brokers to talk to:
dial tcp 10.108.159.74:9092: i/o timeout
```

`tutum-data`의 기본 차단 정책(default-deny-ingress)에서 `keda` 네임스페이스가 허용 목록에
없어 Kafka 9092 포트 접근이 차단된 것이 원인.

### 조치
`base/security/network-policy.yaml`에 `allow-from-keda` NetworkPolicy 추가:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-keda
  namespace: tutum-data
spec:
  podSelector:
    matchLabels:
      app: kafka
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: keda
```

### 결과
정책 적용 후 ScaledObject 3개 모두 `READY: True` / `ScaledObjectReady` 전환 확인.
tutum-staging ArgoCD 상태: `Synced / Healthy` 복구 완료.

---

## 변경 파일 목록

| 파일 | 내용 |
|------|------|
| `k8s-manifests/base/backend/secret.yaml` | harbor-secret Secret 정의 제거 |
| `k8s-manifests/base/backend/deployment.yaml` | harbor-secret imagePullSecrets 제거 |
| `k8s-manifests/base/frontend/deployment.yaml` | 동일 |
| `k8s-manifests/base/workers/price-producer.yaml` | 동일 |
| `k8s-manifests/base/workers/price-consumer.yaml` | 동일 |
| `k8s-manifests/base/workers/news-producer.yaml` | 동일 |
| `k8s-manifests/base/workers/news-consumer.yaml` | 동일 |
| `k8s-manifests/base/workers/elastic-consumer.yaml` | 동일 |
| `k8s-manifests/base/workers/email-worker.yaml` | 동일 |
| `k8s-manifests/overlays/staging/replicas-patch.yaml` | replicas:1 제거 (KEDA 위임) |
| `k8s-manifests/base/security/network-policy.yaml` | allow-from-keda NetworkPolicy 추가 |

---

## 커밋

- `fix(k8s): remove harbor-secret and fix KEDA replicas conflict`
- `fix(k8s): allow KEDA namespace access to Kafka in tutum-data NetworkPolicy`
