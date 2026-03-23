# K8s 인프라 설정 파일 구조

이 디렉토리는 K8S_CICD_LGTM_SETUP_PLAN.md의 이미지 기준 3단계 작업을 위한 YAML/설정 파일들입니다.
학원 환경(k8s-master: 192.168.56.20, monitoring: 192.168.56.30)에서 순서대로 실행하세요.

```
k8s-manifests/
├── step1-metallb/          ← K8s 진입점 확보 (MetalLB)
│   ├── README.md           ← 실행 순서 가이드
│   ├── 01-metallb-ippool.yaml   ← IP 풀 + L2Advertisement
│   └── 02-namespaces.yaml       ← 전체 네임스페이스 생성
│
├── step2-ingress/          ← Ingress + 앱 외부접속
│   ├── README.md           ← 실행 순서 가이드
│   ├── 01-nginx-ingress-controller.yaml  ← Nginx Ingress Controller
│   ├── 02-app-ingress.yaml               ← FE/BE 라우팅 규칙
│   └── 03-app-services.yaml              ← frontend-svc, backend-svc
│
└── step3-lgtm/             ← 데이터/파이프라인 붙이기 (LGTM)
    ├── README.md            ← 실행 순서 가이드
    ├── monitoring-vm/       ← monitoring VM (192.168.56.30)에 복사
    │   ├── docker-compose.yml
    │   ├── loki/config.yml
    │   ├── tempo/config.yml
    │   ├── mimir/config.yml
    │   └── grafana/provisioning/datasources/datasources.yml
    └── alloy/               ← K8s 클러스터 내 배포
        └── 01-alloy-daemonset.yaml
```

## 실행 순서 요약

### Step 1: MetalLB (k8s-master에서)

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.3/config/manifests/metallb-native.yaml
kubectl wait --namespace metallb-system --for=condition=ready pod --selector=app=metallb --timeout=120s
kubectl apply -f step1-metallb/01-metallb-ippool.yaml
kubectl apply -f step1-metallb/02-namespaces.yaml
# Istio 설치 (별도)
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.21.0 sh -
sudo mv istio-1.21.0/bin/istioctl /usr/local/bin/
istioctl install --set profile=default -y
# 확인
kubectl get svc -n istio-system istio-ingressgateway  # EXTERNAL-IP 확인
```

### Step 2: Nginx Ingress (k8s-master에서)

```bash
kubectl apply -f step2-ingress/01-nginx-ingress-controller.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s
kubectl apply -f step2-ingress/03-app-services.yaml
kubectl apply -f step2-ingress/02-app-ingress.yaml
# 확인
kubectl get svc -n ingress-nginx ingress-nginx-controller  # EXTERNAL-IP 확인
```

### Step 3-A: LGTM (monitoring VM에서)

```bash
scp -r step3-lgtm/monitoring-vm/* clouddx@192.168.56.30:/opt/monitoring/
ssh clouddx@192.168.56.30
cd /opt/monitoring && docker compose up -d
```

### Step 3-B: Alloy DaemonSet (k8s-master에서)

```bash
kubectl apply -f step3-lgtm/alloy/01-alloy-daemonset.yaml
kubectl get pods -n monitoring -o wide  # 모든 노드에 1개씩 확인
```
