# 2026-03-03 노드 복구, OAuth 로그인 활성화, Tutum 브랜딩 통일

## 작업자
박성준

## 작업 유형
Infra 복구 / Auth / Frontend

---

## 작업 1: K8s 노드 전체 복구 및 Pod 정상화

### 배경
클러스터 재시작 후 cp-3, worker1/2/3 총 4개 노드가 NotReady 상태.
Terminating/Unknown 상태 Pod 34개 잔재.

### 노드 상태
| 노드 | 원인 | 처리 |
|------|------|------|
| cp-3 | kubelet 재시작 중 | 자동 복구 (Ready) |
| worker1 | VM 부팅 중 | VirtualBox VM 부팅 완료 후 자동 Ready |
| worker2/3 | VM 재시작 | 자동 복구 (Ready) |

### Pod 정상화 작업

**Terminating / Unknown (34개) 강제 삭제:**
```bash
kubectl delete pod -n <ns> <name> --force --grace-period=0
```

**kyverno-cleanup ImagePullBackOff 수정:**
- 원인: `bitnami/kubectl:1.28.5` 이미지 Docker Hub에서 삭제됨
- 해결: 4개 CronJob 이미지를 `bitnami/kubectl:latest`로 패치
```bash
kubectl patch cronjob -n kyverno <name> --type=json \
  -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"bitnami/kubectl:latest"}]'
```

**sonarqube Pending 수정:**
- 원인: StatefulSet 노드셀렉터 `worker1` → 메모리 부족 (83% 사용)
- PV node affinity 확인 → `worker3`에 바인딩된 것 확인
- StatefulSet 노드셀렉터를 `worker3`으로 수정 후 Pod 재생성

### 최종 결과
- 노드: **6/6 Ready**
- Pods: **Running 88개 + Completed 4개**, 비정상 0개

---

## 작업 2: Kakao OAuth 로그인 활성화

### 배경
`https://tutum.my` 로그인 페이지에서 카카오 버튼 클릭 시 KOE006 오류 발생.

### 원인
K8s Secret에 `KAKAO_REDIRECT_URI=https://tutum.my/api/v1/auth/kakao/callback`이 설정되어 있으나
카카오 개발자 콘솔에 해당 URI가 미등록.

### 해결
카카오 개발자 콘솔 → Tutum 앱 → REST API 키 수정 → 카카오 로그인 리다이렉트 URI 추가:
```
https://tutum.my/api/v1/auth/kakao/callback
```

---

## 작업 3: 네이버 OAuth 로그인 활성화

### 배경
백엔드 `/naver/login`, `/naver/callback` 엔드포인트와 프론트엔드 네이버 버튼은 이미 구현되어 있으나,
K8s Secret에 Naver 자격증명이 누락되어 실제 동작하지 않는 상태.

### 수정 파일
**`k8s-manifests/base/backend/secret.yaml`**
```yaml
# Naver OAuth (추가)
NAVER_CLIENT_ID: "qMuWKO79tDtOAActKx5I"
NAVER_CLIENT_SECRET: "9Bf7FTqqSa"
NAVER_REDIRECT_URI: "https://tutum.my/api/v1/auth/naver/callback"
```

### K8s 반영
```bash
kubectl patch secret -n tutum-app backend-secret --type=merge \
  -p '{"stringData":{"NAVER_CLIENT_ID":"...","NAVER_CLIENT_SECRET":"...","NAVER_REDIRECT_URI":"..."}}'
kubectl rollout restart deployment -n tutum-app backend
```

### 추가 필요 작업
- 네이버 개발자 콘솔 → Tutum 앱 → Callback URL 등록:
  `https://tutum.my/api/v1/auth/naver/callback`

---

## 작업 4: 브랜딩 통일 (tutum → Tutum)

### 배경
UI 전반에 소문자 `tutum`이 혼재. 공식 표기는 대문자 `Tutum`으로 통일.

### 변경 파일 (14개)
| 파일 | 변경 내용 |
|------|-----------|
| `components/Header.tsx` | 좌측 상단 로고 |
| `components/TopNav.tsx` | 랜딩 네비 + 모바일 드로어 제목 |
| `components/DashboardNav.tsx` | 대시보드 사이드바 로고 |
| `components/PortfolioHeader.tsx` | 포트폴리오 헤더 로고 |
| `components/Footer.tsx` | 푸터 브랜드명 + 배경 대형 텍스트 |
| `components/HeroCarousel.tsx` | 메인 슬라이드 텍스트 |
| `components/ScrollRevealSection.tsx` | 스크롤 섹션 설명 |
| `components/chat/ChatContainer.tsx` | 채팅 헤더 |
| `components/chat/ChatMessages.tsx` | 채팅 빈 화면 |
| `components/chat/AIChatFAB.tsx` | 플로팅 AI 버튼 |
| `components/AlertPresets.tsx` | 알림 발신자명 |
| `components/MarketSnapshot.tsx` | 마켓 카드 타이틀 |
| `components/InsightPreview.tsx` | 인사이트 섹션 |
| `app/not-found.tsx` | 404 페이지 |

**변경하지 않은 것** (기능적 식별자):
- localStorage 키: `tutum_favorites`, `tutum_watchlist`, `tutum_holdings`, `tutum_dashboard_order`
- K8s 네임스페이스: `tutum-app`, `tutum-data`
- 내부 서비스 URL: `*.tutum-app.svc.cluster.local`

---

## CI/CD
- develop 브랜치 push → GitLab CI 자동 실행
- frontend 이미지 빌드 및 registry.gitlab.com 에 push
- ArgoCD가 변경 감지 후 K8s 자동 배포
