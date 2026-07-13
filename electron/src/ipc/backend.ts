/**
 * @file backend.ts
 * @description 后端服务 IPC handler（从 main.ts 抽出）
 *
 * 依赖 app-state（共享状态）+ pythonProcess（启停后端）：
 * - get-server-status：返回后端就绪状态 + 端口 + 前端端口
 * - restart-python-server：终止并重启 Python 后端（软重启）
 *
 * 这两个 IPC 是 Phase 7 的"依赖 app-state"类（计划分类 12），必须在 appState
 * 和 pythonProcess 模块就绪后注册。
 */

import { ipcMain } from 'electron';
import { appState } from '../app-state';
import { logger } from '../logger';
import { startPythonServer, stopPythonServer } from '../pythonProcess';

/** backend IPC 注册所需的配置（由 main.ts 注入） */
export interface BackendIpcConfig {
  /** 后端根目录（startPythonServer 需要） */
  backendPath: string;
  /** 前端开发服务器端口（get-server-status 返回） */
  frontendDevPort: number;
}

/**
 * 注册后端服务相关 IPC handler
 *
 * - get-server-status：查询后端就绪状态
 * - restart-python-server：软重启后端（终止 + 重新启动）
 */
export function registerBackendIpc(config: BackendIpcConfig): void {
  const { backendPath, frontendDevPort } = config;

  ipcMain.handle('get-server-status', async () => {
    return {
      pythonReady: appState.isPythonServerReady,
      port: appState.currentPythonServerPort,
      frontendPort: frontendDevPort,
    };
  });

  ipcMain.handle('restart-python-server', async () => {
    logger.debug('[Main] 重启 Python 后端服务...');

    // 彻底终止现有进程树，避免旧进程残留导致端口冲突
    await stopPythonServer();

    try {
      // 重新启动（会自动查找新的可用端口）
      const port = await startPythonServer(backendPath);
      return {
        ready: true,
        port,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[Main] 重启 Python 服务失败:', errorMessage);
      return {
        ready: false,
        error: errorMessage,
        port: appState.currentPythonServerPort,
      };
    }
  });
}
