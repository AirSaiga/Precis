# 构建脚本 - 自动设置镜像源并执行 electron-builder
# 用法: .\scripts\build.ps1 [pack|dist|release]

param(
    [Parameter()]
    [ValidateSet("pack", "dist", "release")]
    [string]$Target = "pack"
)

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

Write-Host "ELECTRON_MIRROR: $env:ELECTRON_MIRROR" -ForegroundColor Cyan
Write-Host "ELECTRON_BUILDER_BINARIES_MIRROR: $env:ELECTRON_BUILDER_BINARIES_MIRROR" -ForegroundColor Cyan

switch ($Target) {
    "pack" { npx electron-builder --dir }
    "dist" { npx electron-builder }
    "release" { npx electron-builder --publish=always }
}
