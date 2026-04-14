# Stops whatever is listening on TCP port 9000 (run as Administrator if access denied).
# Usage: .\FREE_PORT_9000.ps1   or   .\FREE_PORT_9000.ps1 -Port 9001

param([int]$Port = 9000)

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Write-Host "Nothing listening on port $Port." -ForegroundColor Green
    exit 0
}
$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pid in $pids) {
    try {
        $p = Get-Process -Id $pid -ErrorAction Stop
        Write-Host "Stopping PID $pid ($($p.ProcessName)) on port $Port..." -ForegroundColor Yellow
        Stop-Process -Id $pid -Force -ErrorAction Stop
    } catch {
        Write-Host "Could not stop PID $pid : $_" -ForegroundColor Red
    }
}
Write-Host "Done." -ForegroundColor Green
