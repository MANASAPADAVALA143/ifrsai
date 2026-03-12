# IFRS AI - Start Backend and Frontend (PowerShell)
# Run from project root: .\START_BOTH.ps1

$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = Get-Location | Select-Object -ExpandProperty Path }

$backendCmd = "Set-Location -LiteralPath '$($projectRoot.Replace("'","''"))'; python app.py"
$frontendCmd = "Set-Location -LiteralPath '$($projectRoot.Replace("'","''"))\frontend'; npm run dev"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  IFRS AI - Starting Backend + Frontend" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] Starting Backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

Start-Sleep -Seconds 5

Write-Host "[2/2] Starting Frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host ""
Write-Host "  Backend:  http://localhost:8000" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3003" -ForegroundColor White
Write-Host "  Keep both windows open. Open browser to http://localhost:3003" -ForegroundColor Cyan
Write-Host ""
