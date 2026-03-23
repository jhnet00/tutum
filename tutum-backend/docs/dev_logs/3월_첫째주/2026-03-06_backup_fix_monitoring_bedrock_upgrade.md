# Dev Log: MongoDB 백업 CronJob 수정 / CP-1 모니터링 복구 / Bedrock 모델 업그레이드

> 작성일: 2026-03-06
> 작성자: kyungyoonkim
> 브랜치: `develop`
> 커밋: `adc4a35`, `e1dc855`, `a49a11b`

---

## 작업 개요

1. MongoDB 백업 CronJob 실패 원인 파악 및 수정
2. 어드민 모니터링 페이지 CP-1 디스크 지표 누락 원인 파악 및 복구 (UFW)
3. KPI 카드 타임스탬프 표시 추가
4. AWS Bedrock 모델 Claude Sonnet 4.5 (Global)로 업그레이드

---

## 1. MongoDB 백업 CronJob 수정

### 증상
`mongodb-backup` CronJob에서 수동 테스트 Job 실행 시 `Error` 상태로 종료.

```
[Fri Mar  6 07:52:21 UTC 2026] mongodump 완료
/bin/bash: line 18: wget: command not found
```

### 원인
기존 코드가 런타임에 `wget`으로 MinIO Client(mc) 바이너리를 외부에서 다운로드하는 구조였으나:

1. `mongo:7.0` (Ubuntu Jammy 기반) 이미지에 `wget`, `curl` 모두 미포함
2. `apt-get install wget`을 `2>/dev/null || true`로 실행해 실패를 무시
3. 클러스터 노드(192.168.0.x private 망)에서 외부 인터넷 접근 불가

```yaml
# ❌ 기존 - 런타임 인터넷 다운로드
apt-get install -y --no-install-recommends wget -qq 2>/dev/null || true
wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /usr/local/bin/mc
```

### 수정
`initContainer`에 `minio/mc` 이미지를 사용해 mc 바이너리를 `emptyDir` 볼륨에 복사 후, main container에서 해당 볼륨을 마운트해 사용하는 방식으로 변경.

```yaml
# ✅ 수정 후 - initContainer로 바이너리 사전 복사
initContainers:
  - name: get-mc
    image: minio/mc:latest
    command: ['sh', '-c', 'cp /usr/bin/mc /shared/mc && chmod +x /shared/mc']
    volumeMounts:
      - name: shared-bin
        mountPath: /shared
volumes:
  - name: shared-bin
    emptyDir: {}
containers:
  - name: mongodb-backup
    ...
    volumeMounts:
      - name: shared-bin
        mountPath: /shared
```

스크립트 내 `mc` 명령도 `MC=/shared/mc && $MC ...` 형태로 변경.

### 테스트 결과

```
[Fri Mar  6 07:54:29 UTC 2026] MongoDB 백업 시작: 2026-03-06
...
done dumping clouddx.news (10053 documents)
[Fri Mar  6 07:54:33 UTC 2026] mongodump 완료
Added `minio` successfully.
Bucket created successfully `minio/tutum-backups`.
Total: 10.20 MiB | Transferred: 10.20 MiB | Speed: 11.35 MiB/s
[Fri Mar  6 07:54:35 UTC 2026] MongoDB 백업 완료
```

Pod Status: `Completed` ✓

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `k8s-manifests/base/backup/mongodb-backup.yaml` | initContainer 추가, main container volumeMount 추가, mc 명령 경로 변경 |

---

## 2. CP-1 디스크 지표 누락 복구 (node-exporter 스크랩 불가)

### 증상
어드민 페이지 Data 탭 "디스크 사용량 — 노드별 상세"에서 cp-1이 누락됨.
cp-2, cp-3, worker1, worker2, worker3는 정상 표시.

### 원인 파악

```bash
# Mimir에서 disk 메트릭 조회 결과 → cp-1(192.168.0.220) 없음
instance: 192.168.0.221:9100  # cp-2 ✓
instance: 192.168.0.222:9100  # cp-3 ✓
instance: 192.168.0.223:9100  # worker1 ✓
instance: 192.168.0.224:9100  # worker2 ✓
instance: 192.168.0.225:9100  # worker3 ✓
# 192.168.0.220 (cp-1) 없음 ✗
```

