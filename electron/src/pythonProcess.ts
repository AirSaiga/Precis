/**
 * @file pythonProcess.ts
 * @description Python 后端子进程管理（从 main.ts 抽出）
 *
 * 提供 Python 后端的启动、停止、进程树终止功能：
 * - resolvePythonExecutable：解析 Python 解释器路径（环境变量/内嵌运行时/系统）
 * - startPythonServer：启动后端（端口分配 + spawn + 就绪信号检测 + API 轮询）
 * - stopPythonServer / stopPythonServerSync：异步/同步终止进程树
 * - killProcessTree：跨平台递归终止进程树
 *
 * 状态访问：通过 app-state.ts 的 appState 容器（避免 commonjs let 陷阱）。
 * 三钩子清理（window-all-closed/before-quit/quit）都调 stopPythonServerSync，
 * 必须读到同一份最新 pythonProcess 引用——这是用 appState 容器的核心理由。
 *
 * 依赖：app + child_process + path/fs + app-state + startup-probe + constants + logger。
 */

import { app } from 'electron';
import { spawn, execSync, type ChildProcess, type SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';
import { appState } from './app-state';
import {
  readBackendPortFile,
  waitForApiReady,
  containsStartupSignal,
  looksLikeStderrError,
  SIGNAL_SCAN_TAIL_CHARS,
  BACKEND_PORT_FILE,
} from './startup-probe';
import {
  PYTHON_STARTUP_SIGNAL_TIMEOUT_MS,
  PYTHON_API_READY_TIMEOUT_MS,
} from './constants';

// ============================================================================
// 进程树终止
// ============================================================================

/**
 * 递归终止整个进程树
 *
 * 跨平台实现:
 * - Windows: 使用 taskkill /T /F 强制终止子进程树
 * - Unix: 启动时设置 detached 创建新进程组，通过负 PID 发送信号终止整组
 *
 * @param pid - 子进程 PID
 */
export async function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const taskkill = spawn('taskkill', ['/T', '/F', '/PID', pid.toString()], {
        detached: true,
        windowsHide: true,
      });
      taskkill.on('close', () => resolve());
      taskkill.on('error', () => resolve());
      return;
    }

    // Unix: 先 SIGTERM 整个进程组
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // 进程可能已经退出
    }

    // 短暂宽限期后 SIGKILL，避免僵尸进程
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // 进程已经退出
      }
      resolve();
    }, 2000);
  });
}

// ============================================================================
// 停止
// ============================================================================

/**
 * 同步终止 Python 进程树
 *
 * 用途: 应用退出事件是同步的，需要立即发起终止指令。
 * 无法等待异步结果，但 kill 命令本身会尽快生效。
 *
 * @param processToKill - 要终止的子进程实例
 */
