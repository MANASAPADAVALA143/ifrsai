# IFRS AI - Start Backend and Frontend (PowerShell)
# Run from project root: .\START_BOTH.ps1

$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = Get-Location | Select-Object -ExpandProperty Path }

$backendCmd = "Set-Location -LiteralPath '$($projectRoot.Replace("'","''"))'; python app.py"
$frontendCmd = "Set-Location -LiteralPath '$($projectRoot.Replace("'","''"))\frontend'; npm run dev"

$envLocal = Join-Path $projectRoot "frontend\.env.local"
if (-not (Test-Path -LiteralPath $envLocal)) {
  @"
# Local dev: leave empty so the browser uses same-origin /api proxy to Python
NEXT_PUBLIC_API_URL=
"@ | Set-Content -LiteralPath $envLocal -Encoding utf8
  Write-Host "Created frontend\.env.local (empty NEXT_PUBLIC_API_URL = dev proxy)." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  IFRS AI - Starting Backend + Frontend" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] Starting Backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

Start-Sleep -Seconds 6

# Backend may write api_dev_port.txt if 9000 was busy (Next reads it on dev server start)
$portFile = Join-Path $projectRoot "api_dev_port.txt"
$apiPort = "9000"
if (Test-Path -LiteralPath $portFile) {
  try { $apiPort = (Get-Content -LiteralPath $portFile -Raw).Trim() } catch { }
}

Write-Host "[2/2] Starting Frontend..." -ForegroundColor Yellow
Write-Host "  If Next.js fails with EADDRINUSE on 3004, run: .\FREE_PORT_3004.ps1 then start the frontend again." -ForegroundColor DarkGray
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host "Waiting for Next.js (10s) then opening browser..." -ForegroundColor DarkGray
Start-Sleep -Seconds 10
try { Start-Process "http://localhost:3004" } catch { }

Write-Host ""
Write-Host "  Backend:  http://127.0.0.1:$apiPort (see backend window if port differs)" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3004" -ForegroundColor White
Write-Host "  API Docs: http://127.0.0.1:$apiPort/api/docs" -ForegroundColor Gray
Write-Host "  The frontend proxies /api to the backend and reads api_dev_port.txt each request (no npm restart if port changes)." -ForegroundColor DarkGray
Write-Host "  Keep both windows open. If the API badge stays red, wait for python to finish starting." -ForegroundColor Cyan
Write-Host ""
