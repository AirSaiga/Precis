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

/** restart-python-server 的返回结构 */
interface RestartResult {
  ready: boolean;
  port?: number;
  error?: string;
}

/**
 * 进行中的 restart-python-server Promise（并发互斥）。
 *
 * 竞态成因：两次快速连发的 invoke 会各自执行一遍 stop → start，交错时
 * 第二次 stop 可能终止的是第一次刚 spawn 的子进程，而第一次 start 尚未
 * 返回时第二次 start 又 spawn 一个新进程——端口占用/进程树错乱，旧进程
 * 若未被完全回收即成为孤儿 Python。故用模块级 in-flight Promise 复用：
 * 并发的第二次调用直接 await 同一次重启结果，重启完成后置空释放。
 */
let restartInFlight: Promise<RestartResult> | null = null;

/** 执行一次完整的"终止 + 重启"流程（仅应由 restart handler 经互斥调用） */
async function restartPythonServerOnce(backendPath: string): Promise<RestartResult> {
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

  ipcMain.handle('restart-python-server', async (): Promise<RestartResult> => {
    // 并发互斥：重启进行中时，后续 invoke 复用同一个 Promise（拿到同一次重启的结果），
    // 不再并发走第二遍 stop → start；重启完成后置空，允许下一次真正的重启。
    if (restartInFlight) {
      return restartInFlight;
    }
    restartInFlight = restartPythonServerOnce(backendPath);
    try {
      return await restartInFlight;
    } finally {
      restartInFlight = null;
    }
  });

  // 后端 API 一次性 token：startPythonServer 每次启动重新生成并注入后端环境变量
  // PRECIS_API_TOKEN，渲染进程取回后经 X-Precis-Auth 头携带，后端据此放行 null Origin
  // 的 CORS。未 spawn 后端（开发模式外部后端 / token 未生成）时返回空串，
  // 渲染进程据此不注入该头（后端中间件同样无 token 配置、完全直通）。
  ipcMain.handle('get-api-token', () => appState.backendApiToken);
}
