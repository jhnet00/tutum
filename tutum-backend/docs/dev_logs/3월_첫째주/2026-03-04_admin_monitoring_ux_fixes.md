# Dev Log: Admin 모니터링 대시보드 UX 버그 수정

> 작성일: 2026-03-04
> 작성자: kyungyoonkim
> 브랜치: `develop`
> 커밋: `accfcfe`, `8ee3202`, `596097d`, `74d7c0d`

---

## 작업 개요

`/admin` 모니터링 대시보드의 UX 버그 4건 수정 및 elasticsearch-exporter 배포 설정 개선.

---

## 수정 내용

### 1. ⓘ 툴팁 미동작 → click-to-pin 커스텀 툴팁으로 교체

**증상**: 섹션 제목 우측 `ⓘ` 아이콘에 마우스를 올려도 툴팁이 안 뜸 (클릭해도 무반응)

**원인**:
- 기존 구현이 브라우저 native `title` 속성 사용 → 딜레이 길고 다크 배경에서 거의 안 보임
- `overflow: hidden`이 있는 부모 카드에서 `position: absolute` 툴팁이 잘림

**수정** (`frontend/app/admin/page.tsx` — `Info` 컴포넌트):
- `position: fixed` + `getBoundingClientRect()` 기반 커스텀 툴팁으로 교체
- `overflow: hidden` 부모에 관계없이 항상 표시됨
- **호버**: 즉시 미리보기 (마우스 떼면 사라짐)
- **클릭**: 고정 (읽는 동안 유지, 재클릭 또는 "닫기 ×"로 해제)
- 아이콘이 파란색으로 바뀌어 활성화 상태 표시

---

### 2. Cluster Health 뱃지 테두리 색 미표시

**증상**: 헤더의 "Cluster OK/WARN/CRITICAL" 뱃지 테두리가 색 없이 표시됨

**원인**:
```tsx
// ❌ CSS에서 유효하지 않은 색상 형식 (Tailwind 전용)
borderColor: "#10b981/30"

// ✅ 올바른 CSS rgba 형식
borderColor: "rgba(16,185,129,0.3)"
```

**수정** (`frontend/app/admin/page.tsx` — cluster health `style` prop):
- `"#rrggbb/opacity"` → `"rgba(r,g,b,opacity)"` 형식으로 변경 (OK/WARN/CRITICAL 3가지 모두)

---

### 3. Redis 메모리 N/A 표시

**증상**: Pipeline 탭 데이터 레이어의 Redis 메모리가 N/A로 표시

**원인**:
- 백엔드에서 `redis_memory_max_bytes` 메트릭을 쿼리하는데, `oliver006/redis_exporter`는 실제로 `redis_config_maxmemory`로 노출함
- Redis가 `maxmemory 0` (무제한) 설정이면 max 값이 0 → % 계산 불가

**수정**:
- `backend/app/routers/admin.py`: 쿼리 후보에 `redis_config_maxmemory` 추가 (기존 `redis_memory_max_bytes`는 fallback으로 유지)
- `frontend/app/admin/page.tsx`: `memory_pct`가 null이면 `memory_used_gb` (GB 단위)로 폴백 표시

---

### 4. ES JVM Heap N/A + elasticsearch-exporter 설정 개선

**증상**: Pipeline 탭 Elasticsearch JVM Heap이 N/A

**원인**: `elasticsearch-exporter` 파드가 미기동 상태 (ArgoCD 미sync 또는 프로브 타임아웃)

**수정**:
- `k8s-manifests/base/data/elasticsearch-exporter.yaml`:
  - `--es.indices`, `--es.cluster_settings` 인수 제거 (JVM 메트릭에 불필요)
  - `readinessProbe.initialDelaySeconds`: 10 → 30
  - `livenessProbe.initialDelaySeconds`: 20 → 60
  - `timeoutSeconds`: 5 → 10 (ES 응답 대기 여유)
- `frontend/app/admin/page.tsx`: exporter 미배포 시 "exporter 미배포" 텍스트 표시

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/app/admin/page.tsx` | Info 툴팁 컴포넌트 재작성, borderColor CSS 버그 수정, Redis/ES 폴백 표시 |
| `backend/app/routers/admin.py` | redis_config_maxmemory 쿼리 추가 |
| `k8s-manifests/base/data/elasticsearch-exporter.yaml` | args 간소화, probe 딜레이 증가 |
