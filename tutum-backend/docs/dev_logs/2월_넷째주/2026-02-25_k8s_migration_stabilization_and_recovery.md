# 개발 로그 작업 요약 (2026-02-25)

## 1. 작업 요약
- 작업 일시: 2026-02-25
- 작업자: Kyung Yoon Kim
- 작업 목적: NODE123 -> K8s 이관 과정에서 발생한 배포/데이터/스케줄링 이슈를 복구하고, 운영 기준 상태로 재안정화

## 2. 상세 변경 사항
- `stg-*` 리소스 재생성 원인 식별
  - 원인: ArgoCD `tutum-staging` Application 자동 동기화(`prune/selfHeal`)
- ArgoCD 정리
  - `argocd/tutum-staging` 삭제로 재생성 루프 차단
- base 매니페스트 재적용 및 복구
  - `/home/clouddx/clouddx-project/k8s-manifests/base` 기준 재적용
  - 네임스페이스/서비스/워크로드 재생성
- 시크릿 복구
  - `backend-secret`, `harbor-secret`, `gitlab-registry-secret` 재생성
  - GitLab registry pull credential 유효값으로 재설정 후 앱 롤아웃 정상화
- MongoDB 복구
  - ReplicaSet 재초기화(`rs.initiate`)
  - Atlas -> K8s `mongodump | mongorestore` 재수행
  - 데이터 건수 검증 완료(로컬/Atlas 일치)
- 매니페스트 보완
  - `k8s-manifests/base/kustomization.yaml`에 `backend/secret.yaml` 포함
  - `news-producer`, `news-consumer`, `elastic-consumer` 기본 `replicas: 0`으로 조정
  - `ingress/gateway.yaml`, `ingress/virtualservice.yaml` 반영 유지

## 3. 작업 중 발생 이슈 및 대응
- 이슈: `tutum-staging` 삭제 시 ArgoCD finalizer prune으로 `tutum-app/tutum-data/tutum-storage` 리소스 동반 삭제
- 대응:
  - base 매니페스트 즉시 재적용
  - 필수 secret 재복구
  - 애플리케이션 롤아웃 재진행
  - Mongo 데이터 재복구 및 재검증

## 4. 결과
- 클러스터 상태
  - `tutum-app`: backend/frontend/price-producer/price-consumer/email-worker Running
  - `tutum-data`: mongodb(3/3), kafka(1/1), redis(1/1) Running
  - `tutum-storage`: minio(1/1) Running
- 인그레스 검증
  - `http://192.168.0.240/` -> 200
  - `http://192.168.0.240/api/v1/market/price/crypto/KRW-BTC` -> 200
- Mongo 컬렉션 건수 검증
  - `assets:22`, `email_verification_tokens:7`, `users:11`, `news:6240`
- 운영 제외(임시)
  - `news-producer`, `news-consumer`, `elastic-consumer`는 레지스트리 접근 불가로 `replicas=0`

## 5. 커밋 로그
```bash
git log --oneline --since="2026-02-25" --until="2026-02-25 23:59:59"
```

## 6. 비고
- 다음 작업 우선순위
  1. `192.168.56.12:8080` 이미지를 GitLab Registry 기준으로 이관
  2. `news/*`, `elastic-consumer` 재배포(`replicas` 복원)
  3. Runbook Phase 6(기존 node1/2/3 축소/종료) 단계 진행

## 7. 후속 진행 (푸시 이후)
- Phase 6 선행 점검 수행 (`kubectl debug node/worker1|2|3`)
- 호스트 점검 결과
  - `/usr/bin/docker`: 없음
  - `/home/kafka/docker-compose.yml`: 없음
- 해석
  - 현재 worker 호스트 기준으로 기존 Docker Compose 런타임 잔존 징후 없음
  - 병행 실행 리스크는 낮으나, Phase 6 최종 완료 표기는 안정화 모니터링 종료 후 확정 예정

## 9. Worker 노드 RAM 업그레이드 (2026-02-25 오후)

