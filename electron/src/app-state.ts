/**
 * @file app-state.ts
 * @description 主进程全局状态容器（单一事实源）
 *
 * 用单一对象容器替代原 main.ts 中的 8 个裸 `let` 全局变量。
 *
 * 为什么用对象容器而非裸 let？
 * - commonjs 模块的 `let` 导出陷阱：若其他模块 `import { pythonProcess } from './main'`，
 *   拿到的是"绑定时的值快照"，main 内重新赋值后，导入方读到的仍是旧值（null）。
 * - 对象引用稳定：`appState.pythonProcess` 总是从稳定的 appState 对象上读取最新属性值，
 *   无论 app-state.ts 被多少模块导入。
 *
 * 这是 Phase 4-7（pythonProcess/windows/protocol 模块拆分）的前置基础：
 * 那些模块需要跨文件读写主进程状态，必须通过本容器访问，避免 commonjs 陷阱。
 *
 * Python 状态重置由 pythonProcess.ts 的 stop 系列函数内联完成
 *（appState.pythonProcess = null + appState.isPythonServerReady = false）。
 */

import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'child_process';
import { PYTHON_PORT_SENTINEL } from './constants';

/**
 * 主进程全局状态
 *
 * 所有字段对应原 main.ts 的裸 let 变量：
 * - mainWindow / splashWindow：窗口实例（生命周期内创建/销毁）
 * - mainWindowReady / backendReady：启动就绪标志（tryShowMainWindow 三重守卫）
 * - isBackendSpawnEnvironment：是否需本地启动后端（影响 splash 状态机）
 * - pythonProcess：Python 子进程引用（三钩子清理依赖此引用）
 * - isPythonServerReady：后端就绪标志（前端是否可发 API 请求）
 * - currentPythonServerPort：动态分配的端口（初始哨兵 PYTHON_PORT_SENTINEL=0,发现后更新）
 */
export interface AppState {
  /** 主窗口实例 */
  mainWindow: BrowserWindow | null;
  /** Splash 启动窗口实例 */
  splashWindow: BrowserWindow | null;
  /** 主窗口是否已就绪（ready-to-show） */
  mainWindowReady: boolean;
  /** 后端是否已就绪（API 可响应） */
  backendReady: boolean;
  /** 是否处于需本地启动后端的环境（打包/有前端构建产物） */
  isBackendSpawnEnvironment: boolean;
  /** Python 子进程引用（必须保持引用以便正确终止） */
  pythonProcess: ChildProcess | null;
  /** Python 服务器是否就绪（解析 stdout 信号） */
  isPythonServerReady: boolean;
  /** 当前 Python 服务器端口（动态分配） */
  currentPythonServerPort: number;
}

/**
 * 主进程全局状态单例
 *
 * 全应用唯一，对象引用稳定。所有状态读写通过 appState.xxx 进行。
 */
export const appState: AppState = {
  mainWindow: null,
  splashWindow: null,
  mainWindowReady: false,
  backendReady: false,
  isBackendSpawnEnvironment: false,
  pythonProcess: null,
  isPythonServerReady: false,
  currentPythonServerPort: PYTHON_PORT_SENTINEL,
};
