# Dev Log: AWS Production EKS 마이그레이션(진행 중) – App 재기동 실패 정리 (2026-03-05)

## 1. 목적

2026-03-05 현재 진행 중인 AWS Prod EKS 마이그레이션에서 앱이 계속 `ImagePullBackOff`로 기동되지 않는 상태를 정리한다.  
핵심은 현재 상태 기록 + 팀 인수인계 포인트를 한 번에 남기는 것.

---

## 2. 이번 세션에 완료한 작업

1. `tutum-prd-eks` 쪽 Kubernetes 접근 경로 정리
   - `kubectl` 컨텍스트를 `tutum-prd-eks`로 설정하려는 작업 진행
   - `argocd app get/set/sync`로 프로덕션 앱(`tutum-production`) 상태 확인
2. `tutum-prod-app` 네임스페이스 이슈 인지
   - 앱 리소스가 실제로는 `tutum-app` 기준으로 동작 중임을 확인
   - `tutum-prod-app`은 Terminating 상태로 남아 있던 이력 확인
3. 프로덕션 앱 관련 Secret/Deploy 상태 점검
   - `gitlab-registry-secret` 존재/내용 확인 시도
   - app 디플로이먼트가 새 이미지 태그(`stable`)로 동작하는 모습 확인됨
4. Kafka/Redis 의존성 확인
   - `tutum-data`의 `kafka`, `redis` Service는 존재했지만 `ENDPOINTS <none>` (서비스 엔드포인트 미연결)

---

## 3. 핵심 증상 (현재)

- `kubectl get deploy -n tutum-app`  
  - `backend`, `frontend`, `email-worker`, `price-consumer`, `price-producer` 모두 `0/.. available`  
  - `Progressing: False`, `Available: False`, `ProgressDeadlineExceeded` 상태
- `kubectl get pod -o wide -n tutum-app`  
  - 대다수 Pod `STATUS=ImagePullBackOff`
- `kubectl rollout status` 시도 시
  - 일부는 타임아웃
  - 일부는 네임스페이스/타겟 명령 깨짐(오타/한 줄 뒤섞임)으로 `NotFound` 섞임
- `kubectl --context tutum-prd-eks -n tutum-data get endpoints kafka redis`
  - `kafka <none>`, `redis <none>`

---

## 4. 추정 원인

### A. 이미지 풀 실패가 1순위
Pod 이벤트는 대부분 `failed to pull image`/`ImagePullBackOff`.
에러는 크게 두 축:
1) GitLab Registry 접근권한(이미지 pull secret 누락 또는 네임스페이스 미스매치)
2) 컨테이너 런타임이 외부 registry 접속이 막힌 상태(클러스터 네트워크/노드 egress 상태)

### B. 네임스페이스 전환 충돌
초기 기대와 다르게 `tutum-app`이 앱 운영 네임스페이스이고, 기존 문서/명령 일부는 `tutum-prod-app`에 맞춰져 있었음.
이 때문에 로그 해석 시 “배포가 안 된다”가 아니라 “리소스 대상이 서로 다르다”가 함께 혼재됨.

### C. 데이터 인프라 가동 전 검증 미완료
`kafka`/`redis`가 서비스는 살아 있어도 endpoint가 비어 있으면, 워커 기동 후 바로 기능 오류가 연쇄됨.
지금은 우선 이미지 풀 자체가 막혀 있어 실제 앱 레벨 동작 로그를 못 보고 있는 상태.

---

## 5. 변경/실행 히스토리 (로그 기준 핵심)

1) ArgoCD/AKS 연결/동기화
- `argocd app get tutum-production`
- `argocd app sync tutum-production --prune`
- `argocd` 동기화는 반복 수행되었고, 앱 리소스는 일부 업데이트되나 앱 컨테이너는 기동 실패

2) 배포 환경
- `overlays/production` 기준 이미지 태그는 `stable`로 오버라이드됨
- app 디플로이먼트는 `tutum-app` ns 기반

3) 롤아웃
- `kubectl -n tutum-app set env ...`로 Kafka/Redis 주소를 `kafka.tutum-data.svc.cluster.local:9092`, `redis://redis.tutum-data.svc.cluster.local:6379` 형태로 일괄 반영
- `kubectl rollout restart deploy/...` 실행
- 그래도 `ImagePullBackOff` 계속 발생

4) 네트워크 진단
- `kubectl get endpoints kafka redis` 결과가 `<none>`
- `kubectl get svc`는 Kafka/Redis Service 존재

---

## 6. 남은 작업 우선순위 (우선순위 순)

1. **이미지 풀 패스 복구**
   - `tutum-app` 네임스페이스에 `gitlab-registry-secret`이 정확히 존재하는지 재확인
   - 없다면 해당 Secret을 생성/재배포 (base secret key 기준: `REGISTRY`, `MARIADB_...`, `SECRET_KEY` 조합)
   - `Deployment`가 실제로 참조하는 네임스페이스 확인
2. **노드/클러스터 외부 egress 경로 확인**
   - 필요한 경우 노드 라우팅/NAT/보안그룹 재확인
3. **Kafka/Redis endpoint 복구**
   - `kubectl get endpoints -n tutum-data kafka redis`가 채워질 때까지 데이터 StatefulSet/Ready 확인
4. **워크로드 재기동**
   - `kubectl rollout restart deploy/...` 후 상태 안정화
   - `kubectl logs`/`kubectl describe pod`로 1차 장애 여부 확인
5. **네임스페이스 정리**
   - `tutum-prod-app` 삭제/종료 완료 상태인지 확인 후 앱이 사용하는 네임스페이스 체계를 공식화

---

## 7. 팀 전달용 체크 포인트

- 오늘 팀원 대응이 불가해도, 다음 세션은 아래를 먼저 수행하면 동일한 지점에서 이어짐:
  1) `kubectl config`에서 `tutum-prd-eks` 컨텍스트 확인
  2) 현재 타깃 네임스페이스를 `tutum-app`로 고정
  3) `gitlab-registry-secret` → `tutum-app` 존재 확인
  4) `kubectl get endpoints -n tutum-data kafka redis`
  5) `kubectl get pod -n tutum-app`이 여전히 `ImagePullBackOff`면 `kubectl describe pod`부터 추적

---

## 8. 참고

- 현재 문서에서 참조한 작업 맥락
  - `docs/dev_logs/3월_첫째주/2026-03-05_aws_prod_eks_access_argocd_finalize.md`
  - `docs/ruby/2026-03-05_AWS_CONSOLE_TEAM_ACCESS_5H_RUNBOOK.md`
  - `docs/ruby/aws_settings/2026-03-05_confirmed_settings.md`

