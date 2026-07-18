# 重置所有 challenges 的 workspace/ 到 seed/ 副本。
# 用法：在 challenges/ 目录下执行 powershell -File reset.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$count = 0
Get-ChildItem -Directory -Filter "C*" | ForEach-Object {
    $challenge = $_.Name
    $seed = Join-Path $challenge "seed"
    $workspace = Join-Path $challenge "workspace"
    if (-not (Test-Path $seed -PathType Container)) {
        Write-Host "skip $challenge (no seed/)"
        return
    }
    if (Test-Path $workspace) {
        Remove-Item -Recurse -Force $workspace
    }
    Copy-Item -Recurse $seed $workspace
    $count++
    Write-Host "reset $challenge"
}

Write-Host "Reset $count challenge(s)"
