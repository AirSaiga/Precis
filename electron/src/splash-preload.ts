/**
 * @fileoverview Splash 窗口的 preload 脚本
 *
 * 仅暴露 splash 渲染进程所需的最小 IPC 接口:
 * - onStage: 监听主进程推送的启动阶段状态
 * - getVersion: 查询应用版本号(用于 splash 右下角显示)
 *
 * 安全规范与主 preload.ts 一致:
 * - contextIsolation: true(独立上下文)
 * - sandbox: true
 * - 通过 contextBridge 白名单暴露有限 API
 */

import { contextBridge, ipcRenderer } from 'electron';

/** splash 阶段状态数据 */
export interface SplashStageData {
  stage: string;
  error?: boolean;
}

contextBridge.exposeInMainWorld('splashAPI', {
  /**
   * 监听主进程推送的启动阶段状态。
   * @returns 取消监听函数(供清理使用)
   */
  onStage: (callback: (data: SplashStageData) => void): (() => void) => {
    const handler = (_event: unknown, data: SplashStageData): void => {
      callback(data);
    };
    ipcRenderer.on('splash:stage', handler);
    return () => {
      ipcRenderer.removeListener('splash:stage', handler);
    };
  },
  /**
   * 查询应用版本号(splash 启动时调用一次)
   */
  getVersion: (): Promise<string> => ipcRenderer.invoke('splash:get-version'),
});
