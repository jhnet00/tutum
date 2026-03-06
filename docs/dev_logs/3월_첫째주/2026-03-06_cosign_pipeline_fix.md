# Cosign 서명 누락 수정 및 CI 파이프라인 강화

**날짜**: 2026-03-06
**작업자**: 박성준
**브랜치**: develop

---

## 문제 배경

클러스터 총점검 중 Kyverno PolicyViolation Warning 반복 발견:
```
workers:d0fbd48e — unverified image (no cosign signature)
→ elastic-consumer, price-consumer, news-consumer 재스케줄 시도 시 경고 발생
```

`frontend:d0fbd48e`, `backend:d0fbd48e`는 서명되어 있으나 `workers:d0fbd48e`만 미서명.

---

## 원인 분석

**발생 경위**

1. commit `d0fbd48e` → CI 파이프라인 실행
2. `build:frontend` / `build:backend` / `build:workers` → 이미지 빌드 완료
3. `sign:frontend` / `sign:backend` → 서명 완료 ✅
4. `sign:workers` → 실패 (네트워크 또는 인증 이슈 추정)
5. `deploy:staging` → sign:workers 실패로 미실행
6. 팀원이 staging 배포를 위해 `kustomization.yaml`을 직접 `d0fbd48e`로 수정 후 push
7. ArgoCD가 sync → 미서명 `workers:d0fbd48e` 배포됨
8. Kyverno PolicyViolation 반복 발생

**파이프라인 취약점**

```yaml
# Before (취약한 구조)
sign:workers:
  needs:
    - job: security:workers
      optional: true   # ← security가 실행 안 돼도 sign 실행 시도
  # ❌ build:workers 의존성 없음
  #    → build가 skip돼도 sign 규칙만 맞으면 실행 시도 (이미지 없는 상태에서 sign → 실패)
```

`sign:workers`에 `build:workers` 필수 의존이 없어서,
수동 kustomization.yaml 수정 시 미서명 이미지가 배포될 수 있는 구멍이 있었음.

---

## 조치

### 1. workers:d0fbd48e 수동 서명 (cp-1 SSH)

```bash
export DOCKER_CONFIG=/tmp/cosign-docker
COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend/workers:d0fbd48e --yes
# Rekor tlog index: 1046134555 ✅

# 나머지 이미지도 재확인 서명
COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend/frontend:d0fbd48e --yes
# Rekor tlog index: 1046155555 ✅

COSIGN_PASSWORD=tutum123 cosign sign --key /tmp/cosign.key \
  registry.gitlab.com/tutum-project/tutum-app/backend:d0fbd48e --yes
# Rekor tlog index: 1046157148 ✅
```

### 2. CI 파이프라인 강화 (.gitlab-ci.yml)

`sign:*` 잡에 `build:*` 필수 의존 추가:

```yaml
# After (강화된 구조)
sign:frontend:
  needs:
    - job: build:frontend        # build가 skip → sign도 자동 skip
    - job: security:frontend
      optional: true

sign:backend:
  needs:
    - job: build:backend         # build가 skip → sign도 자동 skip
    - job: security:backend
      optional: true

sign:workers:
  needs:
    - job: build:workers         # build가 skip → sign도 자동 skip
    - job: security:workers
      optional: true
```

**효과**:
- build 잡이 skip되면 sign 잡도 자동으로 skip → unsigned 이미지 sign 시도 방지
- build → sign → deploy 의존 체인이 명확해져 중간 단계 누락 불가
- `deploy:staging`은 sign 3개 모두 성공 필수 → 미서명 이미지 배포 불가

---

## 재발 방지 팀 규칙

- **kustomization.yaml 직접 수정 금지**: CI `deploy:staging` 잡을 통해서만 태그 업데이트
- sign 잡이 실패하면 → 파이프라인 로그 확인 후 원인 수정 → 재실행 (수동 배포 ❌)
- 서명 키(`/tmp/cosign.key`)가 cp-1에서 만료/분실 시 즉시 팀에 공유

---

## 변경 파일

| 파일 | 변경 내용 |
|------|---------|
| `.gitlab-ci.yml` | sign:* 잡에 build:* 필수 needs 추가 |
