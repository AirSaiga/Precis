/**
 * @file constants.ts
 * @description 主进程共享常量
 *
 * 从 main.ts 抽出的、被多模块引用的常量。单独成文件避免循环依赖。
 */

/**
 * Python 后端服务的默认起始端口
 * 可通过环境变量 BACKEND_PORT 覆盖
 *
 * 动态端口分配:
 * - 如果默认端口被占用，会自动查找下一个可用端口
 * - 实际使用的端口存储在 appState.currentPythonServerPort 中
 */
export const PYTHON_SERVER_DEFAULT_PORT: number = parseInt(
  process.env.VITE_BACKEND_PORT || '18000',
  10
);
