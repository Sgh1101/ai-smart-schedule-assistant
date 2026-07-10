# PC 서버 + 외부 접속 터널(localtunnel) 실행
# 다른 Wi-Fi / LTE 폰에서도 접속 가능한 URL을 출력합니다.

$ErrorActionPreference = "Stop"
$DashboardDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Node = "C:\Program Files\nodejs\node.exe"
$Npx = "C:\Program Files\nodejs\npx.cmd"

Set-Location $DashboardDir

# 기존 3000 포트 사용 프로세스 종료
$existing = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "[1/2] Dashboard server starting on port 3000..."
Start-Process -FilePath $Node -ArgumentList "server.js" -WorkingDirectory $DashboardDir -WindowStyle Minimized
Start-Sleep -Seconds 2

Write-Host "[2/2] Public tunnel starting (localtunnel)..."
$tunnelLog = Join-Path $DashboardDir ".tunnel.log"
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

Start-Process -FilePath $Npx -ArgumentList @("--yes", "localtunnel", "--port", "3000") `
    -WorkingDirectory $DashboardDir -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelLog -WindowStyle Minimized

$publicUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $tunnelLog) {
        $line = Get-Content $tunnelLog -ErrorAction SilentlyContinue | Where-Object { $_ -match 'https://.*\.loca\.lt' } | Select-Object -First 1
        if ($line -match '(https://[^\s]+\.loca\.lt)') {
            $publicUrl = $Matches[1]
            break
        }
    }
}

if (-not $publicUrl) {
    Write-Host "터널 URL을 가져오지 못했습니다. $tunnelLog 를 확인하세요."
    exit 1
}

$publicUrlWithSlash = "$publicUrl/"
$ltUrlFile = Join-Path $DashboardDir "public-url-lt.txt"
Set-Content -Path $ltUrlFile -Value $publicUrlWithSlash -Encoding UTF8

$stableUrlFile = Join-Path $DashboardDir "stable-url.txt"
if (Test-Path $stableUrlFile) {
    $stableUrl = (Get-Content $stableUrlFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($stableUrl) {
        Set-Content -Path (Join-Path $DashboardDir "public-url.txt") -Value $stableUrl -Encoding UTF8
    }
} else {
    Set-Content -Path (Join-Path $DashboardDir "public-url.txt") -Value $publicUrlWithSlash -Encoding UTF8
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  주의: loca.lt URL은 PC 재시작 시 바뀝니다."
Write-Host "  고정 URL이 필요하면 start-stable.bat (ngrok) 사용"
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  외부 접속 URL: $publicUrlWithSlash"
Write-Host "  대시보드:      $publicUrl"
Write-Host "  로컬:          http://localhost:3000"
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Android 앱 설정 > 노트북 서버 주소에 URL 입력 (APK 재설치 불필요)"
Write-Host "loca.lt URL은 임시입니다. 만료 시 public-url-lt.txt 를 확인하세요."
Write-Host "고정 URL이 필요하면 dashboard\start-stable.bat (ngrok) 사용"
