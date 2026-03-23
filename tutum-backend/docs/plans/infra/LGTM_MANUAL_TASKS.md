# LGTM 모니터링 스택 - 수동 작업 가이드

> 작성일: 2026-02-24
> 자동화 완료 항목 이후 웹 UI 또는 추가 설정이 필요한 항목 정리

---

## 현재 완료 상태 요약

| 항목 | 상태 | 비고 |
|------|------|------|
| LGTM Docker Compose (5개 서비스) | ✅ 완료 | Loki/Tempo/Mimir/Grafana/InfluxDB |
| K8s Alloy DaemonSet | ✅ 완료 | worker1/2/3 전부 정상 (worker2 containerd config 복구 완료) |
| Grafana 데이터소스 4개 | ✅ 완료 | Mimir/Loki/Tempo/InfluxDB (토큰 연결됨) |
| Loki→Tempo 트레이스 연동 | ✅ 완료 | derivedFields 설정 |
| 커뮤니티 대시보드 5개 Import | ✅ 완료 | Node Exporter, K8s Cluster, K8s Pods, Istio Mesh, Loki Logs |
| 알림 규칙 6개 | ✅ 완료 | BackendDown, HighErrorRate, KafkaConsumerLag, RedisMemoryHigh, HighLatency, NodeDiskFull |
| UFW 방화벽 | ✅ 완료 | 모든 LGTM 포트 개방 |
| Slack 연동 | ❌ 미완료 | Webhook URL 필요 |
| 커스텀 대시보드 (CloudDX Overview, k6) | ❌ 미완료 | 앱 배포 후 메트릭 확인 필요 |
| AWS Bedrock AI 요약 | ❌ 미완료 | 별도 구현 필요 |

---

## 수동 작업 1: Slack 알림 연동

### 1-1. Slack Incoming Webhook 생성

```
1. https://api.slack.com/apps 접속
2. Create New App → From scratch
   - App Name: tutum-bot
   - Workspace: (팀 워크스페이스 선택)
3. Incoming Webhooks → Activate → Add New Webhook to Workspace
   - Channel: #tutum-alerts
4. Webhook URL 복사 (예: https://hooks.slack.com/services/T.../B.../...)
```

### 1-2. Grafana Contact Point 설정

```
1. http://192.168.0.230:3000 접속 (admin / tutum2026!)
2. Alerting → Contact points → Add contact point
   - Name: slack-alerts
   - Integration: Slack
   - Webhook URL: (위에서 복사한 URL 붙여넣기)
   - Title: {{ template "default.title" . }}
   - Text Body: {{ template "default.message" . }}
3. "Test" 버튼 → Slack 채널에 테스트 알림 도착 확인
4. Save
```

### 1-3. Notification Policy 변경

```
1. Alerting → Notification policies
2. Default policy 수정 (연필 아이콘)
   - Default contact point: slack-alerts (기본 email → slack으로 변경)
3. Save policy
```

### 1-4. 검증

```
1. Alerting → Alert rules → 아무 규칙 선택 → "Test" 클릭
2. Slack #tutum-alerts 채널에 알림이 오면 성공
```

---

## 수동 작업 2: 커스텀 대시보드 생성

> 앱(Backend/Frontend)이 K8s에 배포된 후, 실제 메트릭이 수집되면 만들 수 있음

### 2-1. CloudDX Overview 대시보드

```
1. Grafana → Dashboards → New dashboard
2. 패널 추가:
   - Backend API 요청량: rate(http_requests_total{job="backend"}[5m])
   - 에러율: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])
   - P95 응답시간: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
   - Kafka Consumer Lag: kafka_consumer_group_lag
   - Redis 히트율: redis_keyspace_hits_total / (redis_keyspace_hits_total + redis_keyspace_misses_total)
3. 데이터소스: Mimir
4. Save as: "CloudDX Overview"
```

### 2-2. k6 Load Test 대시보드

