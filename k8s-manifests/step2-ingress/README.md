# Step 2: Ingress + 앱 외부접속

## 목표

Nginx Ingress Controller 설치 → FE/BE 라우팅 규칙 작성 → 외부 접속 확인

## 실행 순서 (k8s-master에서)

```bash
# 1. Nginx Ingress Controller 설치 (MetalLB가 EXTERNAL-IP 자동 할당)
kubectl apply -f 01-nginx-ingress-controller.yaml

# 2. Ingress Controller 준비 대기
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

# 3. EXTERNAL-IP 확인 (192.168.56.10x 가 보여야 함)
kubectl get svc -n ingress-nginx ingress-nginx-controller

# 4. 앱 Service 생성 (Deployment가 먼저 있어야 함)
kubectl apply -f 03-app-services.yaml

# 5. Ingress 라우팅 규칙 적용
kubectl apply -f 02-app-ingress.yaml

# 6. 접속 테스트
INGRESS_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Ingress IP: $INGRESS_IP"
curl -s http://$INGRESS_IP/          # → Frontend
curl -s http://$INGRESS_IP/api/v1/health  # → Backend
```

## 완료 기준

- [ ] `kubectl get svc -n ingress-nginx` → EXTERNAL-IP 할당됨
- [ ] `curl http://<EXTERNAL-IP>/` → Frontend 응답
- [ ] `curl http://<EXTERNAL-IP>/api/v1/health` → Backend 응답
