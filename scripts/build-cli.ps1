# Build script - Package Precis CLI as a self-contained Windows distributable.
# Output: precis-cli-win.zip (extract and run; bundles python-runtime + backend source).
# Usage: .\scripts\build-cli.ps1
#
# Entry point: precis.bat - invokes bundled python -m app.cli with cwd=backend/.

$ErrorActionPreference = "Stop"

# Resolve repo root (this script lives in scripts/)
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Precis CLI - Windows Packaging" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- 0. Prerequisites ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found (required by fetch-python.js)" -ForegroundColor Red
    exit 1
}

# --- 1. Prepare staging dir ---
Write-Host "`n[1/5] Preparing staging dir..." -ForegroundColor Yellow
$Staging = Join-Path $RepoRoot "backend\dist-win"
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Path $Staging -Force | Out-Null

$PkgRoot = Join-Path $Staging "precis-cli"
New-Item -ItemType Directory -Path $PkgRoot -Force | Out-Null
Write-Host "[OK] Staging: $PkgRoot" -ForegroundColor Green

# --- 2. Fetch python-runtime and install backend deps ---
Write-Host "`n[2/5] Fetching python-runtime..." -ForegroundColor Yellow
$RuntimeDir = Join-Path $PkgRoot "python-runtime"
$ElectronScripts = Join-Path $RepoRoot "electron\scripts"
& node (Join-Path $ElectronScripts "fetch-python.js") --out $RuntimeDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] fetch-python failed" -ForegroundColor Red
    exit 1
}
Write-Host "`n[2.5/5] Installing backend deps into runtime..." -ForegroundColor Yellow
& node (Join-Path $ElectronScripts "install-backend-deps.js") --runtime $RuntimeDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] install-backend-deps failed" -ForegroundColor Red
    exit 1
}

# --- 3. Copy backend source (exclude caches/tests/.git) ---
Write-Host "`n[3/5] Copying backend source..." -ForegroundColor Yellow
$BackendSrc = Join-Path $RepoRoot "backend"
$BackendDst = Join-Path $PkgRoot "backend"
# robocopy /XD and /XF match by NAME at any depth when given a bare name (no path).
$ExcludeDirNames = @("__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", "build", "dist", "tests", ".git", "*.egg-info")
$ExcludeFileNames = @(".coverage", ".gitignore", "*.log")
$robocopyArgs = @($BackendSrc, $BackendDst, "/E", "/NFL", "/NDL", "/NJH", "/NJS",
    "/XD") + $ExcludeDirNames + @("/XF") + $ExcludeFileNames
& robocopy @robocopyArgs
if ($LASTEXITCODE -ge 8) {
    Write-Host "[ERROR] robocopy backend failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Backend source copied" -ForegroundColor Green

# --- 4. Generate entry point precis.bat ---
Write-Host "`n[4/5] Generating entry point precis.bat..." -ForegroundColor Yellow
# NOTE: the .bat content is ASCII-only to avoid codepage issues on user machines.
$BatContent = @'
@echo off
chcp 65001 >nul
setlocal
rem Precis CLI entry - invokes bundled python -m app.cli
rem Layout: this script in precis-cli/, runtime in python-runtime/, source in backend/
set "PKG_ROOT=%~dp0"
set "PYTHON=%PKG_ROOT%python-runtime\python\python.exe"
set "BACKEND_DIR=%PKG_ROOT%backend"
if not exist "%PYTHON%" (
    echo [ERROR] Bundled Python not found: %PYTHON%
    exit /b 1
)
rem cwd=backend/ so Python can import the app package
cd /d "%BACKEND_DIR%"
"%PYTHON%" -B -m app.cli %*
exit /b %ERRORLEVEL%
'@
Set-Content -Path (Join-Path $PkgRoot "precis.bat") -Value $BatContent -Encoding ASCII
Write-Host "[OK] precis.bat generated" -ForegroundColor Green

# --- 5. Zip it up ---
Write-Host "`n[5/5] Packaging zip..." -ForegroundColor Yellow
$Version = "0.1.0"
$ZipName = "precis-cli-win-$Version.zip"
$ZipPath = Join-Path $Staging $ZipName
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $PkgRoot "*") -DestinationPath $ZipPath -CompressionLevel Optimal

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "  Packaging complete" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Artifact: $ZipPath" -ForegroundColor Green
Write-Host "Extract and run: precis.bat <command> (e.g. precis.bat validate --help)" -ForegroundColor Green
