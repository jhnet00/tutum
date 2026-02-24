$conns = Get-NetTCPConnection -LocalPort 8002 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
Set-Location "c:\Users\CloudDX\Documents\GitHub\clouddx-project\backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
