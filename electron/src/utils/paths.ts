/**
 * @fileoverview Electron 应用资源路径解析工具
 *
 * 开发环境与生产环境的资源布局不同：
 * - 开发环境：electron/dist 与 backend、frontend 位于项目根目录同级
 * - 生产环境：backend 与 frontend/dist 通过 extraResources 复制到 resources/{backend,frontend/dist}
 *
 * 本模块提供与 Electron 解耦的纯函数，便于单元测试。
 */

import * as path from 'path';

/**
 * 获取后端代码库的基础路径
 *
 * @param isPackaged - 当前是否处于 Electron 打包环境
 * @param resourcesPath - 生产环境下 resources 目录的绝对路径（即 process.resourcesPath）
 * @param devDirname - 开发环境下 __dirname 的绝对路径
 * @returns 后端代码库的基础路径
 */
export function getBackendPath(isPackaged: boolean, resourcesPath: string, devDirname: string): string {
  if (isPackaged) {
    return path.join(resourcesPath, 'backend');
  }
  return path.join(devDirname, '..', 'backend');
}

/**
 * 获取前端构建产物目录的路径
 *
 * @param isPackaged - 当前是否处于 Electron 打包环境
 * @param resourcesPath - 生产环境下 resources 目录的绝对路径（即 process.resourcesPath）
 * @param devDirname - 开发环境下 __dirname 的绝对路径
 * @returns 前端构建产物目录的路径
 */
export function getFrontendPath(isPackaged: boolean, resourcesPath: string, devDirname: string): string {
  if (isPackaged) {
    return path.join(resourcesPath, 'frontend', 'dist');
  }
  return path.join(devDirname, '..', 'frontend', 'dist');
}

// ============================================================================
// preload / splash 资源路径
//
// 这三类路径都是"相对于编译产物 __dirname 的固定相对路径"：
// - 编译后结构固定：dist/preload.js、dist/splash-preload.js 在 dist 根；
//   dist/windows/mainWindow.js、dist/windows/splashWindow.js 在 dist/windows/ 子目录；
//   assets/splash.html 在 electron/assets/（dist 的上两级）。
// - 打包后（asar）结构一致，故不区分 dev/prod。
// 提取为纯函数便于单测，防止目录迁移时 __dirname 相对路径写错（Phase5 曾因此出 bug）。
// ============================================================================

/**
 * 主窗口 preload 脚本路径
 *
 * @param callerDirname - 调用方（编译后）的 __dirname，预期为 dist/windows/
 * @returns dist/preload.js（从 dist/windows/ 上溯一级到 dist 根）
 */
export function getPreloadPath(callerDirname: string): string {
  return path.join(callerDirname, '..', 'preload.js');
}

/**
 * Splash 窗口 preload 脚本路径
 *
 * @param callerDirname - 调用方（编译后）的 __dirname，预期为 dist/windows/
 * @returns dist/splash-preload.js（从 dist/windows/ 上溯一级到 dist 根）
 */
export function getSplashPreloadPath(callerDirname: string): string {
  return path.join(callerDirname, '..', 'splash-preload.js');
}

/**
 * splash.html 资源路径
 *
 * @param callerDirname - 调用方（编译后）的 __dirname，预期为 dist/windows/
 * @returns electron/assets/splash.html（从 dist/windows/ 上溯两级到 electron/）
 */
export function getSplashHtmlPath(callerDirname: string): string {
  return path.join(callerDirname, '..', '..', 'assets', 'splash.html');
}
