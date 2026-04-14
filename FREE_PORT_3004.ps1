# Stops whatever is listening on TCP port 3004 (Next.js default in this repo).
# Uses netstat (fast); avoids Get-NetTCPConnection which can hang on some PCs.
# Run as Administrator if you get "access denied".
# Usage: .\FREE_PORT_3004.ps1   or   .\FREE_PORT_3004.ps1 -Port 3005

param([int]$Port = 3004)

$netstatExe = Join-Path $env:SystemRoot "System32\netstat.exe"
if (-not (Test-Path -LiteralPath $netstatExe)) {
    Write-Host "Could not find netstat.exe." -ForegroundColor Red
    exit 1
}

$pids = [System.Collections.Generic.HashSet[int]]::new()
foreach ($line in & $netstatExe -ano -p tcp) {
    if ($line -notmatch "LISTENING") { continue }
    if ($line -notmatch ":$Port\s+") { continue }
    if ($line -match "LISTENING\s+(\d+)\s*$") {
        [void]$pids.Add([int]$Matches[1])
    }
}

if ($pids.Count -eq 0) {
    Write-Host "Nothing listening on port $Port." -ForegroundColor Green
    exit 0
}

foreach ($procId in $pids) {
    try {
        $p = Get-Process -Id $procId -ErrorAction Stop
        Write-Host "Stopping PID $procId ($($p.ProcessName)) on port $Port..." -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
        Write-Host "Could not stop PID $procId : $_" -ForegroundColor Red
    }
}
Write-Host "Done." -ForegroundColor Green
