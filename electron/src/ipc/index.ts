/**
 * @file index.ts
 * @description IPC 注册聚合入口
 *
 * 统一注册所有 IPC handler。在 app.whenReady 内、createWindow 之前调用：
 *
 *   registerAllIpc({ backendPath, frontendDevPort });
 *
 * 设计说明：
 * - 采用显式注册（registerXxxIpc）而非"import 即注册"的 side-effect 模式，
 *   使注册时序可控（避免渲染进程 ready 后 invoke 晚注册的 handler 报错）
 * - update.ts 走"import 即注册"（构造函数内 setupIpcHandlers），两套风格并存过渡，
 *   本聚合不含 update 系列
 *
 * 当前包含：
 * - config：启动配置读写
 * - filesystem：文件/目录操作（含 read-file/write-file）
 * - feedback：崩溃反馈 + logs 读取
 * - appInfo：应用版本/用户数据路径/默认项目路径/cwd
 * - backend：后端状态查询 + 软重启（依赖 app-state + pythonProcess）
 */

import { registerConfigIpc } from './config';
import { registerFilesystemIpc } from './filesystem';
import { registerFeedbackIpc } from './feedback';
import { registerAppInfoIpc } from './appInfo';
import { registerBackendIpc } from './backend';

/** registerAllIpc 所需配置（backend IPC 需要后端路径 + 前端端口） */
export interface RegisterAllIpcConfig {
  backendPath: string;
  frontendDevPort: number;
}

/**
 * 注册全部 IPC handler（update.ts 的自注册除外）
 *
 * 必须在 createWindow 之前调用，确保渲染进程 ready 后 invoke 任何 handler 都已就位。
 *
 * @param config - backend IPC 所需的后端路径与前端端口
 */
export function registerAllIpc(config: RegisterAllIpcConfig): void {
  registerConfigIpc();
  registerFilesystemIpc();
  registerFeedbackIpc();
  registerAppInfoIpc();
  registerBackendIpc(config);
}
