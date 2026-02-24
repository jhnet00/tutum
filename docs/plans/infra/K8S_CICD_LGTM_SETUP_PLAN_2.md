# K8S CICD + LGTM Setup Plan v2

## 0. 개요

- 기준 문서: `K8S_CICD_LGTM_SETUP_PLAN.md`
- 이 문서는 `Plan v1`의 완료 항목을 기준으로 이어서 실제 실행용으로 정리한 운영 체크리스트이다.
- 목표:
  - control-plane 복구/안정화
  - worker 조인 및 상태 검증
  - MongoDB replica set 3노드 분산 운영
  - LGTM + Frontend 통합 확인
  - AWS 이전 전 최종 완료 상태 정합성 확보

---

## 1. 노드/팀원/역할 분담

| 노드명 | 클러스터 IP | 호스트 IP | 팀원 | 역할 | 비고 |
|---|---:|---:|---|---|---|
| cp-1 | 192.168.0.220 | 192.168.0.28 | 김경윤 | control-plane-1 | API 서버 + etcd 기준 노드 |
| cp-2 | 192.168.0.221 | 192.168.0.13 | 박성준 | control-plane-2 | API 서버/etcd/컨트롤플레인 복구 |
| cp-3 | 192.168.0.222 | 192.168.0.98 | 김루비 | control-plane-3 | API 서버/etcd/컨트롤플레인 복구 |
| worker1 | 192.168.0.223 | 192.168.0.3 | 김경윤 | 워커 노드 | App 워크로드 배치 |
| worker2 | 192.168.0.224 | 192.168.0.14 | 김정호 | 워커 노드 | App + Consumer 워크로드 |
| worker3 | 192.168.0.225 | 192.168.0.14 | 김정호 | 워커 노드 | Data 워크로드 |
| monitoring | 192.168.0.230 | 192.168.0.28 | 김경윤 | monitoring 전담(별도 운영) | Grafana/Loki/Tempo/Mimir/Alertmanager |

### 팀별 실행 책임

> 클러스터 명령(`kubectl`, `kubeadm join`, health check)은 **클러스터 IP(192.168.0.220~225)** 기준으로 실행한다.
> 호스트 IP(192.168.0.28/13/98/3/14)는 SSH 진입점 용도다.

- 김경윤(호스트 192.168.0.28): cp-1 운영, monitoring 구성/운영, 공통 장애 대응 총괄
- 김루비(호스트 192.168.0.98): cp-3 운영, control-plane peer 점검/복구
- 박성준(호스트 192.168.0.13): cp-2 운영, join/재조인, kube-apiserver/etcd 복구
- 김정호(호스트 192.168.0.14): worker2/worker3 운영, 워크로드/자원 상태 점검
- 김경윤(호스트 192.168.0.3): worker1 및 mongodb VM 운영

### MongoDB replica set 배치(필수)

- 원칙: ReplicaSet 멤버 3개를 서로 다른 워커 노드에 분산
- 권장:
  - mongo-rs-0 -> worker1 (`192.168.0.223`)
  - mongo-rs-1 -> worker2 (`192.168.0.224`)
  - mongo-rs-2 -> worker3 (`192.168.0.225`)

**중요**: 단일 노드 Mongo 운영 금지. 반드시 3멤버 분산으로 운영한다.

---

## 2. 기본 원칙 (문서 사용 규칙)

### 2-1. 실행 규칙
1. 각 블록은 `붙여넣기만`으로 실행되는 형태로 작성한다.
2. 한 블록에서 하나의 목표만 처리한다.
3. 작업 전/후 `검증 명령`을 반드시 바로 다음에 실행한다.
4. 오류 발생 시 `journalctl`/`crictl`/`kubectl` 로그 3개를 먼저 수집한다.

### 2-2. 실패 로그 수집 명령

```bash
sudo journalctl -u kubelet -n 120 --no-pager
sudo journalctl -u containerd -n 120 --no-pager
sudo crictl ps -a | sed -n '1,200p'
```

---

## 3. Phase A. 현황 점검 (전체 공통)

### A-1. 네트워크/포트 사전 점검

```bash
ip -4 a
ip route
hostname
nc -zv 192.168.0.220 6443
nc -zv 127.0.0.1 10248
```

### A-2. kubelet/containerd 상태 점검

```bash
systemctl status containerd kubelet
ss -ltnp | grep -E '6443|2379|2380|10250|10248'
```

### A-3. kubeconfig 파일 접근 점검

```bash
sudo ls -l /etc/kubernetes/admin.conf
sudo cat /etc/kubernetes/admin.conf | head -n 5
```

---

## 4. Phase B. Control Plane 복구 우선 처리

### B-1. cp-1 (192.168.0.220, 김경윤)

#### 1) 보안 파일 권한 정리

```bash
sudo chown root:root /etc/kubernetes/admin.conf
sudo chmod 600 /etc/kubernetes/admin.conf
```

