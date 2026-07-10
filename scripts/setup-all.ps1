$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "=== AI Smart Schedule Assistant Setup ===" -ForegroundColor Cyan

function Find-Npm {
    if (Get-Command npm -ErrorAction SilentlyContinue) { return "npm" }
    $paths = @(
        "C:\Program Files\nodejs\npm.cmd",
        "C:\Program Files (x86)\nodejs\npm.cmd"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$npm = Find-Npm
if (-not $npm) {
    Write-Host "[SKIP] Node.js/npm not found. Install from https://nodejs.org then run:" -ForegroundColor Yellow
    Write-Host "       cd dashboard; npm install; npm start"
} else {
    Write-Host "[1/2] Installing dashboard dependencies..." -ForegroundColor Green
    Push-Location (Join-Path $Root "dashboard")
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Pop-Location
    Write-Host "       Done. Start server: cd dashboard; npm start" -ForegroundColor Green
}

$wrapperJar = Join-Path $Root "gradle\wrapper\gradle-wrapper.jar"
if (-not (Test-Path $wrapperJar)) {
    Write-Host "[2/2] Downloading Gradle wrapper jar..." -ForegroundColor Green
    $jarUrl = "https://raw.githubusercontent.com/gradle/gradle/v8.2.0/gradle/wrapper/gradle-wrapper.jar"
    New-Item -ItemType Directory -Force -Path (Split-Path $wrapperJar) | Out-Null
    Invoke-WebRequest -Uri $jarUrl -OutFile $wrapperJar
    Write-Host "       gradle-wrapper.jar saved." -ForegroundColor Green
} else {
    Write-Host "[2/2] Gradle wrapper jar already exists." -ForegroundColor Green
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Cyan
Write-Host "  Server:  cd dashboard; npm start"
Write-Host "  Android: Open project in Android Studio and Rebuild"
Write-Host "  PC IP:   Update Constants.kt and config.js with your LAN IP"
