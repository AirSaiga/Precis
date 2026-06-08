#!/bin/bash
set -e

# macOS 打包脚本
# 生成 DMG 安装包（跳过签名，Beta 阶段不需要 Apple 开发者证书）

# 设置 Electron 镜像源（国内加速）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# 跳过代码签名（Beta 阶段不需要 Apple 开发者证书）
export CSC_IDENTITY_AUTO_DISCOVERY=false

# 构建前端
echo "[build-mac] Building frontend..."
cd frontend
npm ci
npm run build-only
cd ..

# 构建 Electron
echo "[build-mac] Building electron..."
cd electron
npm ci
npm run build:electron

# 打包 DMG（显式禁用签名）
echo "[build-mac] Packaging DMG..."
npx electron-builder --mac --config.mac.identity=null

echo "[build-mac] Done. DMG should be in electron/release/"