export function stopPythonServerSync(processToKill: ChildProcess | null): void {
  if (!processToKill) return;

  const pid = processToKill.pid;
  // 移除监听器，避免 kill 后回调继续操作全局状态
  processToKill.removeAllListeners();
  // 立即清空全局引用，防止重复清理
  appState.pythonProcess = null;

  if (pid) {
    logger.debug(`[Main] 同步终止 Python 进程树，PID: ${pid}`);
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /T /F /PID ${pid}`, { windowsHide: true, timeout: 5000 });
      } catch {
        // 进程可能已经退出或权限不足
      }
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // 进程可能已经退出
      }
    }
  }

  appState.isPythonServerReady = false;
}

/**
 * 异步终止 Python 进程树并等待清理完成
 *
 * 用途: 重启服务前需要确保旧进程已完全退出，避免端口占用。
 */
export async function stopPythonServer(): Promise<void> {
  if (!appState.pythonProcess) return;

  const proc = appState.pythonProcess;
  const pid = proc.pid;
  proc.removeAllListeners();
  appState.pythonProcess = null;
  appState.isPythonServerReady = false;

  if (pid) {
    logger.debug(`[Main] 终止 Python 进程树，PID: ${pid}`);
    await killProcessTree(pid).catch((err) => {
      logger.error('[Main] 终止 Python 进程树失败:', err);
    });
  }
}

// ============================================================================
// 启动
// ============================================================================

/**
 * 解析用于启动后端的 Python 解释器路径
 *
 * 优先级：
 * 1. PYTHON_PATH 环境变量（用户自定义）
 * 2. 打包后使用内嵌的 python-build-standalone 运行时
 * 3. 开发模式回退到系统 Python
 */
export function resolvePythonExecutable(): string {
  if (process.env.PYTHON_PATH) {
    return process.env.PYTHON_PATH;
  }
  if (app.isPackaged) {
    const runtimeDir = path.join(process.resourcesPath, 'python-runtime');
    const ext = process.platform === 'win32' ? '.exe' : '';
    const pythonBin =
      process.platform === 'win32'
        ? path.join(runtimeDir, 'python', `python${ext}`)
        : path.join(runtimeDir, 'bin', `python3${ext}`);
    return pythonBin;
  }
  return process.platform === 'darwin' ? 'python3' : 'python';
}

/**
 * 启动 Python 后端服务器
 *
 * 业务逻辑:
 * 1. 查找可用端口（支持动态端口分配）
 * 2. 确定 Python 可执行文件路径
 * 3. 构建命令行参数
 * 4. 启动子进程
 * 5. 监听进程输出，检测启动成功
 * 6. 设置超时保护机制
 *
 * @param backendPath - 后端根目录（用于 cwd 和定位 start_server.py）
 * @returns 实际使用的端口号；启动失败会 reject
 */
export async function startPythonServer(backendPath: string): Promise<number> {
  // 若已有进程在运行，先彻底终止，避免端口和进程树泄漏
  if (appState.pythonProcess) {
    await stopPythonServer();
  }

  // 解析 Python 解释器路径（内嵌运行时 / 环境变量 / 系统默认）
  const pythonExecutable = resolvePythonExecutable();
  logger.debug(`[Main] 使用 Python 解释器: ${pythonExecutable}`);

  // 定位后端启动脚本
  const serverScript = path.join(backendPath, 'app', 'start_server.py');

  // 健壮性检查: 确保脚本存在
  if (!fs.existsSync(serverScript)) {
    const errorMessage = `Python server script not found: ${serverScript}`;
    logger.error('[Main]', errorMessage);
    throw new Error(errorMessage);
  }

  // 构建命令行参数:--port 0 让后端由 OS 原子分配端口(无竞态、永不冲突)。
  // 后端拿到实际端口后写入 <backendPath>/.backend-port,主进程通过读该文件发现端口。
  const args = [serverScript, '--port', '0'];

  // 子进程配置
  // cwd: 设置工作目录，确保 Python 导入路径正确
  // stdio: 管道模式，允许我们读取子进程的输出
  // env: 强制 Python 无缓冲 + UTF-8 输出
  //   - PYTHONUNBUFFERED=1: stdout/stderr 立即 flush,避免管道块缓冲导致
  //     就绪信号迟迟读不到而误判超时(曾出现"stderr: none"的间歇性启动失败)
  //   - PYTHONIOENCODING=utf-8: Windows 默认 GBK,会导致 uvicorn/rich 的中文日志乱码
  // detached (Unix): 创建新进程组，便于整组清理
  // windowsHide: 在 Windows 上隐藏命令行窗口
  const options: SpawnOptions = {
    cwd: backendPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    detached: process.platform !== 'win32',
    windowsHide: true,
  };

  logger.debug(`[Main] Starting Python server: ${pythonExecutable} ${args.join(' ')}`);

  return new Promise<number>((resolve, reject) => {
    let resolved = false;
    // 累积 stdout/stderr 输出，用于滚动窗口扫描就绪信号，以及失败时回溯诊断
    let stderrBuffer = '';
    let stdoutBuffer = '';

    // 启动子进程
    const proc = spawn(pythonExecutable, args, options);
    appState.pythonProcess = proc;

    if (proc.pid) {
      logger.debug(`[Main] Python 子进程已启动，PID: ${proc.pid}`);
    }

    // 启动信号超时保护：未在 stdout 看到就绪标志则视为失败
    const startupTimeout = setTimeout(() => {
      if (!resolved) {
        const errorMessage = `Python server startup signal timeout after ${PYTHON_STARTUP_SIGNAL_TIMEOUT_MS}ms. stderr: ${stderrBuffer.trim() || 'none'}`;
        cleanupAndReject(new Error(errorMessage));
      }
    }, PYTHON_STARTUP_SIGNAL_TIMEOUT_MS);

    const cleanupAndReject = async (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);

      if (appState.pythonProcess) {
        const pid = appState.pythonProcess.pid;
        appState.pythonProcess.removeAllListeners();
        if (pid) {
          await killProcessTree(pid).catch(() => {
            // 忽略清理失败，确保 reject 优先返回给调用方
          });
        }
        appState.pythonProcess = null;
      }

      appState.isPythonServerReady = false;
      reject(error);
    };

    // 检测到就绪信号后,从端口文件读取后端 OS 分配的实际端口。
    // 信号出现意味着 uvicorn 已绑定,此时端口文件必然已写入。
    const cleanupAndResolve = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      // 从端口文件读取实际端口(--port 0 由 OS 分配,需通过文件发现)
      readBackendPortFile(backendPath, 5000)
        .then((port) => {
          if (port === null) {
            // 信号检测到就绪但读不到端口文件:异常状态,仍按失败处理
            cleanupAndReject(
              new Error(
                `Backend reported ready but port file (${BACKEND_PORT_FILE}) not found in ${backendPath}`
              )
            );
            return;
          }
          appState.currentPythonServerPort = port;
          appState.isPythonServerReady = true;
          logger.info(`[Main] Python server is ready on port ${port}`);
          resolve(port);
        })
        .catch((err) => {
          cleanupAndReject(new Error(`Failed to read backend port file: ${String(err)}`));
        });
    };

    // 监听标准输出 - 捕获后端启动成功的消息
    // 就绪信号检测扫描 stdoutBuffer 的滚动尾窗口（SIGNAL_SCAN_TAIL_CHARS），
    // 而非单个 data chunk，避免信号串被 Node 分块切断时漏检。
    proc.stdout?.on('data', (data) => {
      const output = data.toString();
      stdoutBuffer += output;
      logger.debug(`Python stdout: ${output}`);
      const tail = stdoutBuffer.slice(-SIGNAL_SCAN_TAIL_CHARS);
      if (containsStartupSignal(tail)) {
        cleanupAndResolve();
      }
    });

    // 监听标准错误 - 捕获后端的日志与就绪信号
    // Uvicorn 默认将 INFO 级别日志（含就绪信号）输出到 stderr，因此同样要在这里检测；
    // 同时对疑似真实错误（Traceback/Error/CRITICAL 等）按 error 级别记录。
    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderrBuffer += chunk;
      if (looksLikeStderrError(chunk)) {
        logger.error(`Python stderr: ${chunk}`);
      } else {
        logger.info(`Python stderr: ${chunk}`);
      }
      const tail = stderrBuffer.slice(-SIGNAL_SCAN_TAIL_CHARS);
      if (containsStartupSignal(tail)) {
        cleanupAndResolve();
      }
    });

    // 进程启动失败处理（如 python 可执行文件不存在）
    proc.on('error', (error) => {
      logger.error('[Main] Failed to start Python server:', error);
      cleanupAndReject(new Error(`Failed to spawn Python server: ${error.message}`));
    });

    // 进程异常退出处理
    proc.on('exit', (code) => {
      if (!resolved) {
        const errorMessage = `Python server exited unexpectedly with code ${code ?? 'unknown'}. stderr: ${stderrBuffer.trim() || 'none'}`;
        cleanupAndReject(new Error(errorMessage));
        return;
      }

      if (code !== 0) {
        logger.error(`[Main] Python server exited with code ${code}`);
      }
      appState.pythonProcess = null;
      appState.isPythonServerReady = false;
    });

    // 如果提前退出，清理超时器
    proc.once('exit', () => clearTimeout(startupTimeout));
  }).then(async (port) => {
    // 额外的 API 就绪检测：确保 FastAPI 真正准备好处理请求
    logger.debug('[Main] 等待 API 完全就绪...');
    const apiReady = await waitForApiReady(port, PYTHON_API_READY_TIMEOUT_MS);
    if (!apiReady) {
      await stopPythonServer();
      throw new Error(
        `Python server API did not become ready within ${PYTHON_API_READY_TIMEOUT_MS}ms on port ${port}`
      );
    }
    logger.debug('[Main] API 已就绪');
    appState.isPythonServerReady = true;
    return port;
  });
}
