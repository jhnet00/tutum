# 개발 로그 작업 요약 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 작업자: jhnet00
- 브랜치: develop
- 작업 목적: KEDA + metrics-server 설치로 파드 오토스케일링 구성, SSH 접근 방법 확립

---

## 2. 상세 변경 사항

### 2-1. SSH 접근 확인
- `~/.ssh/config` 별칭(`cp-1`, `worker1` 등) + `~/.ssh/id_rsa` 키로 직접 접근 가능 확인
- 유저명: `clouddx`, sudo 패스워드: `tutum`

### 2-2. Istio IngressGateway (API Gateway) 상태 확인
- External IP `192.168.0.240` LoadBalancer Running ✅
- `GET /` → 200 ✅
- `GET /api/health` → 404 (backend ImagePullBackOff로 인한 미응답, 게이트웨이 자체는 정상)
- `tutum-gateway` / `tutum-app-route` VirtualService 배포 상태 정상

### 2-3. metrics-server 설치
- **이유**: KEDA CPU 트리거가 pod CPU 지표를 읽으려면 metrics-server 필요
- **방법**: Helm (kubernetes-sigs/metrics-server chart v3.13.0)
- **옵션**: `--set args={--kubelet-insecure-tls}` (kubeadm 환경 인증서 우회)
- **결과**: `metrics-server-cbb478b84-hqvdm` 1/1 Running, `kubectl top nodes` 정상 출력 확인

```bash
helm install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --set args={--kubelet-insecure-tls}
```

### 2-4. KEDA 설치 (v2.16.0)
- **이유**: K8s 1.29.15 클러스터 — KEDA 2.19는 K8s 1.32+ 전용이므로 호환 버전 사용
- **방법**: Helm (kedacore/keda chart, 버전 2.16.0)
- **네임스페이스**: `keda`
- **파드 3개**: `keda-operator`, `keda-admission-webhooks`, `keda-operator-metrics-apiserver` 모두 Running

```bash
helm install keda kedacore/keda --version 2.16.0 \
  --namespace keda --create-namespace
```

### 2-5. KEDA ScaledObject 매니페스트 작성 및 적용
- **파일**: `k8s-manifests/base/autoscaling/keda-scaledobjects.yaml` (신규)
- **kustomization.yaml**: `autoscaling/keda-scaledobjects.yaml` 항목 추가

| ScaledObject | 트리거 | min | max | 기준 |
|---|---|---|---|---|
| backend | CPU | 2 | 5 | 70% |
| frontend | CPU | 2 | 4 | 70% |
| price-consumer | Kafka (topic: prices, group: price-consumer-group) | 1 | 5 | lag 50 |
| news-consumer | Kafka (topic: news, group: clouddx-news-consumer-v1) | 1 | 4 | lag 30 |
| elastic-consumer | Kafka (topic: news.raw, group: indexer-consumer-group) | 0 | 3 | lag 30 |

- elastic-consumer는 평소 0 replica → lag 발생 시 자동 기동 (비용 절감)

---

## 3. 작업 중 발생 이슈 및 대응

### 이슈 1: KEDA 버전 호환성 경고
- **내용**: `helm install kedacore/keda` 최신 버전(2.19) 설치 시 "Unsupported Kubernetes version 1.29" 경고
- **대응**: 즉시 `helm uninstall` 후 K8s 1.29 공식 지원 버전인 **2.16.0**으로 재설치

### 이슈 2: SSH 연결 실패 (tutum 유저 시도)
- **내용**: `ssh tutum@192.168.0.220` → Authentication failed
- **대응**: 유저명이 `clouddx`임을 확인 (`~/.ssh/config` 및 `scripts/ssh-copy-keys.sh` 참조)

---

## 4. 결과

| 항목 | 결과 |
|------|------|
| metrics-server | ✅ Running, `kubectl top nodes` 정상 |
| KEDA 2.16.0 | ✅ 3/3 파드 Running |
| ScaledObject 5개 배포 | ✅ 전부 READY=True |
| KEDA 자동 생성 HPA 5개 | ✅ 확인 |

```
NAME                            MIN   MAX   READY   ACTIVE
backend-scaledobject            2     5     True    Unknown
frontend-scaledobject           2     4     True    Unknown
price-consumer-scaledobject     1     5     True    Unknown
news-consumer-scaledobject      1     4     True    Unknown
elastic-consumer-scaledobject   0     3     True    Unknown
```

---

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-27" --until="2026-02-27 23:59:59"
```

---

## 6. 후속 작업/리스크

- **metrics 수집 안정화**: ScaledObject ACTIVE 상태가 `Unknown`인 것은 초기 metrics 수집 대기 상태. 수분 후 정상화됨.
- **Kafka 트리거 검증**: 실제 Kafka 적체 발생 시 price-consumer / news-consumer가 scale-out 되는지 부하 테스트로 확인 필요
- **elastic-consumer min=0**: 현재 비활성(replicas=0), KEDA lag 감지 시 자동 기동 예정. 첫 scale-up 시 cold-start 지연 있을 수 있음.
- **노드 리소스 여유**: scale-out 시 노드에 실제 리소스가 있어야 스케줄링 가능. 현재 worker1 CPU 33%, Memory 83% — memory가 빠듯함. 주의 필요.
