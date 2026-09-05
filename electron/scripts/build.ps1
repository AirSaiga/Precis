# 构建脚本 - 先构建前端与 Electron 主进程，再执行 electron-builder 打包
# 用法: .\scripts\build.ps1 [pack|dist|release]
#
# ⚠️ 本文件必须保存为 UTF-8 with BOM：Windows PowerShell 5.1 对无 BOM 文件按 ANSI(GBK)
#    解码，中文说明字符串的 UTF-8 字节会吞掉相邻引号、静默吞掉后续语句（tsc 步骤曾因此
#    被整体跳过且退出码仍为 0）。带 BOM 才能保证解析正确。

param(
    [Parameter()]
    [ValidateSet("pack", "dist", "release")]
    [string]$Target = "pack"
)

$ErrorActionPreference = "Stop"

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

Write-Host "ELECTRON_MIRROR: $env:ELECTRON_MIRROR" -ForegroundColor Cyan
Write-Host "ELECTRON_BUILDER_BINARIES_MIRROR: $env:ELECTRON_BUILDER_BINARIES_MIRROR" -ForegroundColor Cyan

# 脚本位于 electron/scripts/，仓库根在其上两级
$FrontendDir = Join-Path $PSScriptRoot "..\..\frontend"
$ElectronDir = Join-Path $PSScriptRoot ".."

# 在指定目录执行 npm script，非零退出码即中止打包——磁盘上的旧构建产物绝不允许混入安装包
function Invoke-NpmScript {
    param([string]$WorkingDir, [string]$Script, [string]$Description)
    Write-Host "[build.ps1] $Description (npm run $Script)" -ForegroundColor Cyan
    Push-Location $WorkingDir
    try {
        npm run $Script
        if ($LASTEXITCODE -ne 0) {
            throw "$Description 失败 (exit=$LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
}

# 任何打包目标都必须以当前源码的产物打包：缺构建步骤会把陈旧的 frontend/dist、electron/dist 原样封进 exe
Invoke-NpmScript $FrontendDir "build-only" "构建前端（vite）"
Invoke-NpmScript $ElectronDir "build:electron" "编译 Electron 主进程（tsc）"

switch ($Target) {
    "pack" { npx electron-builder --dir }
    "dist" {
        Invoke-NpmScript $ElectronDir "fetch-python" "拉取内嵌 Python 运行时（已缓存则跳过）"
        Invoke-NpmScript $ElectronDir "install:backend-deps" "安装后端依赖到运行时"
        npx electron-builder
    }
    "release" {
        Invoke-NpmScript $ElectronDir "fetch-python" "拉取内嵌 Python 运行时（已缓存则跳过）"
        Invoke-NpmScript $ElectronDir "install:backend-deps" "安装后端依赖到运行时"
        npx electron-builder --publish=always
    }
}

# powershell -File 结束时不透传原生命令的失败退出码，必须显式检查并 exit，
# 否则 npm/CI/GUI 会把打包失败误判为成功
if ($LASTEXITCODE -ne 0) {
    Write-Host "[build.ps1] electron-builder 失败 (exit=$LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}
exit 0
