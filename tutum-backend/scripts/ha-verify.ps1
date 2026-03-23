param(
  [switch]$SkipInternalChecks
)

<#
.SYNOPSIS
  5대 분산 HA 토폴로지의 접속/클러스터 기본 가용성 점검 스크립트.
.DESCRIPTION
  - NAT/SSH 접근 포트 (공유 SSH 포트) 점검
  - Host-Only 내부 IP ping 점검
  - kubectl 클러스터 핵심 리소스 상태 점검
.EXAMPLE
  .\ha-verify.ps1
  .\ha-verify.ps1 -SkipInternalChecks
.PARAMETER SkipInternalChecks
  내부 ping/kubectl 점검을 건너뛰고 NAT/SSH 포트만 빠르게 확인할 때 사용
.NOTES
  사용 이유: 5대 분산 구성을 운영하는 모든 단계에서 네트워크/방화벽/통신 상태를
  빠르게 한 번에 점검하기 위함.
#>
$ErrorActionPreference = "Continue"

$targets = @{
  "192.168.0.28" = @(2220, 2230)
  "192.168.0.13" = @(2221)
  "192.168.0.98" = @(2222)
  "192.168.0.3"  = @(2223, 2224)
  "192.168.0.14" = @(2225, 2226)
}

$portsOk = 0
$portsFail = 0

Write-Host "=== [1] NAT/SSH Connectivity Check ==="
foreach ($entry in $targets.GetEnumerator()) {
  $ip = $entry.Key
  foreach ($port in $entry.Value) {
    $ok = Test-NetConnection -ComputerName $ip -Port $port -InformationLevel Quiet
    if ($ok) {
      Write-Host "OPEN  $ip :$port"
      $portsOk++
    } else {
      Write-Host "CLOSED $ip :$port"
      $portsFail++
    }
  }
}

if ($portsFail -gt 0) {
  Write-Host "[WARN] External connect check failed. Please verify firewall, NAT forward rules, or host network settings."
}

if (-not $SkipInternalChecks) {
  Write-Host ""
  Write-Host "=== [2] Host-Only Internal Ping Check ==="
  $internalIps = @(
    "192.168.56.20",
    "192.168.56.21",
    "192.168.56.22",
    "192.168.56.23",
    "192.168.56.24",
    "192.168.56.25",
    "192.168.56.30",
    "192.168.56.31"
  )
  foreach ($ip in $internalIps) {
    $ping = ping -n 1 $ip | Select-String -Pattern "TTL="
    if ($ping) {
      Write-Host "OK $ip"
    } else {
      Write-Host "FAIL $ip"
    }
  }

  Write-Host ""
  Write-Host "=== [3] Kubernetes Health Check (kubectl required) ==="
  & kubectl get nodes -o wide
  & kubectl get ns tutum-app tutum-data tutum-storage monitoring istio-system argocd kyverno
  & kubectl get pods -n metallb-system --no-headers -o wide
  & kubectl get pods -n istio-system --no-headers -o wide
  & kubectl get svc -n istio-system istio-ingressgateway
}

Write-Host ""
Write-Host "=== Summary ==="
Write-Host "SSH/NAT ports: OPEN=$portsOk, CLOSED=$portsFail"

if ($portsFail -eq 0) {
  Write-Host "[OK] 5-node distributed HA topology access checks passed."
  exit 0
}
Write-Host "[WARN] Some ports are not reachable. Please verify before production use."
exit 1
