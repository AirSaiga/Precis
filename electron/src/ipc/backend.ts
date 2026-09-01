/**
 * @file backend.ts
 * @description 后端服务 IPC handler（从 main.ts 抽出）
 *
 * 依赖 app-state（共享状态）+ pythonProcess（启停后端）：
 * - get-server-status：返回后端就绪状态 + 端口 + 前端端口
 * - restart-python-server：终止并重启 Python 后端（软重启）
 * - get-api-token：下发后端 API 一次性 token（渲染进程随请求携带 X-Precis-Auth）
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
 * - get-api-token：下发后端 API 一次性 token
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

  // 后端 API 一次性 token：startPythonServer 每次启动重新生成并注入后端环境变量
  // PRECIS_API_TOKEN，渲染进程取回后经 X-Precis-Auth 头携带，后端据此放行 null Origin
  // 的 CORS。未 spawn 后端（开发模式外部后端 / token 未生成）时返回空串，
  // 渲染进程据此不注入该头（后端中间件同样无 token 配置、完全直通）。
  ipcMain.handle('get-api-token', () => appState.backendApiToken);
}
