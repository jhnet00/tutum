# 📚 K8s 마이그레이션 & Git 운영 명령어 지침서

> **Author**: Ruby Kim  
> **Last Updated**: 2026-02-26  
> **대상**: Tutum 프로젝트 K8s 온프레미스 마이그레이션 경험 기반 정리  
> ⚠️ **원격 저장소 기준**: **GitLab 단일 운영** (소스코드 관리 / 레지스트리 / CI/CD 전부 GitLab)

---

## 1. Kubernetes 핵심 명령어

### 1-1. 클러스터 상태 확인

```bash
# 노드 상태 확인
kubectl get nodes -o wide

# 전체 네임스페이스 Pod 상태 확인
kubectl get pods -A

# 특정 네임스페이스 Pod 상세
kubectl get pods -n tutum-app -o wide

# Pod 상태 지속 관찰 (watch)
kubectl get pods -n tutum-app -w

# Pod 이벤트/오류 원인 확인 (가장 자주 씀)
kubectl describe pod <pod-name> -n <namespace>

# 모든 리소스 한번에 확인
kubectl get all -n tutum-app
```

### 1-2. 로그 확인

```bash
# Pod 로그 확인
kubectl logs <pod-name> -n <namespace>

# 이전 컨테이너 로그 (CrashLoop 이후 원인 확인)
kubectl logs <pod-name> -n <namespace> --previous

# 실시간 로그 스트리밍
kubectl logs -f <pod-name> -n <namespace>

# 멀티 컨테이너 Pod에서 특정 컨테이너 로그
kubectl logs <pod-name> -n <namespace> -c <container-name>
```

### 1-3. 리소스 적용/삭제

```bash
# 매니페스트 적용
kubectl apply -f <file.yaml>

# 디렉토리 전체 적용
kubectl apply -f <directory>/

# kustomize 기반 적용
kubectl apply -k k8s-manifests/base/

# 리소스 삭제 (주의: 운영 환경 사용 금지)
# kubectl delete -f <file.yaml>   # 🚫 운영에서는 scale down 우선

# Pod 강제 재시작 (롤링 재배포)
kubectl rollout restart deployment/<deployment-name> -n <namespace>

# 롤아웃 상태 확인
kubectl rollout status deployment/<deployment-name> -n <namespace>
```

### 1-4. 디버깅

```bash
# Pod 내부 셸 접속
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh

# 특정 컨테이너 접속
kubectl exec -it <pod-name> -n <namespace> -c <container-name> -- /bin/bash

# 포트 포워딩 (로컬에서 서비스 접근)
kubectl port-forward svc/<service-name> <local-port>:<service-port> -n <namespace>
# 예: kubectl port-forward svc/backend-svc 8000:8000 -n tutum-app

# ConfigMap/Secret 내용 확인
kubectl get configmap <name> -n <namespace> -o yaml
kubectl get secret <name> -n <namespace> -o yaml | base64 -d  # 값 디코딩 필요

# 이벤트 확인 (스케줄링 실패, OOM 등)
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
```

### 1-5. Taint & Node 라벨

```bash
# 노드 라벨 확인
kubectl get nodes --show-labels

# 노드 라벨 추가 (워크로드 분리)
kubectl label node <node-name> workload=app
kubectl label node <node-name> workload=data

# Taint 추가 (특정 노드에 스케줄링 제한)
kubectl taint nodes <node-name> key=value:NoSchedule

# Taint 제거
kubectl taint nodes <node-name> key=value:NoSchedule-
```

### 1-6. Istio 관련

```bash
# Istio 게이트웨이/VirtualService 상태 확인
kubectl get gateway,virtualservice -n tutum-app

# Istio 사이드카 주입 확인
kubectl get pods -n tutum-app -o jsonpath='{.items[*].spec.containers[*].name}'

# Istio 설정 검증
istioctl analyze -n tutum-app

# Kiali 포트 포워딩 (트래픽 시각화)
kubectl port-forward svc/kiali 20001:20001 -n istio-system
```

### 1-7. ArgoCD

```bash
# ArgoCD CLI 로그인
argocd login <argocd-server> --username admin --password <password>

# 앱 목록 확인
argocd app list

# 앱 동기화 (수동 sync)
argocd app sync <app-name>

# 앱 상태 확인
argocd app get <app-name>

# 포트 포워딩으로 UI 접근
kubectl port-forward svc/argocd-server 8080:443 -n argocd
```

---

## 2. Git 운영 명령어

### 2-1. 브랜치 관리

```bash
# 현재 브랜치 확인
git branch -a

# 새 브랜치 생성 및 이동
git checkout -b <branch-name>

# 원격 브랜치로 추적 설정하여 push (origin = GitLab)
git push -u origin <branch-name>

# 브랜치 삭제 (로컬)
git branch -d <branch-name>

# 브랜치 삭제 (원격)
git push origin --delete <branch-name>

# remote 확인 (origin이 GitLab인지 항상 확인)
git remote -v
```

### 2-2. develop에서 특정 파일만 가져오기

