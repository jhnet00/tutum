# 개발 로그 작업 요약 (2026-02-25)

## 1. 작업 요약

- 작업 일시: 2026-02-25
- 작업자: 김루비 (Ruby Kim)
- 협업: CloudDX
- 작업 목적: news-producer CrashLoopBackOff 원인 분석 및 복구, Istio 라우팅 403/404 오류 해결, 전체 서비스 안정화

---

## 2. 상세 변경 사항

### 2-1. news-producer CrashLoopBackOff 해결

- **원인**: Kubernetes Job/Deployment의 image가 Harbor에 정상 push되지 않았거나 실행 진입점(entrypoint) 파일 경로 불일치
- **확인 명령**:
  ```bash
  kubectl describe pod <news-producer-pod> -n tutum-app
  kubectl logs <news-producer-pod> -n tutum-app --previous
  ```
- **조치**: Dockerfile의 CMD 경로 및 workers/ 내 파일 존재 여부 확인 후 Harbor 재빌드/재푸시

### 2-2. Istio 라우팅 403/404 오류 해결

- **원인**: VirtualService의 rewrite 규칙이 `/api/v1/` prefix를 이중으로 붙이거나, 백엔드로 잘못된 경로 전달
- **조치**: `k8s-manifests/base/networking/` 하위 VirtualService rewrite 규칙 수정
  - `/api` → 백엔드 서비스로 prefix rewrite 적용
  - `/` → 프론트엔드 서비스로 라우팅 유지
- **검증**: `curl -H "Host: tutum.my" http://192.168.56.100/api/v1/market/status`

### 2-3. ArgoCD 재동기화 및 배포 확인

- 매니페스트 수정 후 Git push → ArgoCD 자동 sync (staging)
- `kubectl get pods -n tutum-app -w`로 롤아웃 상태 확인
- 전체 서비스 Running 상태 최종 확인

---

## 3. 작업 중 발생 이슈 및 대응

| 이슈                             | 원인                                     | 대응                                 |
| -------------------------------- | ---------------------------------------- | ------------------------------------ |
| `news-producer` CrashLoopBackOff | 실행 파일 경로 불일치 또는 이미지 미갱신 | Dockerfile CMD 수정 후 Harbor 재빌드 |
| `tutum.my` 접근 시 403           | Istio VirtualService rewrite 중복        | prefix rewrite 규칙 단순화           |
| `tutum.my/api/*` 404             | 백엔드 경로 매핑 누락                    | VirtualService match 조건 보완       |

---

## 4. 결과

- news-producer 정상 기동 확인
- `tutum.my` 진입 후 프론트엔드 렌더링 정상
- `/api/v1/` 엔드포인트 응답 정상 확인
- ArgoCD staging 앱 Synced + Healthy 상태

---

## 5. 커밋 로그

```bash
git log --oneline --since="2026-02-25" --until="2026-02-25 23:59:59"
```

---

## 6. 비고

- `news-producer` Dockerfile 수정 내용은 Harbor 재빌드 후 태그 갱신 필요
- Istio 라우팅 변경 사항은 `k8s-manifests/base/networking/` 이력 참고
- 운영 환경(production) ArgoCD sync는 수동 승인 후 진행 필요
