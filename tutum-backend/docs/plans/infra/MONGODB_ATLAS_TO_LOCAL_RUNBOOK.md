# MongoDB Atlas -> 로컬 MongoDB VM 이관 Runbook

작성일: 2026-02-23
대상 VM: `clouddx-mongodb (192.168.0.231)`

## 1. 목적
- Atlas(`mongodb+srv://...`) 데이터를 로컬 MongoDB VM으로 이관
- 앱/워커가 로컬 MongoDB를 사용하도록 전환

## 2. 현재 기준 상태
- `mongod` 실행 중
- `bindIp: 127.0.0.1,192.168.0.231`
- `authorization: enabled`
- 앱 계정:
  - DB: `clouddx`
  - User: `clouddx_app`
  - Role: `readWrite`

## 3. 사전 점검
1. worker1 -> mongodb 포트 확인
```bash
nc -zv 192.168.0.231 27017
```

2. mongodb 서비스 상태 확인
```bash
systemctl is-active mongod
```

## 4. Atlas -> 로컬 이관 절차
1. 로컬 PC에서 SSH 터널 오픈
```powershell
plink -pw <VM_PASSWORD> -hostkey "<MONGODB_HOSTKEY>" -N -L 27027:127.0.0.1:27017 clouddx@192.168.0.231
```

2. Dry-run
```powershell
python backend/scripts/migrate_mongodb_atlas_to_local.py `
  --source-uri "mongodb+srv://<atlas-user>:<atlas-pass>@<cluster>/?appName=<app>" `
  --target-uri "mongodb://clouddx_app:<APP_DB_PASSWORD>@localhost:27027/clouddx?authSource=clouddx" `
  --source-db clouddx `
  --target-db clouddx `
  --dry-run
```

3. 실제 이관
```powershell
python backend/scripts/migrate_mongodb_atlas_to_local.py `
  --source-uri "mongodb+srv://<atlas-user>:<atlas-pass>@<cluster>/?appName=<app>" `
  --target-uri "mongodb://clouddx_app:<APP_DB_PASSWORD>@localhost:27027/clouddx?authSource=clouddx" `
  --source-db clouddx `
  --target-db clouddx `
  --copy-indexes
```

## 5. 검증
```bash
mongosh "mongodb://clouddx_app:<APP_DB_PASSWORD>@127.0.0.1:27017/clouddx?authSource=clouddx" --quiet --eval "db.news.countDocuments({})"
mongosh "mongodb://clouddx_app:<APP_DB_PASSWORD>@127.0.0.1:27017/clouddx?authSource=clouddx" --quiet --eval "db.users.countDocuments({})"
```

## 6. 애플리케이션 반영
- 로컬/도커 기준:
```env
MONGODB_URL=mongodb://clouddx_app:<APP_DB_PASSWORD>@192.168.0.231:27017/clouddx?authSource=clouddx
MONGODB_DB_NAME=clouddx
```

## 7. 롤백
1. `MONGODB_URL`을 기존 Atlas URI로 복귀
2. backend/workers 재기동
3. 로컬 MongoDB 이관 데이터는 유지(비교 검증 용도)