#### 2) 정적 Pod 상태 확인

```bash
sudo crictl ps -a | grep -E 'kube-apiserver|kube-controller-manager|kube-scheduler|etcd'
sudo ss -ltnp | grep -E '6443|2379|2380'
```

#### 3) etcd 헬스 확인

```bash
ETCD_CID=$(sudo crictl ps --name etcd -q | head -n 1)
sudo crictl exec -i "$ETCD_CID" etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/peer.crt \
  --key=/etc/kubernetes/pki/etcd/peer.key \
  endpoint status -w table
```

#### 4) API 서버 로그 진단

```bash
KUBE_APISERVER_CID=$(sudo crictl ps --name kube-apiserver -q | head -n 1)
sudo crictl logs "$KUBE_APISERVER_CID" | tail -n 200
```

### B-2. cp-2 (192.168.0.221, 박성준)

#### 1) kubelet 상태

```bash
systemctl status kubelet
```

#### 2) crash/반복 재시작 Pod 정리 이력 확인

```bash
sudo crictl ps -a | grep -E 'kube-apiserver|etcd|kube-scheduler|kube-controller-manager'
sudo journalctl -u kubelet -n 200 --no-pager
```

#### 3) 컨트롤 플레인 재시도(필요 시)

```bash
sudo systemctl restart kubelet
sudo systemctl restart containerd
```

### B-3. cp-3 (192.168.0.222, 김루비)

#### 1) 컨트롤 플레인 노드 피어 연결 확인

```bash
nc -zv 192.168.0.220 6443
nc -zv 192.168.0.221 6443
nc -zv 192.168.0.220 2380
nc -zv 192.168.0.221 2380
```

#### 2) kubelet + API/ETCD 상태

```bash
systemctl status kubelet
sudo crictl ps -a | grep -E 'kube-apiserver|etcd'
sudo ss -ltnp | grep -E '6443|2379|2380'
```

---

## 5. Phase C. Worker 조인 및 검증

### C-1. worker 조인 전 사전 정리

```bash
sudo kubeadm reset -f
sudo rm -rf /etc/cni/net.d
sudo systemctl restart containerd
sudo systemctl restart kubelet
```

### C-2. worker 조인 명령 템플릿

```bash
sudo kubeadm join 192.168.0.220:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --node-name <worker-hostname>
```

### C-3. 조인 후 공통 검증

```bash
kubectl get nodes -o wide
kubectl describe node <node-name> | grep -E 'Taints|Conditions|Allocatable|Capacity'
kubectl get pods -A -o wide
kubectl -n kube-system get pods -o wide
```

---

## 6. Phase D. MongoDB replica set 3-node 분산 운영

### D-1. 전제

- 3개의 MongoDB 멤버를 서로 다른 노드에 배치한다.
- 최소 권장 리소스: 각 멤버당 최소 1 CPU / 2Gi 이상
- PVC는 노드별 디스크 여유량을 확인하고, `ReadWriteOnce` 설정에 맞춰 배치한다.

### D-2. 노드별 배치 확인

```bash
NS=tutum-data
kubectl get ns "$NS" >/dev/null 2>&1 || NS=mongodb
echo "Using namespace: $NS"
kubectl -n "$NS" get pods -o wide
kubectl -n "$NS" get pvc -o wide
kubectl -n "$NS" get statefulset,svc,pv,pvc
```

### D-3. 레플리카셋 상태 확인

```bash
NS=tutum-data
kubectl get ns "$NS" >/dev/null 2>&1 || NS=mongodb
POD=$(kubectl -n "$NS" get pod -o name | grep -E 'mongo|mongodb' | head -n 1 | sed 's#pod/##')
echo "Using namespace: $NS, pod: $POD"
kubectl -n "$NS" exec -it "$POD" -- mongosh --eval 'rs.status()'
kubectl -n "$NS" exec -it "$POD" -- mongosh --eval 'rs.printReplicationInfo()'
```

### D-4. 이중화 및 failover 점검

```bash
NS=tutum-data
kubectl get ns "$NS" >/dev/null 2>&1 || NS=mongodb
POD=$(kubectl -n "$NS" get pod -o name | grep -E 'mongo|mongodb' | head -n 1 | sed 's#pod/##')
kubectl -n "$NS" exec -it "$POD" -- mongosh --eval 'rs.printSecondaryReplicationInfo()'
kubectl -n "$NS" exec -it "$POD" -- mongosh --eval 'db.adminCommand({replSetGetStatus:1})'
```

### D-5. 어플리케이션 연결 문자열 점검

```bash
echo 'kubectl -n tutum-data get svc 로 실제 서비스명 확인 후 backend secret MONGODB_URL 반영'
echo '예시: mongodb://mongo-rs-0.mongo-rs.tutum-data.svc.cluster.local:27017,mongo-rs-1.mongo-rs.tutum-data.svc.cluster.local:27017,mongo-rs-2.mongo-rs.tutum-data.svc.cluster.local:27017/?replicaSet=mongo-rs'
```

