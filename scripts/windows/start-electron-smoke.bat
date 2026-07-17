@echo off
REM 本地运行 Electron 打包 smoke 测试
REM 前置：需已安装 frontend/e2e 依赖；本脚本会自动打包 Electron unpacked

setlocal

REM 切到仓库根
cd /d "%~dp0..\.."

echo [1/3] 构建前端静态产物...
cd frontend
call npm run build-only
if errorlevel 1 goto :error
cd ..

echo [2/3] 打包 Electron（unpacked dir）...
cd electron
call npx tsc
if errorlevel 1 goto :error
call npx electron-builder --dir --win --publish never
if errorlevel 1 goto :error
cd ..

echo [3/3] 运行 Electron smoke 测试...
cd e2e
call npx playwright test --config=playwright.electron.config.ts
if errorlevel 1 goto :error
cd ..

echo.
echo ✓ Electron smoke 测试完成
exit /b 0

:error
echo.
echo ✗ Electron smoke 测试失败
exit /b 1
