# 2026-03-05 Team Handoff: AWS Prod EKS 마이그레이션 진행상태 및 재개 가이드

## 한 줄 요약

오늘까지는 **EKS 클러스터 자체 연결/ArgoCD 동기화까지는 진행**되었고,  
실제 장애는 대부분 `tutum-app`에서 앱 Pod가 `ImagePullBackOff`로 막히면서 생겼다.  
다음 작업은 **이미지 pull + 네임스페이스 정합성 + kafka/redis endpoint 복구**가 핵심이다.

---

## 1. 지금까지 완료된 마이그레이션 단계

- `tutum-prd-eks` 기준으로 Prod 배포 체인 연결 작업은 진행됨
- `argocd app get/set/sync`로 `tutum-production` 동기화 단계까지 반복 진입
- 최종 매니페스트 기준은 기본적으로 `k8s-manifests/overlays/production`
- 운영 앱 네임스페이스는 실제로 `tutum-app` 기준으로 동작
- 네임스페이스는:
  - `tutum-app` (애플리케이션)
  - `tutum-data` (kafka/redis/mongo 등)
  - `tutum-storage` (minio 등)
- `tutum-prod-app`은 `Terminating` 상태로 남아 있고, 현재 앱 타깃으로는 `tutum-app`이 맞음

---

## 2. 현재 증상(즉시 확인 필요)

- `ImagePullBackOff`가 지속됨
- 롤아웃은 진행이 아니라 `ProgressDeadlineExceeded`로 멈춤
- `kubectl get endpoints -n tutum-data kafka redis`가 `<none>`으로 표시됨
- 때문에 Kafka 관련 worker는 시작 직전에도 기능 검증이 어려운 상태

---

## 3. 네임스페이스 정리(가장 중요)

### ✅ 현재 기준으로 고정할 것
- 앱 워크로드: `tutum-app`
- 데이터 워크로드: `tutum-data`
- 스토리지 워크로드: `tutum-storage`

### ❌ 주의
- 명령을 `tutum-prod-app`에 섞어 실행하면 `deploy not found`가 빈번하게 발생
- 과거 문서/리소스에서 `tutum-prod-app`이 남아 있을 수 있어도, 현재 실제 타깃은 `tutum-app`

---

## 4. AWS 설정(재개 전 체크)

## 4.1 기본 전제
- 리전: `ap-northeast-2`
- 대상 클러스터: `tutum-prd-eks`
- (현재는 문서상) 프로덕션 매니페스트 경로: `k8s-manifests/overlays/production`

## 4.2 ArgoCD 접근(요약)
1. 클러스터 등록/동기화 확인
2. 애플리케이션 타깃이 prod EKS인지 재확인
3. 동기화 후 앱 네임스페이스를 `tutum-app`로 고정해 관찰

## 4.3 핵심 포인트
- 노드 그룹 역할은 `tutum-eks-node-role-stg` 확인 이력 존재 (최종 기준 여부는 재확인 필요)
- `gitlab-registry-secret`은 앱 실행 namespace와 같은 곳에서 유효해야 함
- 이미지 태그는 현재 `stable`로 오버라이드되어 동작 중임

---

## 5. 내일 팀원이 바로 이어서 할 일 (순서대로)

1. `kubectl` 컨텍스트 재검증 (`tutum-prd-eks`)
2. 아래 3개 네임스페이스 존재/상태 확인
   - `kubectl get ns tutum-app tutum-data tutum-storage`
3. Secret 및 Secret 동기화 확인
   - `kubectl -n tutum-app get secret gitlab-registry-secret`
4. 이미지 풀 관련 상태 정리
   - `kubectl -n tutum-app describe deploy backend`
   - `kubectl -n tutum-app get pods`
5. kafka/redis 엔드포인트 확인
   - `kubectl -n tutum-data get svc kafka redis mongodb`
   - `kubectl -n tutum-data get endpoints kafka redis`
6. 문제 원인별 분기
   - Secret/이미지: `ImagePullBackOff` 원인 확인 후 secret 재생성
   - 네트워크: 노드 SG/라우팅/ECR/DockerHub outbound 정책 점검
   - 데이터층 준비 미완료: statefulset/endpoint가 정상화되면 worker 재시작

---

## 6. 오늘 실수/주의사항 메모

- `kubectl rollout status` 실행 시 한 줄이 깨지거나 붙으면 `NotFound`로 오해하기 쉬움
- 동일 명령을 붙여 넣을 때 줄바꿈/따옴표 오염이 자주 있었음
- `kubectl` 컨텍스트가 로컬에 없으면 바로 실패하므로, 시작 전에 `kubectl config get-contexts`로 확인 필수

---

## 7. 다음 세션 성공 기준(Definition of Done)

- `tutum-app` 내 핵심 디플로이먼트 Ready 100%
- `kafka` / `redis` 엔드포인트가 비어 있지 않음
- worker(consumer/producer/email-worker/price-consumer/backend/frontend) 로그가 정상 기동 로그로 넘어감
- `argocd app sync tutum-production` 후 재동기화에서 반복 Rollout Timeout이 없어야 함