```
1. Grafana → Dashboards → Import → ID: 2587
   (k6 Load Testing Results 공식 대시보드)
2. 데이터소스: InfluxDB 선택
3. Save
```

---

## 수동 작업 3: AWS Bedrock AI 요약 기능

> Backend 코드에 AWS Bedrock 연동을 추가하여, Grafana 알림 발생 시 AI가 장애 요약을 생성

### 3-1. 개요

- Grafana Alert → Webhook → Backend API → AWS Bedrock (Claude) → Slack 요약 메시지
- 또는 Grafana Alert → Slack + 별도 Lambda/Backend 연동

### 3-2. 필요 사항

```
1. AWS 계정 + Bedrock 접근 권한 (Claude 모델 활성화)
2. Backend에 Bedrock API 호출 엔드포인트 추가
3. Grafana Webhook Contact Point → Backend API 연동
4. 장애 컨텍스트(메트릭, 로그)를 Bedrock에 전달 → 요약 생성 → Slack 전송
```

### 3-3. 구현 방안 (예시)

```
방안 A: Backend API 직접 연동
  1. FastAPI에 /api/v1/alert-summary 엔드포인트 추가
  2. Grafana webhook → Backend → Bedrock Claude로 알림 컨텍스트 전송
  3. Claude가 요약 생성 → Slack Webhook으로 전송
  4. 장점: 기존 인프라 활용, 추가 비용 최소

방안 B: AWS Lambda 연동
  1. Lambda 함수 생성 (Python, Bedrock invoke)
  2. Grafana webhook → API Gateway → Lambda → Bedrock → Slack
  3. 장점: 서버리스, Backend 코드 수정 불필요
```

### 3-4. 구현 시 추가 할 것

```
- Backend .env에 AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION 추가
- pip install boto3 (이미 있을 수 있음)
- Bedrock model ID: anthropic.claude-3-5-sonnet-20241022-v2:0 (또는 최신)
- Grafana Contact Point에 Webhook 타입 추가 (Backend URL)
```

---

## 수동 작업 4: worker2 노드 복구 — ✅ 해결 완료 (2026-02-25)

> **최종 상태**: worker2 (192.168.0.224) 모든 pod Running, 0 restarts, 안정화 확인 완료
> **근본 원인**: `/etc/containerd/config.toml`이 빈 파일(0 bytes) → SystemdCgroup 미설정 → sandbox 반복 재생성
> **해결**: worker1의 containerd config.toml을 worker2에 복사 후 containerd/kubelet 재시작

### 4-1. 근본 원인 분석

```
증상: worker2의 모든 pod가 CrashLoopBackOff + SandboxChanged 이벤트 반복
      calico-node → kube-proxy → metallb → alloy → mongodb 연쇄 충돌

진단 경과:
  1. containerd/kubelet 재시작 → 일시적 효과, 재발
  2. kubeadm reset + 재조인 → 일시적 효과, 재발
  3. worker1과 worker2의 containerd config 비교 → 핵심 차이 발견

근본 원인:
  worker2의 /etc/containerd/config.toml이 빈 파일(0 bytes)
  → containerd가 기본값 사용
  → SystemdCgroup = false (기본값) vs kubelet은 systemd cgroup driver 사용
  → cgroup driver 불일치로 sandbox(pause 컨테이너) 프로세스 불안정
  → SandboxChanged 이벤트 → 모든 pod 컨테이너 재생성 → 무한 루프
```

### 4-2. 해결 과정

```bash
# 1. worker1에서 정상 config 복사 (SCP 경유)
scp clouddx@192.168.0.223:/etc/containerd/config.toml /tmp/config.toml
scp /tmp/config.toml clouddx@192.168.0.224:/tmp/config.toml
ssh clouddx@192.168.0.224 "sudo cp /tmp/config.toml /etc/containerd/config.toml"

# 2. containerd/kubelet 재시작
ssh clouddx@192.168.0.224 "sudo systemctl restart containerd && sleep 5 && sudo systemctl restart kubelet"

# 3. calico-node pod 삭제 (새로 생성 유도)
kubectl delete pod -n calico-system -l k8s-app=calico-node --field-selector spec.nodeName=worker2
```

