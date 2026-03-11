# CI/CD Pipeline EKS E2E 완전 정상화 — sonar:backend 포함 전 스테이지 성공

- **날짜**: 2026-03-11
- **작업자**: 박성준
- **작업 분류**: CI/CD / EKS / SonarQube

---

## 배경

EKS 마이그레이션 후 GitLab CI/CD 파이프라인이 EKS Runner에서 처음으로 실행됨.
파이프라인 전체 스테이지 성공 확인 후, `sonar:backend` 502/504 → 401 → 최종 성공까지
단계적으로 수정.

---

## 수정 항목 1: GitLab Runner Job Pod node_selector 추가

**문제**: CI job pod가 `general-purpose` 노드(인터넷 없음)에 스케줄될 수 있어
외부 레지스트리 pull 실패 가능성 존재.

**수정**: `k8s-manifests/base/runner/gitlab-runner-values.yaml`
```toml
[runners.kubernetes.node_selector]
  "eks.amazonaws.com/nodeclass" = "private-only"
```
→ 모든 CI job pod를 NAT GW가 있는 `private-only` 노드에 강제 배치.

Runner Helm upgrade (revision 7) 적용.

---

## 수정 항목 2: CI 이미지 ECR 미러 교체 + K8S_MANIFESTS_REPO 수정

**문제**:
- `.gitlab-ci.yml`에서 `K8S_MANIFESTS_REPO`가 존재하지 않는 `k8s-manifests.git` 별도 레포를 참조
- lint/test/sonar/build/notify 이미지들이 외부 레지스트리(python, sonar-scanner, kaniko, curl)로 설정

**수정** (`.gitlab-ci.yml`):
| 이미지 | 수정 전 | 수정 후 |
|--------|---------|---------|
| lint/test | `python:3.11-slim` | ECR mirror |
| sonar:backend | `sonarsource/sonar-scanner-cli:latest` | ECR mirror |
| build:* | `gcr.io/kaniko-project/executor:v1.23.2-debug` | ECR mirror |
| notify:* | `curlimages/curl:8.7.1` | ECR mirror |

K8S_MANIFESTS_REPO → `tutum-backend.git` (같은 레포에 k8s-manifests 포함)

ECR 미러링한 이미지 (crane copy, cp-2):
- `python:3.11-slim` → ECR
- `sonarsource/sonar-scanner-cli:latest` → ECR
- `gcr.io/kaniko-project/executor:v1.23.2-debug` → ECR
- `curlimages/curl:8.7.1` → ECR

---

## 수정 항목 3: build/deploy 스테이지 web/api 트리거 지원

**문제**: GitLab UI에서 수동 파이프라인 트리거 시 build/deploy 스테이지가 skip됨.

**수정**: `rules`에 `CI_PIPELINE_SOURCE == "web"` / `"api"` 조건 추가.

---

## 수정 항목 4: SonarQube ALB 라우팅 → 내부 IP 전환

### 4-1. ALB 리스너 룰 추가 (이전)
`sonar.tutum.my` → `tutum-sonarqube-tg` (priority 10) 리스너 룰 추가.
health check path 수정: `//api/system/status` → `/api/system/status`.

### 4-2. 502 지속 문제 → 원인 분석
- ALB health check: healthy
- EKS pod → sonar.tutum.my: 502 (47ms, ALB instant reject)
- EKS pod → 10.60.11.95:9000 직접: timeout (SG 미허용)
- monitoring EC2 SG(`sg-09bcd23950d81a5f0`): port 9000이 ALB SG만 허용, EKS node SG 미허용

### 4-3. 최종 해결책: EKS 내부 직접 접근

**수정**:
1. monitoring EC2 SG에 포트 9000 inbound 추가: 소스 `sg-0a819286b08c1162e` (EKS cluster SG)
2. GitLab CI 변수 `SONAR_HOST_URL` 변경: `https://sonar.tutum.my` → `http://10.60.11.95:9000`

결과: EKS pod → monitoring EC2:9000 직접 연결 (3.9ms, HTTP 200).

---

## 수정 항목 5: SONAR_TOKEN 갱신

**문제**: 기존 `SONAR_TOKEN` (`squ_f194...`)이 만료/revoke 상태 → SonarQube 401 Unauthorized.

**수정**:
- SonarQube admin 비밀번호: `admin` (기본값 유지 상태였음) → 확인 후 `Himedia1234!`로 변경
- 신규 `GLOBAL_ANALYSIS_TOKEN` 생성: `squ_80f1...`
- GitLab CI 변수 `SONAR_TOKEN` 업데이트

---

## 파이프라인 최종 결과

Pipeline `2377426871` (develop 브랜치):
```
guard:branch    ✅
lint:backend    ✅
test:backend    ✅
sonar:backend   ✅  ← 이번에 수정 완료
build:backend   ✅
build:workers   ✅
sign:backend    ✅
sign:workers    ✅
deploy:staging  ✅
notify:success  ✅
```

전 스테이지 SUCCESS.

---

## 변경된 AWS 인프라 (콘솔/CLI 적용, Terraform 미반영)

| 항목 | 변경 내용 |
|------|----------|
| ALB 443 리스너 룰 (priority 10) | `sonar.tutum.my` → `tutum-sonarqube-tg` |
| `tutum-sonarqube-tg` health check | path `/api/system/status` 수정 |
| monitoring EC2 SG (sg-09bcd23950d81a5f0) | port 9000 inbound: EKS cluster SG 추가 |
| GitLab CI 변수 `SONAR_HOST_URL` | `https://sonar.tutum.my` → `http://10.60.11.95:9000` |
| GitLab CI 변수 `SONAR_TOKEN` | 신규 토큰으로 갱신 |
| SonarQube admin 비밀번호 | `admin` → `Himedia1234!` |
