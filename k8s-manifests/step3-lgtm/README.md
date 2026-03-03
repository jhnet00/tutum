# Step 3: 데이터/파이프라인 붙이기 (LGTM)

## 목표

Monitoring VM에 Loki + Grafana + Tempo + Mimir 시작 → K8s Alloy DaemonSet 배포 → ingress/be 로그 우선 수집

## 실행 순서

### 3-A. Monitoring VM (192.168.0.230)에서 실행

```bash
# 1. 파일 복사 (개발 머신 → monitoring VM)
scp -r k8s-manifests/step3-lgtm/monitoring-vm/* clouddx@192.168.0.230:/opt/monitoring/

# 2. monitoring VM SSH 접속
ssh clouddx@192.168.0.230

# 3. Docker 설치 (아직 안 했다면)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker

# 4. LGTM 스택 시작
cd /opt/monitoring
docker compose up -d

# 5. 상태 확인 (모두 healthy 될 때까지 1~2분 대기)
docker compose ps

# 6. 각 서비스 ready 확인
curl -s http://localhost:3100/ready && echo "Loki: OK"
curl -s http://localhost:3200/ready && echo "Tempo: OK"
curl -s http://localhost:9009/ready && echo "Mimir: OK"
curl -s http://localhost:3000/api/health && echo "Grafana: OK"
```

> Grafana 접속: `http://192.168.0.230:3000`
> ID: admin / PW: tutum2026!

### 3-B. k8s-master에서 실행 (Alloy DaemonSet)

```bash
# 1. monitoring 네임스페이스 확인 (Step 1에서 생성됨)
kubectl get namespace monitoring

# 2. Existing Alloy(Helm-managed)에는 ConfigMap만 적용
kubectl apply -f k8s-manifests/step3-lgtm/alloy/00-alloy-configmap.yaml

# 3. Alloy 롤아웃 재시작/확인
kubectl rollout restart daemonset/alloy -n monitoring
kubectl rollout status daemonset/alloy -n monitoring

# NOTE: 신규 클러스터에서 Alloy가 아직 없다면 아래로 전체 설치
# kubectl apply -f k8s-manifests/step3-lgtm/alloy/01-alloy-daemonset.yaml

# 4. 모든 노드에 Alloy Pod 배포 확인 (노드 수만큼 Pod가 있어야 함)
kubectl get pods -n monitoring -o wide

# 5. Alloy 로그 확인
kubectl logs -n monitoring -l app.kubernetes.io/name=alloy --tail=50
```

### 3-C. Grafana 대시보드 Import

Grafana UI (`http://192.168.0.230:3000`) → Dashboards → Import:

| 대시보드           | Grafana ID | 데이터소스 |
| ------------------ | ---------- | ---------- |
| Kubernetes Cluster | 15520      | Mimir      |
| Node Exporter      | 1860       | Mimir      |
| Kubernetes Pods    | 15760      | Mimir      |
| Loki Logs          | 13639      | Loki       |

## 완료 기준

- [ ] Monitoring VM: Loki, Tempo, Mimir, Grafana, InfluxDB 전부 `running`
- [ ] Grafana 로그인 + 데이터소스 4개 연결 확인
- [ ] K8s Alloy DaemonSet이 모든 노드에서 `Running`
- [ ] Grafana Explore → Mimir → `up` 쿼리 → K8s 메트릭 보임
- [ ] Grafana Explore → Loki → `{namespace="tutum-app"}` → 앱 로그 보임

## LGTM Auto Verification

Run this on the monitoring VM to verify service readiness and Grafana provisioning in one pass.

```bash
cd /opt/monitoring
chmod +x verify-lgtm.sh
./verify-lgtm.sh
```

If Grafana credentials are different:

```bash
GRAFANA_USER=admin GRAFANA_PASSWORD='your-password' ./verify-lgtm.sh
```