### 업그레이드 내역
| 노드 | 전 | 후 | 비고 |
|------|-----|-----|------|
| worker3 | 4GB | 8GB | swap 재활성화 이슈 → fstab 수정 |
| worker1 | 6GB | 8GB | Istio PDB 제거 후 drain |
| worker2 | 6GB | 12GB | drain 정상 완료 |

### 절차
```
kubectl cordon <node>
kubectl drain <node> --ignore-daemonsets --force --delete-emptydir-data
# VM 셧다운 → RAM 증설 → VM 기동
sudo swapoff -a
sudo sed -i '/swap/s/^/#/' /etc/fstab   # swap 영구 비활성화
kubectl uncordon <node>
```

### 이슈 및 대응
- **swap 재활성화**: VM 재기동 시 swap 자동 활성화 → kubelet 시작 실패
  - 원인: 기존 `sed -i '/ swap / s/^/#/'` 패턴이 탭 문자 포함 라인 미매칭
  - 해결: `sed -i '/swap/s/^/#/' /etc/fstab` 으로 수정
- **Istio PDB 차단**: worker1 drain 시 `istiod`, `istio-ingressgateway` PDB minAvailable=1 위반
  - 해결: PDB 임시 삭제 후 drain → pod 자동 재스케줄

### 업그레이드 후 메모리 현황
| 노드 | 총 메모리 | 여유 |
|------|-----------|------|
| worker1 | 7.8Gi | 5.0Gi |
| worker2 | 11Gi | 10Gi |
| worker3 | 7.8Gi | 4.4Gi |

---

## 10. GitLab 레포 통합 (2026-02-25 오후)

### 배경
- 팀원이 `tutum-project/k8s-manifests` (GitLab UI: tutum-app)에서 별도 작업
- 우리 메인: `tutum-project/tutum-app/backend` (GitLab UI: tutum-b/backend)
- 두 레포 코드 내용은 이미 동일 (Already up to date 확인)

### 작업 내용
1. 서브그룹 이름 변경: `tutum-b` → `tutum`
2. CI/CD 변수 이전 (tutum-app → tutum/backend)
   - SLACK_WEBHOOK_URL, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
3. tutum-app(k8s-manifests) 레포 archive 처리
4. 로컬 remote 정리: GitHub origin 제거, GitLab SSH → HTTPS 통일

### 최종 구조
```
tutum-project (GitLab 그룹)
└── tutum (서브그룹, URL: tutum-app)
    └── backend  ← 팀 단일 레포
        git clone: https://gitlab.com/tutum-project/tutum-app/backend.git
```

### 팀원 remote 전환 안내
```bash
git remote set-url origin https://gitlab.com/tutum-project/tutum-app/backend.git
git pull origin develop
```

---

## 11. push 트리거 파이프라인 0 jobs 문제 (미해결)

### 증상
- `git push` → 파이프라인 즉시 failed, jobs 0개
- API/Web 트리거 → 정상 (17개 jobs)

### 조사 결과
- `yaml_errors: null` ✓
- `ci_config_path: ""` (default .gitlab-ci.yml) ✓
- `shared_runners_enabled: true` ✓
- `workflow:rules`에 push 포함 ✓
- CI Lint dry_run → valid, 모든 job 정상 ✓
- 원인 미확정 → 추가 조사 필요

---

## 8. 재발 대응 (stg 자동 생성 루프 차단)
- 증상: `tutum-staging` Application이 재생성되며 `stg-*` 리소스 재발
- 조치:
  - `tutum-staging` finalizer 제거 후 삭제(네임스페이스 prune 방지)
  - `stg-*` Deployment/STS/Service/Pod/PVC/Secret/Job 정리
  - Kyverno 정책 `block-tutum-staging-application` 적용
    - `Application/tutum-staging` CREATE/UPDATE 차단(Enforce)
- 검증:
  - `kubectl apply -f k8s-manifests/argocd/staging-app.yaml` -> 정책 거부 확인
  - `k8s-migration-smoke.sh` 재실행 -> All checks passed
