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