```bash
# origin/develop에서 특정 파일만 현재 브랜치로 가져오기
git fetch origin
git checkout origin/develop -- <파일경로>

# 예: workers 누락 파일 가져오기
git checkout origin/develop -- backend/workers/consumer_news.py
git checkout origin/develop -- backend/workers/elastic_consumer.py
git checkout origin/develop -- backend/workers/producer_news.py
```

### 2-3. 브랜치 비교 (develop vs 내 브랜치)

```bash
# develop 기준 내 브랜치에서 달라진 파일 목록
git fetch origin
git diff --name-only HEAD origin/develop

# 특정 디렉토리만 비교
git diff --name-only HEAD origin/develop -- backend/

# develop에 있는 파일 목록 확인
git ls-tree -r --name-only origin/develop -- backend/workers/

# 내 브랜치 파일 목록 확인
git ls-tree -r --name-only HEAD -- backend/workers/
```

### 2-4. 커밋 & 이력 관리

```bash
# 변경 파일 확인
git status
git diff --stat

# Stage & Commit (Jira 티켓 ID 포함)
git add <files>
git commit -m "KAN-XXX: feat: 작업 요약"

# 특정 파일만 커밋
git add backend/workers/consumer_news.py
git commit -m "KAN-123: feat: add consumer_news worker from develop"

# 커밋 이력 확인
git log --oneline -20

# 특정 날짜 범위 커밋 확인
git log --oneline --since="2026-02-25" --until="2026-02-26 23:59:59"
```

### 2-5. 실수 복구

```bash
# 마지막 커밋 취소 (staged 상태로 되돌림)
git reset --soft HEAD~1

# 마지막 커밋 취소 (변경 내용까지 버림) ⚠️ 주의
# git reset --hard HEAD~1

# 특정 파일 되돌리기 (최신 커밋 상태로)
git checkout HEAD -- <file>

# Stage 취소
git restore --staged <file>
```

---

## 3. 작업 흐름 지침서

### 3-1. 새 기능 작업 시작하는 순서

```
1. develop 최신 상태 fetch (origin = GitLab)
   git fetch origin

2. 내 브랜치에서 develop 내용 확인
   git diff --name-only HEAD origin/develop -- backend/

3. 누락 파일 있으면 가져오기
   git checkout origin/develop -- <파일경로>

4. 작업 후 커밋 (Jira 티켓 ID 포함)
   git add <files>
   git commit -m "KAN-XXX: feat: 설명"

5. GitLab에 push
   git push origin <내브랜치>
   # GitLab MR(Merge Request)로 develop 병합 요청
```

### 3-2. K8s 클러스터에 새 매니페스트 적용하는 순서

```
1. 로컬에서 YAML 작성/수정

2. kustomization.yaml에 리소스 등록 확인

3. dry-run으로 사전 검증
   kubectl apply -f <file.yaml> --dry-run=client

4. 실제 적용
   kubectl apply -f <file.yaml>
   # 또는 kustomize 전체 적용
   kubectl apply -k k8s-manifests/base/

5. 적용 결과 확인
   kubectl get pods -n <namespace> -w

6. 이상 있으면 describe로 원인 파악
   kubectl describe pod <pod-name> -n <namespace>
   kubectl logs <pod-name> -n <namespace> --previous
```

### 3-3. CrashLoopBackOff 대응 순서

```
1. 원인 확인
   kubectl describe pod <pod-name> -n <namespace>
   kubectl logs <pod-name> -n <namespace> --previous

2. 이미지 문제이면 → 현재 배포 경로(ECR 또는 GitLab Registry)에서 이미지 빌드/푸시 재확인
   docker pull <registry>/<service>:<tag>

3. 환경변수/Secret 문제이면
   kubectl get secret <secret-name> -n <namespace> -o yaml

4. 임시 우회: replicas 0으로 scale down
   kubectl scale deployment <name> --replicas=0 -n <namespace>
   # 수정 후 다시 올리기
   kubectl scale deployment <name> --replicas=1 -n <namespace>

5. 완전 재적용 필요 시
   kubectl rollout restart deployment/<name> -n <namespace>
   kubectl rollout status deployment/<name> -n <namespace>
```

### 3-4. ArgoCD 동기화 순서 (GitOps)

```
1. 로컬에서 manifest 수정 후 GitLab에 push
   git add k8s-manifests/
   git commit -m "KAN-XXX: fix: 서비스 설정 수정"
   git push origin <브랜치>
   # GitLab CI/CD 파이프라인 자동 트리거 확인

2. ArgoCD UI 또는 CLI에서 Sync 실행
   argocd app sync tutum-staging

3. 동기화 상태 확인
   argocd app get tutum-staging
   kubectl get pods -n tutum-app -w

4. 운영(production) 반영은 수동 승인 후 sync
   argocd app sync tutum-production
```

---

## 4. 자주 쓰는 alias 추천

```bash
# ~/.bashrc 또는 ~/.zshrc에 추가
alias k='kubectl'
alias kgp='kubectl get pods -A'
alias kgn='kubectl get nodes -o wide'
alias kd='kubectl describe'
alias kl='kubectl logs'
alias kaf='kubectl apply -f'
alias kak='kubectl apply -k'
```
