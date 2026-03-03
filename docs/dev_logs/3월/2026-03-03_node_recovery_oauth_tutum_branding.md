# 개발 로그 작업 요약 (2026-03-03)

## 1. 작업 요약
- 작업 일시: 2026-03-03
- 작업자: kyk02405
- 브랜치: develop
- 작업 목적:
  - K8s 클러스터 노드 다운 복구 및 Pod 전체 정상화
  - Kakao OAuth 리다이렉트 URI 미등록 오류 해결
  - Naver OAuth K8s Secret 누락으로 인한 미작동 해결
  - 프론트엔드 전반 브랜딩 표기 `tutum` → `Tutum` 통일

---

## 2. 상세 변경 사항

### 2-1. K8s 노드 복구 및 Pod 정상화

**NotReady 노드 (4개) → 전체 Ready 복구**
- cp-3: kubelet 자동 재시작 후 Ready
- worker1: VirtualBox VM 부팅 완료 후 Ready
- worker2/3: VM 재시작 후 자동 Ready

**비정상 Pod 처리**

| 문제 | 원인 | 처리 |
|------|------|------|
| Terminating/Unknown 34개 | 워커 다운 중 죽은 Pod 잔재 | `--force --grace-period=0` 강제 삭제 |
| kyverno-cleanup ImagePullBackOff | `bitnami/kubectl:1.28.5` 이미지 삭제됨 | CronJob 이미지 → `bitnami/kubectl:latest` 패치 |
| sonarqube-sonarqube-0 Pending | StatefulSet 노드셀렉터 `worker1` (메모리 부족), PV는 `worker3`에 바인딩 | StatefulSet 노드셀렉터 `worker3`으로 수정 |

### 2-2. Kakao OAuth 활성화

- 원인: K8s Secret에 `KAKAO_REDIRECT_URI=https://tutum.my/api/v1/auth/kakao/callback` 설정되어 있으나 카카오 개발자 콘솔에 미등록 → KOE006 오류
- 해결: 카카오 개발자 콘솔 → Tutum 앱 → REST API 키 수정 → 리다이렉트 URI 추가

### 2-3. Naver OAuth 활성화

- 원인: 백엔드 엔드포인트(`/naver/login`, `/naver/callback`)와 프론트엔드 버튼은 구현 완료 상태였으나, K8s Secret에 Naver 자격증명 누락
- 변경 파일: `k8s-manifests/base/backend/secret.yaml`
  ```yaml
  NAVER_CLIENT_ID: "qMuWKO79tDtOAActKx5I"
  NAVER_CLIENT_SECRET: "9Bf7FTqqSa"
  NAVER_REDIRECT_URI: "https://tutum.my/api/v1/auth/naver/callback"
  ```
- K8s Secret 즉시 반영 및 backend Deployment rollout restart 수행

### 2-4. 브랜딩 통일 (tutum → Tutum)

변경 파일 14개 (UI 텍스트만, localStorage 키·K8s 네임스페이스·URL 제외)

| 파일 | 변경 위치 |
|------|-----------|
| `frontend/components/Header.tsx` | 좌측 상단 로고 |
| `frontend/components/TopNav.tsx` | 랜딩 네비게이션, 모바일 드로어 제목 |
| `frontend/components/DashboardNav.tsx` | 대시보드 사이드바 로고 |
| `frontend/components/PortfolioHeader.tsx` | 포트폴리오 헤더 로고 |
| `frontend/components/Footer.tsx` | 푸터 브랜드명, 배경 대형 텍스트 |
| `frontend/components/HeroCarousel.tsx` | 메인 슬라이드 문구 |
| `frontend/components/ScrollRevealSection.tsx` | 스크롤 섹션 설명 |
| `frontend/components/chat/ChatContainer.tsx` | 채팅 헤더 |
| `frontend/components/chat/ChatMessages.tsx` | 채팅 빈 화면 |
| `frontend/components/chat/AIChatFAB.tsx` | 플로팅 AI 버튼 |
| `frontend/components/AlertPresets.tsx` | 알림 발신자명 |
| `frontend/components/MarketSnapshot.tsx` | 마켓 카드 타이틀 |
| `frontend/components/InsightPreview.tsx` | 인사이트 섹션 |
| `frontend/app/not-found.tsx` | 404 페이지 |

---

## 3. 작업 중 발생 이슈 및 대응

- **이슈**: sonarqube PV가 `worker3`에 바인딩되어 있는데 StatefulSet 노드셀렉터는 `worker1`로 설정 → 메모리 부족으로 Pending
  - **대응**: `kubectl get pv`로 node affinity 확인 후 StatefulSet 노드셀렉터를 `worker3`으로 수정

- **이슈**: `bitnami/kubectl:1.28.5` Docker Hub에서 삭제됨 (versioned 태그 지원 종료)
  - **대응**: `bitnami/kubectl:latest`로 4개 CronJob 패치 및 기존 실패 Job 강제 삭제

- **이슈**: Naver 개발자 콘솔 Callback URL 등록 필요 (수동 작업)
  - **대응**: 별도 진행 필요 — `https://tutum.my/api/v1/auth/naver/callback`

---

## 4. 결과

- **검증 항목**:
  - `kubectl get nodes` → 6/6 Ready
  - `kubectl get pods -A` → Running 88개, Completed 4개, 비정상 0개
  - `https://tutum.my/login` Kakao 로그인 버튼 동작 확인
  - K8s Secret Naver 자격증명 반영 확인

- **검증 결과**:
  ```bash
  kubectl get nodes
  # NAME      STATUS   ROLES           AGE
  # cp-1      Ready    control-plane   7d21h
  # cp-2      Ready    control-plane   7d19h
  # cp-3      Ready    control-plane   7d19h
  # worker1   Ready    <none>          7d19h
  # worker2   Ready    <none>          6d
  # worker3   Ready    <none>          7d19h

  kubectl get secret -n tutum-app backend-secret -o jsonpath="{.data.NAVER_CLIENT_ID}" | base64 -d
  # qMuWKO79tDtOAActKx5I
  ```

---

## 5. 커밋 로그

```bash
git log --oneline
# 9024a7d feat(auth): enable Kakao/Naver OAuth and unify Tutum branding
```

---

## 6. 후속 작업/리스크

- [ ] 네이버 개발자 콘솔에서 Callback URL 등록: `https://tutum.my/api/v1/auth/naver/callback`
- [ ] Naver OAuth 실제 로그인 E2E 테스트
- [ ] GitLab CI 파이프라인 완료 후 ArgoCD 프론트엔드 배포 확인
