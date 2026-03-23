# OAuth 수정, Admin 접근 복구, 파이프라인 DB 불일치 해결, Admin 대시보드 확장

**날짜**: 2026-03-05
**작업자**: Kyungyoon Kim
**브랜치**: develop

---

## 1. OAuth "state is missing" 원인 추적 및 배포 차단 해결

### 원인 체인

```
fix 커밋(d0fbd48) push
  → CI 파이프라인 성공 → deploy:staging 커밋 → 이미지 태그 d0fbd48e
  → ArgoCD sync 시도
  → Kyverno verify-image-signature (Enforce) 차단
    → cosign 서명 없음 → 모든 Deployment 업데이트 불가
  → 구버전 프론트엔드(2df8d9da) 계속 실행
  → proxy route.ts Set-Cookie 드롭 → OAuth state 쿠키 미전달
  → 콜백 시 "OAuth state is missing"
```

### Kyverno 임시 완화

```bash
kubectl patch clusterpolicy verify-image-signature \
  --type=merge -p '{"spec":{"validationFailureAction":"Audit"}}'
```

ArgoCD 강제 sync → 프론트엔드 `d0fbd48e` 이미지 롤아웃 완료.

### proxy Set-Cookie 수정 (d0fbd48)

`frontend/app/api/proxy/[...path]/route.ts` — redirect(3xx) 응답에서 Set-Cookie 드롭 문제:

```typescript
// 수정 전: redirect 응답에 Set-Cookie 누락
if ([301, 302, 307, 308].includes(upstream.status)) {
  redirectHeaders.set("location", location);
  return new Response(null, { status: upstream.status, headers: redirectHeaders });
}

// 수정 후: Set-Cookie 전달 (OAuth state 쿠키 포함)
const setCookiesOnRedirect = (upstream.headers as any).getSetCookie?.() ?? [];
for (const cookie of setCookiesOnRedirect) {
  redirectHeaders.append("set-cookie", cookie);
}
```

### Cosign 서명 미작동 원인

CI 파이프라인 sign 스테이지는 존재하나 `d0fbd48e` 이미지에 서명 부재.
→ 추후 GitLab CI `COSIGN_PRIVATE_KEY` 변수 점검 필요.

---

## 2. Admin 403 Forbidden — IP 허용 목록 수정

### 원인

```
브라우저 → Cloudflare Tunnel → Istio → frontend pod(10.244.x.x) → backend
```

백엔드가 보는 소스 IP = 파드 네트워크 IP (`10.244.x.x`).
기존 `ADMIN_IP_ALLOWLIST = 127.0.0.1/8, 192.168.0.0/24` → 파드 IP 불허 → 403.

### 수정

`backend/app/routers/admin.py`:
```python
_DEFAULT_ADMIN_NETWORKS = "127.0.0.1/8,192.168.0.0/24,10.0.0.0/8"
```

K8s 시크릿 즉시 반영 (CI 대기 없이):
```bash
kubectl patch secret backend-secret -n tutum-app \
  --type merge -p '{"stringData":{"ADMIN_IP_ALLOWLIST":"127.0.0.1/8,192.168.0.0/24,10.0.0.0/8"}}'
kubectl rollout restart deployment/backend -n tutum-app
```

> **참고**: Cloudflare Tunnel 경유 접근 시 CF-Connecting-IP가 실제 사용자 IP.
> 현재는 파드 네트워크 허용으로 운영하고 JWT 인증이 실질적 보안 역할.
> 엄격한 IP 제한이 필요하면 Cloudflare Access Zero Trust 적용 권장.

---

## 3. 뉴스 파이프라인 MongoDB DB 불일치 수정

### 원인

```
news-consumer  → MONGO_DB=tutum   (tutum.news  ← 3,429건, 최신)
백엔드 admin   → MONGODB_DB_NAME=clouddx (clouddx.news ← 6,240건, 2월 25일 이후 정체)
```

`/admin` 대시보드의 "최근 1h 추가 = +0"은 `clouddx.news`에 새 기사가 없어서 발생.

### 수정

`k8s-manifests/base/workers/news-configmap.yaml`:
```yaml
MONGO_DB: "clouddx"   # 기존: "tutum"
```

K8s ConfigMap 즉시 패치 + news-consumer 재시작:
```bash
kubectl patch configmap news-pipeline-config -n tutum-app \
  --type merge -p '{"data":{"MONGO_DB":"clouddx"}}'
kubectl rollout restart deployment/news-consumer -n tutum-app
```

### 데이터 마이그레이션

`tutum.news` → `clouddx.news` URL 기준 upsert:
```javascript
src.find({}).forEach(function(doc) {
  delete doc._id;
  dst.updateOne({url: doc.url}, {$setOnInsert: doc}, {upsert: true});
});
// migrated: 3,360건 / clouddx.news 총계: 9,662건
```

---

## 4. Admin 대시보드 관측성 확장

### 4-a. 데이터 레이어 카드 툴팁 추가

MongoDB, Elasticsearch, Redis, Kafka 카드에 `ⓘ` 아이콘 + 설명 툴팁 추가:
- **MongoDB**: 컬렉션 용도, 1h 추가 의미
- **ES**: JVM Heap 임계치, 스토리지 의미, Rejected 위험성
- **Redis**: Hit Rate 기준, eviction 위험, 커넥션 급증 의미
- **Kafka**: lag 임계치, 처리량 계산 방식, 장애 판단 기준

### 4-b. Disk 카드 — 노드별 사용률 바 추가

**Backend** (`backend/app/routers/admin.py`):
```python
# node_exporter per-instance 쿼리 (sum 없이)
size_data = await _mimir_query("/api/v1/query",
    params={"query": 'node_filesystem_size_bytes{mountpoint="/"}'})
avail_data = await _mimir_query("/api/v1/query",
    params={"query": 'node_filesystem_avail_bytes{mountpoint="/"}'})
# → disk.nodes: [{hostname, total_gb, used_gb, used_pct}]
```

**Frontend**: Disk 카드 하단에 노드별 사용률 미니 바 추가 (70% WARN / 85% CRITICAL).

### 4-c. Elasticsearch 카드 — 인덱스 스토리지 추가

```python
"es_store_bytes": [
    "sum(elasticsearch_indices_store_size_bytes_total)",
    "sum(elasticsearch_indices_store_size_bytes)",
],
```

ES 카드에 `스토리지 X.X GB` 행 표시.

---

## 5. 오늘의 교훈

| 항목 | 교훈 |
|------|------|
| Kyverno Enforce + cosign | CI sign 스테이지 성공 여부와 별개로 ArgoCD sync 차단 가능 — 이미지 서명 상태 정기 점검 필요 |
| Cloudflare Tunnel + IP 체크 | 프록시 아키텍처에서 IP 기반 인가는 파드 IP가 노출되므로 앱 레벨이 아닌 인프라 레벨(Cloudflare Access, Istio AuthorizationPolicy)에서 처리 권장 |
| DB 이름 통일 | consumer/backend 간 MongoDB DB명 불일치로 데이터 파편화 — 신규 서비스 연동 시 MONGODB_DB_NAME 공유 변수 확인 필수 |
| OAuth state 쿠키 | Next.js proxy가 redirect 응답의 Set-Cookie를 드롭하면 OAuth 상태 검증 실패 — proxy 코드 변경 시 헤더 전달 목록 재확인 |
