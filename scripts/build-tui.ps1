# Build script - Package Precis TUI (Rust) as a self-contained Windows distributable.
# Output: precis-tui-win.zip (extract and run; bundles python-runtime + backend source).
# Usage: .\scripts\build-tui.ps1

$ErrorActionPreference = "Stop"

# Resolve repo root (this script lives in scripts/)
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Precis TUI - Windows Packaging" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- 0. Prerequisites ---
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust cargo not found. Install from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# --- 1. Build Rust binary (release) ---
Write-Host "`n[1/5] Building Rust binary (release)..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "tui-rust")
& cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] cargo build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
$TuiExe = Join-Path $RepoRoot "tui-rust\target\release\precis-tui.exe"
if (-not (Test-Path $TuiExe)) {
    Write-Host "[ERROR] Build artifact not found: $TuiExe" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Binary: $TuiExe" -ForegroundColor Green

# --- 2. Prepare staging dir ---
Write-Host "`n[2/5] Preparing staging dir..." -ForegroundColor Yellow
$Staging = Join-Path $RepoRoot "tui-rust\dist-win"
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Path $Staging -Force | Out-Null

# Top-level folder precis-tui/
$PkgRoot = Join-Path $Staging "precis-tui"
New-Item -ItemType Directory -Path $PkgRoot -Force | Out-Null

# Copy Rust binary
Copy-Item $TuiExe $PkgRoot
Write-Host "[OK] Staging: $PkgRoot" -ForegroundColor Green

# --- 3. Fetch python-runtime and install backend deps ---
Write-Host "`n[3/5] Fetching python-runtime..." -ForegroundColor Yellow
$RuntimeDir = Join-Path $PkgRoot "python-runtime"
$ElectronScripts = Join-Path $RepoRoot "electron\scripts"
& node (Join-Path $ElectronScripts "fetch-python.js") --out $RuntimeDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] fetch-python failed" -ForegroundColor Red
    exit 1
}
Write-Host "`n[3.5/5] Installing backend deps into runtime..." -ForegroundColor Yellow
& node (Join-Path $ElectronScripts "install-backend-deps.js") --runtime $RuntimeDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] install-backend-deps failed" -ForegroundColor Red
    exit 1
}

# --- 4. Copy backend source (exclude caches/tests/.git) ---
Write-Host "`n[4/5] Copying backend source..." -ForegroundColor Yellow
$BackendSrc = Join-Path $RepoRoot "backend"
$BackendDst = Join-Path $PkgRoot "backend"
# robocopy /XD and /XF match by NAME at any depth when given a bare name (no path).
# Passing full paths only matches that exact path, missing nested dirs like
# backend/app/cli/__pycache__. Use bare names so exclusion is recursive.
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

# --- 5. Zip it up ---
Write-Host "`n[5/5] Packaging zip..." -ForegroundColor Yellow
$Version = "0.1.0"
$ZipName = "precis-tui-win-$Version.zip"
$ZipPath = Join-Path $Staging $ZipName
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $PkgRoot "*") -DestinationPath $ZipPath -CompressionLevel Optimal

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "  Packaging complete" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Artifact: $ZipPath" -ForegroundColor Green
Write-Host "Extract and run precis-tui.exe (auto-spawns bundled backend)" -ForegroundColor Green
