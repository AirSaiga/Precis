# ============================================================================
# Precis - Cache Cleanup Script
# ============================================================================
# Usage:
#   .\scripts\windows\clean-cache.ps1           # Safe clean
#   .\scripts\windows\clean-cache.ps1 -DryRun   # Preview only
#   .\scripts\windows\clean-cache.ps1 -RemoveNodeModules
#   .\scripts\windows\clean-cache.ps1 -RemoveVenv
#   .\scripts\windows\clean-cache.ps1 -All      # Everything
# ============================================================================

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$DryRun,
    [switch]$RemoveNodeModules,
    [switch]$RemoveVenv,
    [switch]$All
)

if ($All) {
    $RemoveNodeModules = $true
    $RemoveVenv = $true
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
Set-Location $ProjectRoot

$script:TotalFilesRemoved = 0
$script:TotalDirsRemoved = 0
$script:TotalBytesFreed = 0

function Measure-TreeSize($Path) {
    $items = Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    $fileCount = ($items | Where-Object { -not $_.PSIsContainer } | Measure-Object).Count
    $byteCount = ($items | Measure-Object -Property Length -Sum).Sum
    return @{ Files = $fileCount; Bytes = $byteCount }
}

function Remove-Target($Path, $Description) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $fullPath = Resolve-Path $Path
    $relPath = $fullPath.Path.Substring($ProjectRoot.Path.Length + 1)
    $sizeInfo = Measure-TreeSize $fullPath

    if ($DryRun) {
        Write-Host "[Preview] Will delete $Description`: $relPath ($($sizeInfo.Files) files, $([math]::Round($sizeInfo.Bytes / 1MB, 2)) MB)" -ForegroundColor Yellow
    }
    else {
        if ($PSCmdlet.ShouldProcess($relPath, "Delete $Description")) {
            Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[Deleted] $Description`: $relPath ($($sizeInfo.Files) files, $([math]::Round($sizeInfo.Bytes / 1MB, 2)) MB)" -ForegroundColor Green
            $script:TotalFilesRemoved += $sizeInfo.Files
            $script:TotalDirsRemoved += 1
            $script:TotalBytesFreed += $sizeInfo.Bytes
        }
    }
}

$targets = @()

# Python caches (recursive)
$targets += @{ Path = "__pycache__"; Type = "Dir"; Desc = "Python cache"; Recurse = $true }
$targets += @{ Path = "*.py[cod]"; Type = "File"; Desc = "Python compiled"; Recurse = $true }
$targets += @{ Path = '*$py.class'; Type = 'File'; Desc = 'Python class file'; Recurse = $true }

# Python tool caches
$targets += @{ Path = ".mypy_cache"; Type = "Dir"; Desc = "Mypy cache"; Recurse = $true }
$targets += @{ Path = ".pytest_cache"; Type = "Dir"; Desc = "Pytest cache"; Recurse = $true }
$targets += @{ Path = ".ruff_cache"; Type = "Dir"; Desc = "Ruff cache"; Recurse = $true }
$targets += @{ Path = "htmlcov"; Type = "Dir"; Desc = "Coverage HTML"; Recurse = $true }
$targets += @{ Path = ".coverage"; Type = "File"; Desc = "Coverage data"; Recurse = $true }
$targets += @{ Path = "coverage_report.txt"; Type = "File"; Desc = "Coverage report"; Recurse = $true }

# Frontend build artifacts
$targets += @{ Path = "frontend/dist"; Type = "Dir"; Desc = "Frontend dist"; Recurse = $false }
$targets += @{ Path = "frontend/.vite"; Type = "Dir"; Desc = "Vite cache"; Recurse = $false }
$targets += @{ Path = "frontend/coverage"; Type = "Dir"; Desc = "Frontend coverage"; Recurse = $false }
$targets += @{ Path = "frontend/*.tsbuildinfo"; Type = "File"; Desc = "TS build info"; Recurse = $false }

# Electron build artifacts
$targets += @{ Path = "electron/dist"; Type = "Dir"; Desc = "Electron dist"; Recurse = $false }
$targets += @{ Path = "electron/out"; Type = "Dir"; Desc = "Electron out"; Recurse = $false }
$targets += @{ Path = "electron/out-make"; Type = "Dir"; Desc = "Electron forge out"; Recurse = $false }
$targets += @{ Path = "electron/release"; Type = "Dir"; Desc = "Electron release"; Recurse = $false }
$targets += @{ Path = "electron/.precis"; Type = "Dir"; Desc = "Electron local config"; Recurse = $false }
$targets += @{ Path = "electron/local-updates"; Type = "Dir"; Desc = "Electron local updates"; Recurse = $false }

# Backend build artifacts
$targets += @{ Path = "backend/build"; Type = "Dir"; Desc = "Backend build"; Recurse = $false }
$targets += @{ Path = "backend/dist"; Type = "Dir"; Desc = "Backend dist"; Recurse = $false }
$targets += @{ Path = "backend/*.egg-info"; Type = "Dir"; Desc = "Egg info"; Recurse = $false }
$targets += @{ Path = "backend/*.egg"; Type = "File"; Desc = "Egg file"; Recurse = $false }

# Optional: Node Modules
if ($RemoveNodeModules) {
    $targets += @{ Path = "node_modules"; Type = "Dir"; Desc = "Root node_modules"; Recurse = $false }
    $targets += @{ Path = "frontend/node_modules"; Type = "Dir"; Desc = "Frontend node_modules"; Recurse = $false }
    $targets += @{ Path = "electron/node_modules"; Type = "Dir"; Desc = "Electron node_modules"; Recurse = $false }
}

# Optional: Virtual environments
if ($RemoveVenv) {
    $targets += @{ Path = ".venv"; Type = "Dir"; Desc = "Root venv"; Recurse = $false }
    $targets += @{ Path = "backend/.venv"; Type = "Dir"; Desc = "Backend venv"; Recurse = $false }
    $targets += @{ Path = "backend/venv"; Type = "Dir"; Desc = "Backend old venv"; Recurse = $false }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Precis - Cache Cleanup Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

if ($DryRun) {
    Write-Host "Mode: Preview (no files will be deleted)" -ForegroundColor Magenta
}
else {
    Write-Host "Mode: Clean" -ForegroundColor Magenta
}

if (-not $RemoveNodeModules -and -not $All) {
    Write-Host "Tip: node_modules are preserved by default. Add -RemoveNodeModules to delete them." -ForegroundColor DarkGray
}
if (-not $RemoveVenv -and -not $All) {
    Write-Host "Tip: Virtual environments are preserved by default. Add -RemoveVenv to delete them." -ForegroundColor DarkGray
}
Write-Host ""

foreach ($t in $targets) {
    if ($t.Recurse -and $t.Type -eq "Dir") {
        Get-ChildItem -Path $ProjectRoot -Recurse -Directory -Force |
            Where-Object { $_.Name -eq $t.Path } |
            ForEach-Object { Remove-Target $_.FullName $t.Desc }
    }
    elseif ($t.Recurse -and $t.Type -eq "File") {
        Get-ChildItem -Path $ProjectRoot -Recurse -File -Force -Filter $t.Path -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Target $_.FullName $t.Desc }
    }
    else {
        Remove-Target (Join-Path $ProjectRoot $t.Path) $t.Desc
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  Preview complete. Items above would be deleted." -ForegroundColor Cyan
}
else {
    $mb = [math]::Round($script:TotalBytesFreed / 1MB, 2)
    Write-Host "  Cleanup complete" -ForegroundColor Cyan
    Write-Host "  Directories removed: $($script:TotalDirsRemoved)" -ForegroundColor Green
    Write-Host "  Files removed: $($script:TotalFilesRemoved)" -ForegroundColor Green
    Write-Host "  Space freed: $mb MB" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $RemoveNodeModules -and -not $DryRun) {
    Write-Host "To also clean node_modules, run:" -ForegroundColor DarkCyan
    Write-Host "  .\scripts\windows\clean-cache.ps1 -RemoveNodeModules" -ForegroundColor Gray
}
if (-not $RemoveVenv -and -not $DryRun) {
    Write-Host "To also clean virtual environments, run:" -ForegroundColor DarkCyan
    Write-Host "  .\scripts\windows\clean-cache.ps1 -RemoveVenv" -ForegroundColor Gray
}