# PC 서버 + ngrok 고정 도메인 (URL이 바뀌지 않음)
# 사전 준비:
#   1) https://ngrok.com 가입
#   2) Domains 메뉴에서 무료 Static Domain 생성 (예: my-app.ngrok-free.app)
#   3) stable-domain.txt 에 도메인 입력
#   4) ngrok-authtoken.txt 에 authtoken 입력

$ErrorActionPreference = "Stop"
$DashboardDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Node = "C:\Program Files\nodejs\node.exe"
$Npx = "C:\Program Files\nodejs\npx.cmd"

function Resolve-NgrokExecutable {
    $candidates = @(
        (Get-Command ngrok -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return $null
}

Set-Location $DashboardDir

$domainFile = Join-Path $DashboardDir "stable-domain.txt"
$tokenFile = Join-Path $DashboardDir "ngrok-authtoken.txt"

if (-not (Test-Path $domainFile)) {
    Write-Host "stable-domain.txt 파일이 없습니다." -ForegroundColor Red
    exit 1
}

$domainLines = Get-Content $domainFile -ErrorAction Stop -Encoding UTF8
$domain = ($domainLines | Where-Object { $_ -and $_ -notmatch '^\s*#' -and $_.Trim() -ne '' -and $_ -notmatch 'REPLACE' } | Select-Object -First 1)
if (-not $domain) {
    Write-Host "stable-domain.txt 에 유효한 ngrok 도메인이 없습니다." -ForegroundColor Red
    exit 1
}
$domain = $domain.Trim()

$authtoken = $null
if (Test-Path $tokenFile) {
    $authtoken = (Get-Content $tokenFile -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() -ne '' } | Select-Object -First 1).Trim()
}
if ($authtoken -and $authtoken -notmatch 'REPLACE') {
    $ngrokExe = Resolve-NgrokExecutable
    try {
        if ($ngrokExe) {
            & $ngrokExe config add-authtoken $authtoken 2>&1 | Out-Null
        } else {
            & $Npx --yes ngrok config add-authtoken $authtoken 2>&1 | Out-Null
        }
    } catch {
        Write-Host "ngrok authtoken 설정 경고 (계속 진행): $($_.Exception.Message)"
    }
}

Get-Process -Name ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$existing = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "[1/2] Dashboard server starting on port 3000..."
Start-Process -FilePath $Node -ArgumentList "server.js" -WorkingDirectory $DashboardDir -WindowStyle Minimized
Start-Sleep -Seconds 2

Write-Host "[2/2] ngrok stable tunnel starting..."
$tunnelLog = Join-Path $DashboardDir ".ngrok.log"
Remove-Item $tunnelLog -Force -ErrorAction SilentlyContinue
Remove-Item "$tunnelLog.err" -Force -ErrorAction SilentlyContinue

$ngrokExe = Resolve-NgrokExecutable
if ($ngrokExe) {
    Write-Host "  ngrok: $ngrokExe"
    Start-Process -FilePath $ngrokExe -ArgumentList @("http", "3000", "--url=$domain", "--log=stdout") `
        -WorkingDirectory $DashboardDir -RedirectStandardOutput $tunnelLog -RedirectStandardError "$tunnelLog.err" -WindowStyle Minimized
} else {
    Write-Host "  ngrok: npx fallback"
    Start-Process -FilePath $Npx -ArgumentList @("--yes", "ngrok", "http", "3000", "--url=$domain") `
        -WorkingDirectory $DashboardDir -RedirectStandardOutput $tunnelLog -RedirectStandardError "$tunnelLog.err" -WindowStyle Minimized
}

Start-Sleep -Seconds 6

$publicUrl = "https://$domain/"
Set-Content -Path (Join-Path $DashboardDir "public-url.txt") -Value $publicUrl -Encoding UTF8
Set-Content -Path (Join-Path $DashboardDir "stable-url.txt") -Value $publicUrl -Encoding UTF8

$healthOk = $false
$healthUrl = "https://$domain/api/health"
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try {
        $healthResponse = Invoke-WebRequest -Uri $healthUrl -Headers @{ "ngrok-skip-browser-warning" = "true" } -UseBasicParsing -TimeoutSec 5
        if ($healthResponse.StatusCode -eq 200 -and $healthResponse.Content -match '"status"\s*:\s*"ok"') {
            $healthOk = $true
            break
        }
    } catch {
        # ngrok may still be starting
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  고정 URL (변경 없음): $publicUrl"
Write-Host "  대시보드:           https://$domain"
Write-Host "  로컬:               http://localhost:3000"
if ($healthOk) {
    Write-Host "  헬스체크:           OK ($healthUrl)" -ForegroundColor Green
} else {
    Write-Host "  헬스체크:           실패 — ngrok 로그 확인: $tunnelLog" -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "앱 설정 > 노트북 서버 주소에 위 URL을 한 번만 입력하세요."
Write-Host "이후 URL이 바뀌지 않으므로 APK 재설치가 필요 없습니다."
