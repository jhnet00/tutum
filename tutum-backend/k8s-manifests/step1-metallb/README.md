# Step 1: K8s 진입점 확보 (MetalLB)

## 목표

MetalLB 설치 → IP 풀 설정 → LB svc EXTERNAL-IP 확인

## 실행 순서 (k8s-master에서)

```bash
# 1. MetalLB 설치
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.3/config/manifests/metallb-native.yaml

# 2. MetalLB Pod 준비 대기
kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app=metallb \
  --timeout=120s

# 3. IP 풀 적용
kubectl apply -f 01-metallb-ippool.yaml

# 4. 네임스페이스 생성
kubectl apply -f 02-namespaces.yaml

# 5. Istio 설치 (별도 진행)
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.21.0 sh -
sudo mv istio-1.21.0/bin/istioctl /usr/local/bin/
istioctl install --set profile=default -y

# 6. 완료 확인
kubectl get svc -n istio-system istio-ingressgateway
# EXTERNAL-IP 컬럼에 192.168.56.10x 가 보이면 성공!
```

## 완료 기준

- [ ] MetalLB Pod 전부 Running
- [ ] `kubectl get svc -n istio-system istio-ingressgateway` → EXTERNAL-IP 할당됨
- [ ] 네임스페이스 6개 생성 확인
