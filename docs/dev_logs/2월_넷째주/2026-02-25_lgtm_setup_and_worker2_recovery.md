# 2026-02-25 LGTM 모니터링 스택 구축 및 worker2 복구

## 1. 작업 요약
- **작업 범위**: Phase 3 LGTM 모니터링 스택 완성 + worker2 노드 장애 복구
- **담당**: 김경윤 (서버컴)
- **최종 상태**: LGTM 5개 서비스 정상 운영, Alloy DaemonSet 전 워커 정상, worker2 완전 안정화

## 2. Phase 3: LGTM 모니터링 스택 구축

### 2-1. Monitoring VM (192.168.0.230) Docker Compose 배포

5개 서비스를 `/opt/monitoring/docker-compose.yml`로 배포:

| 서비스 | 이미지 | 포트 | 용도 |
|--------|--------|------|------|
| Loki | grafana/loki:3.0.0 | 3100 | 로그 저장 |
| Tempo | grafana/tempo:2.4.0 | 4317/4318/3200 | 트레이스 저장 |
| Mimir | grafana/mimir:2.12.0 | 9009 | 메트릭 저장 |
| Grafana | grafana/grafana:11.0.0 | 3000 | 대시보드 |
| InfluxDB | influxdb:2.7 | 8086 | k6 부하 테스트 결과 |

### 2-2. Grafana 데이터소스 4개 연결 (API 자동화)

| 데이터소스 | 타입 | URL | 비고 |
|-----------|------|-----|------|
| Mimir | Prometheus | http://mimir:9009/prometheus | default |
| Loki | Loki | http://loki:3100 | derivedFields로 Tempo 트레이스 연동 |
| Tempo | Tempo | http://tempo:3200 | tracesToLogs → Loki 연동 |
| InfluxDB | InfluxDB (Flux) | http://influxdb:8086 | org: tutum, bucket: k6, 토큰 인증 |

### 2-3. 커뮤니티 대시보드 5개 Import

| 대시보드 | Grafana ID | 데이터소스 |
|---------|------------|----------|
| Node Exporter Full | 1860 | Mimir |
| Kubernetes Cluster Overview | 15520 | Mimir |
| Kubernetes / Views / Pods | 15760 | Mimir |
| Istio Mesh Dashboard | 7639 | Mimir |
| Logs / App | 13639 | Loki |

### 2-4. 알림 규칙 6개 설정

| 이름 | 조건 | 지속시간 | 심각도 |
|------|------|---------|--------|
| BackendDown | `up{job=~".*backend.*"} == 0` | 1분 | critical |
| HighErrorRate | `5xx / total > 5%` | 5분 | critical |
| KafkaConsumerLag | `lag > 1000` | 10분 | warning |
| RedisMemoryHigh | `used/max > 80%` | 5분 | warning |
| HighLatency | `P95 > 2초` | 5분 | warning |
| NodeDiskFull | `disk used > 85%` | 5분 | warning |

### 2-5. K8s Alloy DaemonSet (Helm)

```bash
helm install alloy grafana/alloy --namespace monitoring
```

- 역할: K8s pod discovery → 메트릭은 Mimir, 로그는 Loki, 트레이스는 Tempo로 전송
- 상태: worker1/2/3 전부 2/2 Running

### 2-6. UFW 방화벽 포트 개방 (monitoring VM)

```
3000/tcp (Grafana), 3100/tcp (Loki), 3200/tcp (Tempo),
4317/tcp (OTLP gRPC), 4318/tcp (OTLP HTTP),
9009/tcp (Mimir), 8086/tcp (InfluxDB)
```

## 3. worker2 장애 복구

### 3-1. 증상
- worker2(192.168.0.224)의 **모든 pod**가 CrashLoopBackOff
- `SandboxChanged` 이벤트 반복 → calico-node, kube-proxy, metallb, alloy, mongodb 연쇄 충돌
- kube-proxy 465회 재시작, calico-node 30초 내 crash 반복

### 3-2. 진단 경과

| 단계 | 조치 | 결과 |
|------|------|------|
| 1차 | containerd/kubelet 재시작 | 일시적 안정 → 30초 후 재발 |
| 2차 | `iptables -F` 실행 (실수) | UFW 규칙 삭제 → SSH 차단 |
| 3차 | VirtualBox 콘솔에서 UFW 복구 | SSH 복구 완료 |
| 4차 | `kubeadm reset` + 재조인 | 노드 Ready, but calico-node 재차 crash |
| 5차 | worker1과 worker2 containerd config 비교 | **빈 config.toml 발견** |
| **최종** | **worker1 config 복사 + 재시작** | **모든 pod Running, 0 restarts** |

### 3-3. 근본 원인

**`/etc/containerd/config.toml`이 빈 파일 (0 bytes)**

- containerd가 기본값 사용 → `SystemdCgroup = false`
- kubelet은 systemd cgroup driver 사용 → **cgroup driver 불일치**
- sandbox(pause 컨테이너) 프로세스 불안정 → SandboxChanged 무한 반복
- 전체 pod 연쇄 재시작