---

## 7. Phase E. LGTM + Frontend 검증 (monitoring node: 192.168.0.230)

### E-1. 서비스 준비 체크

```bash
sudo docker ps -a
```

### E-2. 건강 상태 체크

```bash
curl -s http://192.168.0.230:3100/ready
curl -s http://192.168.0.230:3200/ready
curl -s http://192.168.0.230:9009/ready
curl -s http://192.168.0.230:9093/-/healthy
curl -I http://192.168.0.240/
```

### E-3. 인그레스/서비스 매핑 확인

```bash
kubectl -n tutum-app get svc
kubectl -n tutum-app get gateway,peerauthentication
kubectl -n istio-system get svc istio-ingressgateway -o wide
```

---

## 8. Phase F. 장애 대응 runbook (현장 즉시 실행)

### F-1. API 서버 연결 실패( connection refused / reset )

```bash
sudo systemctl status kubelet containerd
sudo ss -ltnp | grep -E '6443|2379|2380'
sudo crictl ps -a | grep -E 'kube-apiserver|etcd'
```

### F-2. etcd 응답 지연/멈춤

```bash
ETCD_CID=$(sudo crictl ps --name etcd -q | head -n 1)
sudo crictl exec -i "$ETCD_CID" etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/peer.crt \
  --key=/etc/kubernetes/pki/etcd/peer.key \
  endpoint status -w table
```

### F-3. kubelet 토큰/인증 오류

```bash
sudo ls -l /etc/kubernetes/admin.conf
sudo kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes -o wide
```

### F-4. 빠른 기록 저장

```bash
mkdir -p ~/k8s-incident
journalctl -u kubelet -n 200 --no-pager > ~/k8s-incident/kubelet-$(hostname)-$(date +%F_%H%M%S).log
journalctl -u containerd -n 200 --no-pager > ~/k8s-incident/containerd-$(hostname)-$(date +%F_%H%M%S).log
sudo crictl ps -a > ~/k8s-incident/crictl-ps-$(hostname)-$(date +%F_%H%M%S).txt
```

---

## 9. Phase G. 최종 acceptance 기준 (AWS 이전 전)

- `kubectl get nodes -o wide`에서 cp 3대 + worker 2~3대 상태 모두 Ready
- `kubectl get pods -A | grep -v Running` 결과가 비정상 수가 0에 수렴
- etcd 3노드 `endpoint status` quorum healthy
- MongoDB replica set에서 `PRIMARY 1 + SECONDARY 2` 상태
- LGTM 4개 서비스 readiness 확인(192.168.0.230:3100/3200/9009/9093)
- Frontend API/Ingress 접근 성공
- `kubectl describe node`에서 `DiskPressure`/`MemoryPressure` 경고 미발생

---

## 10. Monitoring 스택 배포/운영 체크리스트 (실제 명령)

### 10-1. 배포 파일 위치

```text
/opt/monitoring-stack/
  ├── docker-compose.yml
  ├── .env
  ├── grafana/
  ├── loki/
  ├── tempo/
  ├── mimir/
  └── alertmanager/
```

### 10-2. 시작/재시작

```bash
cd /opt/monitoring-stack
docker compose pull
docker compose up -d
docker compose ps
```

### 10-3. 로그 확인

```bash
docker compose logs --tail=120 grafana
docker compose logs --tail=120 loki
docker compose logs --tail=120 tempo
docker compose logs --tail=120 mimir
docker compose logs --tail=120 alertmanager
```

### 10-4. 알람/백업

```bash
tar -czf /backup/lgtm-$(date +%F).tgz /opt/monitoring-stack/{grafana,loki,tempo,mimir,alertmanager}
```

---

## 11. AWS 이전 완료 점검 체크(3/2 목표)

### 단계
1. 컨트롤 플레인 + 워커 노드 Ready 상태 완전 복구
2. MongoDB 3노드 replica set 복제 안정성 검증
3. LGTM + Frontend 전체 탐색/알람 정상화
4. CI/CD 업스트림 배포 플로우 동작 검증
5. 문서화(복구 이력/스크린샷/로그 아카이브) 완료

### AWS 이전 전 최종 판단

- AWS 계정/권한/자격 증명 정비 완료
- 모니터링 백엔드(로그, 메트릭, 알람)와 앱 지표 기준치 임계치 동작 확인
- 장애 대응 runbook 1회 리허설 후 `장애 시나리오 대응 기록` 완성

---

## 12. 문서 사용 예시 (한 번에 실행하지 말 것)

- 각 섹션(A~F)은 순차 실행
- 1개 섹션당 1명 또는 1개 팀원이 담당
- 실패 구간이 생기면 `Phase F`로 이동해 진단 후 원인 제거 후 재개




