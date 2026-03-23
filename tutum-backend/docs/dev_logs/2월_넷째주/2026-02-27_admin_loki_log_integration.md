# 개발 로그: Admin 대시보드 Loki 로그 연동 (2026-02-27)

## 1. 작업 요약
- 작업 일시: 2026-02-27
- 브랜치: `develop` (직접 커밋)
- 작업 목적: Admin Logs 탭 Mock 시뮬레이션 → 실제 Loki 로그 스트림 연동

---

## 2. 배경

전 작업(`feat/admin-realdata`)에서 nodes/pods/metrics는 실데이터로 교체 완료했지만,
Logs 탭은 Mock 시뮬레이션(3초마다 랜덤 로그 생성)을 유지하고 있었음.

**Loki 서버**: `http://192.168.0.230:3100` (LGTM stack, 정상 운영 중)
- job 레이블: `loki.source.kubernetes.k8s_logs`
- instance 형식: `tutum-app/backend-xxx:backend`

---

## 3. 변경 사항

### 3-1. Backend - `/logs` 엔드포인트 추가

**파일**: `backend/app/routers/admin.py`

```
LOKI_URL = os.getenv("LOKI_URL", "http://192.168.0.230:3100")

GET /api/v1/admin/logs?namespace=tutum-app&limit=50
  - Loki query_range: {job="loki.source.kubernetes.k8s_logs", instance=~"namespace/.*"}
  - window: 최근 10분 (600초)
  - direction: backward (최신 우선)
  - instance 파싱: "tutum-app/backend-xxx:backend" → namespace="tutum-app", pod="backend-xxx"
  - level 정규화: loki level 레이블 → INFO/WARN/ERROR/DEBUG
  - 중복 제거: (timestamp, pod, msg[:50]) 기준
```

**응답 스키마:**
```json
{
  "logs": [
    {
      "time": "14:32:11",
      "timestamp": 1234567890000000000,
      "level": "INFO",
      "namespace": "tutum-app",
      "pod": "backend-xxx-yyy",
      "msg": "GET /api/v1/market/prices 200 OK"
    }
  ]
}
```

또한 MIMIR_URL을 잘못된 IP(`192.168.56.30`)에서 실제 IP(`192.168.0.230`)로 수정.

### 3-2. Frontend - Logs 탭 실데이터 연동

**파일**: `frontend/app/admin/page.tsx`

| 이전 | 이후 |
|------|------|
| `MOCK_LOGS` 상수 + 3초 랜덤 시뮬레이션 | `GET /api/v1/admin/logs` fetch |
| 네임스페이스 필터 없음 | tutum-app / tutum-data / all 탭 버튼 |
| 로딩 상태 없음 | 로딩 중 / 로그 없음(최근 10분) 표시 |
| pod 컬럼만 | namespace + pod 컬럼 모두 표시 |

**주요 변경 코드:**
```typescript
// 기존: MOCK 시뮬레이션
const [logs, setLogs] = useState(MOCK_LOGS);
setInterval(() => { setLogs(prev => [randomLog, ...prev.slice(0, 49)]) }, 3000)

// 변경: Loki 10초 폴링
const [logs, setLogs] = useState<LogEntry[]>([]);
const [loadingLogs, setLoadingLogs] = useState(true);
const [logNamespace, setLogNamespace] = useState("tutum-app");

const fetchLogs = async (ns: string) => {
  const res = await fetch(`${API_BASE}/api/v1/admin/logs?namespace=${ns}&limit=50`);
  if (res.ok) { const d = await res.json(); setLogs(d.logs ?? []); }
};

useEffect(() => {
  fetchLogs(logNamespace);
  const interval = setInterval(() => fetchLogs(logNamespace), 10000);
  return () => clearInterval(interval);
}, [logNamespace]);
```

---

## 4. 결과

| 항목 | 결과 |
|------|------|
| Loki `/logs` 엔드포인트 | ✅ 구현 완료 |
| MIMIR_URL IP 수정 (`56.30` → `0.230`) | ✅ |
| Frontend Logs 탭 실데이터 연동 | ✅ |
| 네임스페이스 필터 (tutum-app / tutum-data / all) | ✅ |
| 로딩/빈 상태 처리 | ✅ |
| 10초 폴링 (namespace 변경 시 즉시 갱신) | ✅ |

---

## 5. 후속 작업 / 리스크

- **level 파싱**: Loki에서 `level` 레이블이 없는 파드는 INFO로 폴백.
  JSON 로그 파싱(msg 내 level 추출)은 추후 개선 가능
- **Loki 연결 실패**: backend 파드 → 192.168.0.230:3100 방화벽 확인 필요.
  실패 시 `{"logs": []}` 폴백으로 빈 화면 표시 (에러 처리 완료)
- **로그 볼륨**: 10분 window에 50개 제한. 볼륨이 많으면 limit 증가 또는 window 축소 조정 가능