### 3-4. 해결 방법

```bash
# worker1에서 정상 config 복사
scp clouddx@192.168.0.223:/etc/containerd/config.toml /tmp/config.toml
scp /tmp/config.toml clouddx@192.168.0.224:/tmp/config.toml
ssh clouddx@192.168.0.224 "sudo cp /tmp/config.toml /etc/containerd/config.toml"

# containerd/kubelet 재시작
ssh clouddx@192.168.0.224 "sudo systemctl restart containerd && sleep 5 && sudo systemctl restart kubelet"

# calico-node 새로 생성
kubectl delete pod -n calico-system -l k8s-app=calico-node --field-selector spec.nodeName=worker2
```

### 3-5. 필수 containerd config 항목

```toml
[plugins."io.containerd.grpc.v1.cri"]
  sandbox_image = "registry.k8s.io/pause:3.8"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"
  sandbox_mode = "podsandbox"

  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
    SystemdCgroup = true    # 필수
```

### 3-6. 추가 사고: iptables 플러시로 SSH 차단

```
원인: iptables -F → UFW 규칙 삭제 → INPUT 기본 정책 DROP → 모든 인바운드 차단
복구: VirtualBox 콘솔에서 sudo iptables -P INPUT ACCEPT && sudo ufw --force enable
교훈: 원격 서버에서 절대 iptables -F 실행 금지
```

## 4. MEMORY.md 전면 업데이트

SSH로 실제 VM 접속하여 현재 상태 확인 후 MEMORY.md 교정:

| 항목 | 기존(틀림) | 실제(교정) |
|------|-----------|-----------|
| VM IP 대역 | 192.168.56.x (Host-Only) | 192.168.0.x (브릿지) |
| Control Plane | k8s-master 1대 | cp-1/2/3 3대 HA |
| MetalLB | 192.168.56.100-110 | 192.168.0.240-250 |
| SonarQube | monitoring VM Docker | K8s Helm (sonarqube ns) |
| ArgoCD | NodePort 30443 | ClusterIP (port-forward) |
| Kyverno | Cosign 정책 적용 | pods/정책 없음 (미설정) |
| Helm | v3.20.0 | v4.1.1 |

## 5. 최종 검증 결과

```
=== Nodes ===
cp-1      Ready    control-plane   v1.29.15   192.168.0.220   containerd://1.7.28
cp-2      Ready    control-plane   v1.29.15   192.168.0.221   containerd://1.7.28
cp-3      Ready    control-plane   v1.29.15   192.168.0.222   containerd://1.7.28
worker1   Ready    v1.29.15   192.168.0.223   containerd://1.7.28
worker2   Ready    v1.29.15   192.168.0.224   containerd://1.7.28
worker3   Ready    v1.29.15   192.168.0.225   containerd://1.7.28

=== worker2 Pods (복구 후) ===
calico-node-rn6jv       1/1     Running   0          worker2
csi-node-driver-4gsfz   2/2     Running   worker2
kube-proxy-4g7nk        1/1     Running   worker2
speaker-2sdjr           1/1     Running   worker2
alloy-wvb84             2/2     Running   worker2
mongodb-0               1/1     Running   worker2

NetworkUnavailable: False (CalicoIsUp)
MemoryPressure: False
DiskPressure: False

=== Monitoring VM (192.168.0.230) ===
monitoring-grafana-1    Up 23h    :3000
monitoring-influxdb-1   Up 23h    :8086
monitoring-mimir-1      Up 23h    :9009
monitoring-loki-1       Up 23h    :3100
monitoring-tempo-1      Up 23h    :3200/4317/4318
```

## 6. 남은 작업 (수동)

| 항목 | 상태 | 비고 |
|------|------|------|
| Slack Webhook 연동 | 미완료 | Webhook URL 생성 후 Grafana Contact Point 설정 |
| 커스텀 대시보드 | 미완료 | 앱 배포 후 메트릭 확인 필요 |
| k6 대시보드 | 미완료 | InfluxDB 연동 완료, Grafana ID 2587 import |
| AWS Bedrock AI 요약 | 미완료 | 별도 구현 (다른 팀원 담당) |

## 7. 재발 방지

1. **containerd config.toml 점검 필수**
   - 신규 노드 조인/리셋 후 반드시 `wc -l /etc/containerd/config.toml` 확인
   - `SystemdCgroup = true` 포함 여부 검증

2. **iptables -F 절대 금지**
   - UFW 환경에서는 `iptables -F` 대신 `sudo ufw reset` 사용
   - 원격 작업 시 방화벽 변경 전 `at` 또는 `crontab`으로 복구 명령 예약

3. **노드별 containerd config 동일성 검증 스크립트 추가**
   - `md5sum /etc/containerd/config.toml`을 전 노드에서 비교하는 health check 포함
