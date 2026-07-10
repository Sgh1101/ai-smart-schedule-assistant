# render-url.txt → app Constants.kt 기본 서버 주소 반영
$ErrorActionPreference = "Stop"
$DashboardDir = Split-Path $PSScriptRoot -Parent
$RepoRoot = Split-Path $DashboardDir -Parent
$urlFile = Join-Path $DashboardDir "render-url.txt"
$constantsFile = Join-Path $RepoRoot "app\src\main\java\com\aischedule\assistant\Constants.kt"

if (-not (Test-Path $urlFile)) {
    Write-Host "render-url.txt 가 없습니다." -ForegroundColor Red
    exit 1
}

$url = (Get-Content $urlFile -Encoding UTF8 |
    Where-Object { $_ -and $_ -notmatch '^\s*#' -and $_.Trim() -ne '' } |
    Select-Object -First 1).Trim()

if ($url -notmatch '^https?://') {
    Write-Host "유효한 URL이 없습니다: $url" -ForegroundColor Red
    exit 1
}
if (-not $url.EndsWith('/')) { $url += '/' }

$content = Get-Content $constantsFile -Raw -Encoding UTF8
$newContent = $content -replace 'const val DEFAULT_CLOUD_SYNC_BASE_URL = "[^"]*"', "const val DEFAULT_CLOUD_SYNC_BASE_URL = `"$url`""
if ($newContent -eq $content) {
    Write-Host "Constants.kt 에서 DEFAULT_CLOUD_SYNC_BASE_URL 을 찾지 못했습니다." -ForegroundColor Red
    exit 1
}

Set-Content -Path $constantsFile -Value $newContent -Encoding UTF8 -NoNewline
Write-Host "앱 기본 URL 반영 완료: $url" -ForegroundColor Green