### 4-3. 필수 containerd config 항목 (빠지면 안 되는 것)

```toml
# /etc/containerd/config.toml 핵심 설정
[plugins."io.containerd.grpc.v1.cri"]
  sandbox_image = "registry.k8s.io/pause:3.8"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"
  sandbox_mode = "podsandbox"

  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
    SystemdCgroup = true    # ← 이것이 없으면 kubelet과 cgroup driver 불일치
```

### 4-4. 복구 전 추가 사고: iptables 플러시

```
사고: 트러블슈팅 중 iptables -F 실행 → UFW 규칙 삭제 → INPUT DROP → SSH 차단
복구: VirtualBox 콘솔에서 sudo iptables -P INPUT ACCEPT && sudo ufw --force enable
교훈: 원격 서버에서 절대 iptables -F 실행 금지 (UFW 기본 정책 DROP이면 차단됨)
```

### 4-5. 진단 이력 요약 (2026-02-24 ~ 02-25)

| 단계 | 조치 | 결과 |
|------|------|------|
| 1차 | containerd/kubelet 재시작 | 일시적 안정 → 30초 후 재발 |
| 2차 | iptables -F (실수) | SSH 차단됨 → VirtualBox 콘솔 필요 |
| 3차 | UFW 복구 (VirtualBox 콘솔) | SSH 복구 완료 |
| 4차 | kubeadm reset + 재조인 | 노드 Ready, but calico-node 재차 crash |
| 5차 | containerd config 비교 | **빈 config.toml 발견** (0 bytes) |
| **최종** | **worker1 config 복사 + 재시작** | **모든 pod Running, 0 restarts, 안정화** |

### 4-6. 최종 상태 (2026-02-25 00:49 UTC)

```
calico-node-rn6jv       1/1     Running   0          4m    worker2
csi-node-driver-4gsfz   2/2     Running   6          11m   worker2
kube-proxy-4g7nk        1/1     Running   465        44h   worker2
speaker-2sdjr           1/1     Running   6          11m   worker2
alloy-wvb84             2/2     Running   12         11m   worker2
mongodb-0               1/1     Running   6          13m   worker2

NetworkUnavailable: False (CalicoIsUp)
Taints: <none>
Unschedulable: false
```

---

## 접속 정보 요약

| 서비스 | URL | 계정 |
|--------|-----|------|
| Grafana | http://192.168.0.230:3000 | admin / tutum2026! |
| InfluxDB | http://192.168.0.230:8086 | admin / tutum2026! |
| Loki API | http://192.168.0.230:3100 | - |
| Tempo API | http://192.168.0.230:3200 | - |
| Mimir API | http://192.168.0.230:9009 | - |

## Grafana 대시보드 목록

| 대시보드 | Grafana ID | 데이터소스 |
|---------|------------|----------|
| Node Exporter Full | 1860 | Mimir |
| Kubernetes Cluster Overview | 15520 | Mimir |
| Kubernetes / Views / Pods | 15760 | Mimir |
| Istio Mesh Dashboard | 7639 | Mimir |
| Logs / App | 13639 | Loki |

## Grafana 알림 규칙

| 이름 | PromQL | 지속시간 | 심각도 |
|------|--------|---------|--------|
| BackendDown | `up{job=~".*backend.*"} == 0` | 1분 | critical |
| HighErrorRate | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05` | 5분 | critical |
| KafkaConsumerLag | `kafka_consumer_group_lag > 1000` | 10분 | warning |
| RedisMemoryHigh | `redis_memory_used_bytes / redis_memory_max_bytes > 0.8` | 5분 | warning |
| HighLatency | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` | 5분 | warning |
| NodeDiskFull | `(1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) > 0.85` | 5분 | warning |