node-exporter Pod는 cp-1에서 Running 상태였으나, **cp-1 UFW에 9100 포트 허용 규칙이 없어** Alloy가 스크랩 불가한 상태였음.

```bash
# cp-1 UFW 상태 확인 → 9100 없음
sudo ufw status numbered
# 22, 6443, 2379~2380, 10250, 10259, 10257, 179, 4789, 7946 ... 9100 없음
```

cp-1이 SSH 게이트웨이 역할을 하며 다른 노드 대비 UFW 규칙이 보수적으로 설정되어 있었음. 다른 노드들은 `9100` 포트가 열려 있거나 UFW 비활성화 상태였음.

### 수정

```bash
sudo ufw allow from 192.168.0.0/24 to any port 9100 proto tcp comment "node-exporter"
sudo ufw allow from 10.244.0.0/16 to any port 9100 proto tcp comment "node-exporter pod cidr"
sudo ufw reload
```

- `192.168.0.0/24`: 클러스터 노드 간 직접 접근
- `10.244.0.0/16`: Calico Pod CIDR (Alloy Pod → hostNetwork node-exporter)

### 검증

```bash
# Mimir 재쿼리 → cp-1 정상 수집 확인
instance: 192.168.0.220:9100  # cp-1 ✓ (추가됨)
```

어드민 페이지 새로고침 후 cp-1 디스크 정보 정상 표시 확인.

---

## 3. KPI 카드 타임스탬프 표시 추가

### 배경
Overview 탭 상단 KPI 카드(RPS / P95 Latency / Error Rate / Kafka Lag)에 데이터 기준 시각이 없어 언제 수집된 지표인지 알 수 없었음.

### 수정 (`frontend/app/admin/page.tsx`)

- `metricsUpdatedAt` state 추가
- `fetchMetrics` finally 블록에서 `new Date().toLocaleTimeString("ko-KR")` 기록
- KPI 카드 grid 하단에 "기준 HH:MM:SS · 30초 자동갱신" 텍스트 표시

```tsx
{metricsUpdatedAt && (
  <p className="text-xs text-white/30 text-right -mt-4">
    기준 {metricsUpdatedAt} · 30초 자동갱신
  </p>
)}
```

---

## 4. AWS Bedrock 모델 업그레이드

### 변경 내용

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| 모델 | `anthropic.claude-3-5-sonnet-20240620-v1:0` | `global.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| Input 가격 | $6.00 / 1M tokens | $3.00 / 1M tokens |
| Output 가격 | $30.00 / 1M tokens | $15.00 / 1M tokens |
| 비용 절감 | - | **50%** |

### 배경
- Claude Sonnet 4.5 (Global)은 ap-northeast-2에서 Global 인퍼런스 프로파일로 사용 가능
- 성능은 3.5 Sonnet v1 대비 향상, 가격은 50% 절감
- 어드민 페이지 AI 진단 기능(인프라 분석, 파이프라인 분석 등) 전체에 적용

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/config.py` | `BEDROCK_MODEL_ID` 값 교체 |

> **주의**: K8s Secret에 `BEDROCK_MODEL_ID` 환경변수가 별도 설정된 경우 Secret도 함께 업데이트 필요.

---

## 기타 확인 사항

- **price-consumer**: 이전에 CrashLoopBackOff로 기록되어 있었으나, Kafka/Redis가 이미 tutum-data에 배포 완료된 상태. 현재 BTC/ETH/XRP 실시간 캐싱 정상 동작 확인.
- **Data/Backup 탭 영어 표기**: 기존에 이미 적용되어 있음 확인 (`label: "Data"`, `label: "Backup"`).
- **P95 100ms 임계선 / Kafka Lag 툴팁**: 커밋 `a07cc82`에서 이미 적용 완료, 현재 배포 이미지(`5d704ecf`)에 포함되어 있음 확인.
