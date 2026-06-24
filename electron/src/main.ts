/**
 * @fileoverview Electron 主进程入口文件
 * 
 * 功能概述:
 * - 管理整个桌面应用的生命周期
 * - 协调 Python 后端服务的启动和停止
 * - 创建和控制浏览器窗口
 * - 处理主进程与渲染进程之间的 IPC 通信
 * 
 * 架构设计:
 * - 采用主进程模式：Electron 主进程负责系统级操作，渲染进程负责 UI
 * - Python 后端作为子进程运行，通过 HTTP API 与前端通信
 * - 使用 IPC 机制暴露有限的、安全的 API 给渲染进程
 * 
 * 注意事项:
 * - [Electron] BrowserWindow 的 webPreferences 配置直接影响安全性
 * - [性能] Python 进程的生命周期管理不当可能导致资源泄漏
 * - [网络] 端口冲突检测机制确保服务可用性
 */

import { app, BrowserWindow, ipcMain, shell, protocol, net as electronNet, Menu, dialog } from 'electron';
import { spawn, ChildProcess, execSync, type SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as yaml from 'js-yaml';
import { updateManager } from './update';
import { getBackendPath, getFrontendPath } from './utils/paths';
import { logger, getLogFilePath, readLogFile, flushLogs } from './logger';

/**
 * Python 后端服务的默认起始端口
 * 可通过环境变量 BACKEND_PORT 覆盖
 * 
 * 动态端口分配:
 * - 如果默认端口被占用，会自动查找下一个可用端口
 * - 实际使用的端口存储在 currentPythonServerPort 变量中
 */
const PYTHON_SERVER_DEFAULT_PORT = parseInt(process.env.VITE_BACKEND_PORT || '18000', 10);

/**
 * 当前实际使用的 Python 服务端口号
 * 在 startPythonServer 中被动态设置
 */
let currentPythonServerPort: number = PYTHON_SERVER_DEFAULT_PORT;

/**
 * Vue 前端开发服务器的默认端口
 * 可通过环境变量 FRONTEND_DEV_PORT 覆盖
 * 与 frontend/vite.config.ts 中的配置保持一致
 */
const FRONTEND_DEV_PORT = parseInt(process.env.VITE_FRONTEND_PORT || '5173', 10);

/**
 * Python 后端启动信号超时时间（毫秒）
 * 用于检测 stdout 中是否出现 Uvicorn 启动完成标志
 */
const PYTHON_STARTUP_SIGNAL_TIMEOUT_MS = 30000;

/**
 * Python 后端 API 真正就绪检测超时时间（毫秒）
 * TCP 端口打开不代表 FastAPI 已可处理请求
 */
const PYTHON_API_READY_TIMEOUT_MS = 15000;

/**
 * 后端代码库的基础路径
 * 用于定位 Python 启动脚本和后端资源文件
 *
 * 开发环境: __dirname 指向 electron/dist，backend 位于同级 ../backend
 * 生产环境: backend 通过 extraResources 复制到 resources/backend
 */
const BACKEND_PATH = getBackendPath(app.isPackaged, process.resourcesPath, __dirname);

/**
 * 前端构建产物的路径
 * 生产环境下从此目录加载打包后的静态文件
 *
 * 开发环境: __dirname 指向 electron/dist，frontend/dist 位于 ../frontend/dist
 * 生产环境: frontend/dist 通过 extraResources 复制到 resources/frontend/dist
 */
const FRONTEND_PATH = getFrontendPath(app.isPackaged, process.resourcesPath, __dirname);

// ============================================================================
// 自定义协议注册（必须在 app.whenReady 之前）
// ============================================================================

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// ============================================================================
// 全局状态管理
// ============================================================================

/**
 * 主窗口实例的引用
 * 
 * 生命周期:
 * - 创建于 app.whenReady() 之后
 * - 销毁于 'closed' 事件触发时
 * 
 * 为什么使用全局变量而非闭包?
 * - 方便在多个事件处理器中访问窗口状态
 * - 确保窗口实例在整个应用生命周期内保持可达
 */
let mainWindow: BrowserWindow | null = null;

let splashWindow: BrowserWindow | null = null;

let mainWindowReady = false;
let backendReady = false;



/**
 * Python 子进程的引用
 * 
 * 重要性: 必须保持引用以便正确终止进程
 * 
 * [潜在副作用]
 * - 如果不调用 kill()，应用退出后 Python 进程可能继续运行
 * - Windows 和 Unix 的信号处理机制不同
 */
let pythonProcess: ChildProcess | null = null;

/**
 * Python 服务器就绪状态标志
 * 
 * 用途: 用于判断前端是否可以发起 API 请求
 * 触发条件: 解析 Python 进程的 stdout，检测特定的成功消息
 */
let isPythonServerReady = false;

/**
 * ============================================================================
 * 后端启动信号检测（纯函数，便于单元测试）
 * ============================================================================
 *
 * Uvicorn 的就绪日志（"Application startup complete." / "Uvicorn running on ..."）
 * 默认输出到 stderr，且可能被 Node 的 data 事件切成多个 chunk。因此检测时不能
 * 只看单个 chunk，而应扫描缓冲区的滚动尾窗口。
 */

/** 后端就绪信号片段，匹配任一即认为服务已启动 */
const STARTUP_SIGNALS = ['Application startup complete', 'Uvicorn running'] as const;

/** stderr 中标识真实错误的关键词，命中则按 error 级别记录 */
const STDERR_ERROR_MARKERS = ['Traceback', 'Error:', 'CRITICAL', 'Exception'] as const;

/** 滚动窗口扫描就绪信号时保留的尾部字符数（足够覆盖被分块切断的信号串） */
const SIGNAL_SCAN_TAIL_CHARS = 256;

/**
 * 判断一段文本是否包含后端就绪信号。
 *
 * @param text - 待扫描的文本（通常是 stderr/stdout 缓冲区的尾部窗口）
 * @returns 含就绪信号返回 true
 */
function containsStartupSignal(text: string): boolean {
  return STARTUP_SIGNALS.some((s) => text.includes(s));
}

/**
 * 判断一段 stderr 文本是否疑似真实错误（而非 Uvicorn 常规 INFO 日志）。
 *
 * @param text - 单个 data chunk 的文本
 * @returns 命中错误标记返回 true，应按 error 级别记录
 */
function looksLikeStderrError(text: string): boolean {
  return STDERR_ERROR_MARKERS.some((m) => text.includes(m));
}

/**
 * 查找可用端口的工具函数
 * 
 * 业务场景:
 * - 当默认端口被占用时，自动寻找下一个可用端口
 * - 避免用户手动配置端口的麻烦
 * 
 * 算法原理:
 * - 尝试绑定指定端口，成功则返回端口号
 * - 失败则递归尝试下一个端口号
 * 
 * @param startPort - 起始端口号
 * @returns 可用的端口号 Promise
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    // 尝试监听指定端口
    server.listen(startPort, '127.0.0.1', () => {
      //Electron] as net.AddressInfo 类型断言，Node [.js 特定类型
      const port = (server.address() as net.AddressInfo).port;
      // 立即关闭服务器并返回端口号
      server.close(() => resolve(port));
    });

    // 端口被占用时的错误处理
    server.on('error', () => {
      server.close();
      // 递归查找下一个端口，避免无限循环
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * 等待服务器就绪的轮询函数
 * 
 * 业务场景:
 * - 确保 Python 后端完全启动后再允许前端发起请求
 * - 避免前端因后端未就绪而报错
 * 
 * [副作用]
 * - 会创建临时的 TCP Socket 连接
 * - 轮询间隔 500ms 对性能影响微乎其微
 * 
 * @param port - 要检测的服务器端口
 * @param timeout - 超时时间（毫秒），默认 30 秒
 * @returns 服务器是否就绪
 */
async function waitForServer(port: number, timeout: number = 30000): Promise<boolean> {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const check = () => {
      const client = new net.Socket();
      
      // 尝试建立 TCP 连接
      client.connect(port, '127.0.0.1', () => {
        client.destroy();
        resolve(true);
      });

      // 连接失败的处理
      client.on('error', () => {
        client.destroy();
        // 检查是否超时
        if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          // 指数退避策略: 间隔 500ms 后重试
          setTimeout(check, 500);
        }
      });
    };
    
    check();
  });
}

/**
 * 通过 HTTP 请求检测后端 API 是否真正就绪
 * 
 * 业务场景:
 * - TCP 端口可连接不代表 FastAPI 已完全初始化
 * - 通过实际调用 /docs 端点确认 API 可正常响应
 * 
 * @param port - 服务器端口
 * @param timeout - 超时时间（毫秒），默认 30 秒
 * @param interval - 检查间隔（毫秒），默认 500ms
 * @returns API 是否就绪
 */
async function waitForApiReady(port: number, timeout: number = 30000, interval: number = 500): Promise<boolean> {
  const startTime = Date.now();
  const http = await import('http');
  
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/docs`, (res) => {
        // 只要收到响应（无论状态码），说明 API 已就绪
        if (res.statusCode && res.statusCode < 500) {
          resolve(true);
        } else {
          // 继续等待
          if (Date.now() - startTime > timeout) {
            resolve(false);
          } else {
            setTimeout(check, interval);
          }
        }
      });
      
      req.on('error', () => {
        if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      });
      
      req.setTimeout(interval, () => {
        req.destroy();
        if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      });
    };
    
    check();
  });
}

/**
 * 递归终止整个进程树
 * 
 * 跨平台实现:
 * - Windows: 使用 taskkill /T /F 强制终止子进程树
 * - Unix: 启动时设置 detached 创建新进程组，通过负 PID 发送信号终止整组
 * 
 * @param pid - 子进程 PID
 */
async function killProcessTree(pid: number): Promise<void> {
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

/**
 * 同步终止 Python 进程树
 * 
 * 用途: 应用退出事件是同步的，需要立即发起终止指令。
 * 无法等待异步结果，但 kill 命令本身会尽快生效。
 * 
 * @param processToKill - 要终止的子进程实例
 */
function stopPythonServerSync(processToKill: ChildProcess | null): void {
  if (!processToKill) return;

  const pid = processToKill.pid;
  // 移除监听器，避免 kill 后回调继续操作全局状态
  processToKill.removeAllListeners();
  // 立即清空全局引用，防止重复清理
  pythonProcess = null;

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

  isPythonServerReady = false;
}

/**
 * 异步终止 Python 进程树并等待清理完成
 * 
 * 用途: 重启服务前需要确保旧进程已完全退出，避免端口占用。
 */
async function stopPythonServer(): Promise<void> {
  if (!pythonProcess) return;

  const proc = pythonProcess;
  const pid = proc.pid;
  proc.removeAllListeners();
  pythonProcess = null;
  isPythonServerReady = false;

  if (pid) {
    logger.debug(`[Main] 终止 Python 进程树，PID: ${pid}`);
    await killProcessTree(pid).catch((err) => {
      logger.error('[Main] 终止 Python 进程树失败:', err);
    });
  }
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
 * [关键设计决策]
 * - 使用 findAvailablePort 动态分配端口，避免端口冲突
 * - 使用 spawn 而非 exec: 支持流式输出，避免缓冲区限制
 * - 设置 10 秒超时: 防止后端启动无限阻塞
 * 
 * [潜在问题]
 * - Python 环境未配置: 进程会启动失败
 * - 依赖未安装: 后端可能无法正常启动
 * 
 * @returns 实际使用的端口号；启动失败（脚本缺失、spawn 失败、超时）会 reject
 */

/**
 * 解析用于启动后端的 Python 解释器路径
 *
 * 优先级：
 * 1. PYTHON_PATH 环境变量（用户自定义）
 * 2. 打包后使用内嵌的 python-build-standalone 运行时
 * 3. 开发模式回退到系统 Python
 */
function resolvePythonExecutable(): string {
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

async function startPythonServer(): Promise<number> {
  // 若已有进程在运行，先彻底终止，避免端口和进程树泄漏
  if (pythonProcess) {
    await stopPythonServer();
  }

  // 查找可用端口
  logger.debug(`[Main] 查找可用端口，起始端口: ${PYTHON_SERVER_DEFAULT_PORT}`);
  currentPythonServerPort = await findAvailablePort(PYTHON_SERVER_DEFAULT_PORT);
  logger.debug(`[Main] 找到可用端口: ${currentPythonServerPort}`);

  // 解析 Python 解释器路径（内嵌运行时 / 环境变量 / 系统默认）
  const pythonExecutable = resolvePythonExecutable();
  logger.debug(`[Main] 使用 Python 解释器: ${pythonExecutable}`);

  // 定位后端启动脚本
  const serverScript = path.join(BACKEND_PATH, 'app', 'start_server.py');

  // 健壮性检查: 确保脚本存在
  if (!fs.existsSync(serverScript)) {
    const errorMessage = `Python server script not found: ${serverScript}`;
    logger.error('[Main]', errorMessage);
    throw new Error(errorMessage);
  }

  // 构建命令行参数，使用动态分配的端口
  const args = [serverScript, '--port', currentPythonServerPort.toString()];

  // 子进程配置
  // cwd: 设置工作目录，确保 Python 导入路径正确
  // stdio: 管道模式，允许我们读取子进程的输出
  // detached (Unix): 创建新进程组，便于整组清理
  // windowsHide: 在 Windows 上隐藏命令行窗口
  const options: SpawnOptions = {
    cwd: BACKEND_PATH,
    stdio: ['pipe', 'pipe', 'pipe'],
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
    // [Node.js] spawn 返回 ChildProcess 对象，可用于后续控制
    const proc = spawn(pythonExecutable, args, options);
    pythonProcess = proc;

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

      if (pythonProcess) {
        const pid = pythonProcess.pid;
        pythonProcess.removeAllListeners();
        if (pid) {
          await killProcessTree(pid).catch(() => {
            // 忽略清理失败，确保 reject 优先返回给调用方
          });
        }
        pythonProcess = null;
      }

      isPythonServerReady = false;
      reject(error);
    };

    const cleanupAndResolve = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(startupTimeout);
      isPythonServerReady = true;
      logger.info('[Main] Python server is ready');
      resolve(currentPythonServerPort);
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
    // 同时对疑似真实错误（Traceback/Error/CRITICAL 等）按 error 级别记录，
    // 避免后端崩溃 traceback 被压成无害的 info 日志。
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
      pythonProcess = null;
      isPythonServerReady = false;
    });

    // 如果提前退出，清理超时器
    proc.once('exit', () => clearTimeout(startupTimeout));
  }).then(async (port) => {
    // 额外的 API 就绪检测：确保 FastAPI 真正准备好处理请求
    logger.debug('[Main] 等待 API 完全就绪...');
    const apiReady = await waitForApiReady(port, PYTHON_API_READY_TIMEOUT_MS);
    if (!apiReady) {
      await stopPythonServer();
      throw new Error(`Python server API did not become ready within ${PYTHON_API_READY_TIMEOUT_MS}ms on port ${port}`);
    }
    logger.debug('[Main] API 已就绪');
    isPythonServerReady = true;
    return port;
  });
}

/**
 * 创建 Splash Screen（启动画面）
 *
 * 在应用启动时立即显示一个小型无边框窗口，展示品牌信息和加载动画。
 * 主窗口 ready-to-show 后自动关闭。
 */
function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 220,
    transparent: true,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const splashPath = path.join(__dirname, '..', 'assets', 'splash.html');
  splashWindow.loadFile(splashPath);

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

/**
 * 关闭 Splash Screen
 *
 * 带渐隐动画效果，避免突兀消失。
 */
function closeSplashWindow(): void {
  if (!splashWindow) return;
  if (splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  splashWindow.close();
  splashWindow = null;
}

/**
 * 尝试关闭 Splash Screen 并显示主窗口
 *
 * 只有当主窗口渲染完成 AND 后端就绪（或开发环境无需后端）时才执行。
 */
function tryShowMainWindow(): void {
  if (!mainWindowReady) return;
  if (!backendReady) return;
  if (!mainWindow) return;
  closeSplashWindow();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 创建主应用窗口
 * 
 * 业务功能:
 * - 初始化并显示应用程序的主窗口
 * - 根据环境加载开发服务器或生产构建文件
 * - 配置窗口行为和 Web 偏好设置
 * 
 * [Electron BrowserWindow 配置说明]
 * - width/height: 窗口初始尺寸
 * - minWidth/minHeight: 最小尺寸限制，防止 UI 被压缩
 * - webPreferences.nodeIntegration: 设为 false 增强安全性
 * - webPreferences.contextIsolation: 设为 true 隔离渲染进程
 * - webPreferences.preload: 预加载脚本路径
 * - webPreferences.sandbox: 设为 true 启用沙箱，限制渲染进程权限
 *   [安全说明]
 *   通过以下措施实现安全加载：
 *   1. nodeIntegration: false — 渲染进程无法直接访问 Node.js API
 *   2. contextIsolation: true — preload 脚本运行在独立上下文
 *   3. sandbox: true — 启用 Chromium 沙箱，限制 OS 级别访问
 *   4. preload 脚本通过 contextBridge 白名单机制暴露有限 API
 *   5. 生产环境使用 app:// 自定义协议加载本地文件，避免禁用 webSecurity
 *   6. 后端 CORS 通过 DynamicPortCORSMiddleware 限制 localhost 来源
 * 
 * [窗口事件流程]
 * 1. 创建窗口 (BrowserWindow 构造函数)
 * 2. 加载内容 (loadURL / loadFile)
 * 3. 渲染完成触发 'ready-to-show'
 * 4. 显示窗口并获取焦点
 * 5. 窗口关闭时清理引用
 */
function createWindow(): void {
  // 判断当前环境
  // 检测逻辑:
  // 1. 如果应用已打包 (app.isPackaged) -> 生产模式
  // 2. 如果有前端构建文件 (hasFrontendBuild) -> 生产模式
  // 3. 否则 -> 开发模式 (连接 Vite 开发服务器)
  const indexPath = path.join(FRONTEND_PATH, 'index.html');
  const hasFrontendBuild = fs.existsSync(indexPath);
  const isDev = !app.isPackaged && !hasFrontendBuild;

  // 创建浏览器窗口实例
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1200,    // 最小宽度约束，保证画布操作区可用
    minHeight: 800,    // 最小高度约束，保证面板信息完整显示
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'default',  // 使用系统默认标题栏
    autoHideMenuBar: !isDev,    // 生产环境隐藏传统菜单栏，开发环境保留方便调试
    show: false,               // 先创建后显示，避免闪烁
    backgroundColor: '#ffffff' // 白色背景避免透明闪烁
  });

  // 默认应用菜单栏的隐藏统一在 app.whenReady() 中处理（生产环境 setApplicationMenu(null)），
  // 此处不再重复设置，避免与 whenReady 内的逻辑冗余。

  // 调试信息
  logger.debug('[Main] __dirname:', __dirname);
  logger.debug('[Main] FRONTEND_PATH:', FRONTEND_PATH);
  logger.debug('[Main] indexPath:', indexPath);
  logger.debug('[Main] hasFrontendBuild:', hasFrontendBuild);
  logger.debug('[Main] isPackaged:', app.isPackaged);
  logger.debug('[Main] NODE_ENV:', process.env.NODE_ENV);
  logger.debug('[Main] isDev:', isDev);

  // 根据环境选择加载方式
  if (isDev) {
    // 开发环境: 连接到 Vite 开发服务器
    // 优势: 支持热重载、源文件映射
    logger.debug('[Main] 开发模式: 连接到 Vite 开发服务器');
    logger.debug('[Main] 开发服务器地址:', `http://localhost:${FRONTEND_DEV_PORT}`);
    mainWindow.loadURL(`http://localhost:${FRONTEND_DEV_PORT}`);
    
    // 自动打开开发者工具，便于调试
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境: 通过自定义 app:// 协议加载本地打包文件
    // 使用自定义协议替代 file://，避免 CORS 限制和 webSecurity 问题
    logger.debug('[Main] 生产模式: 通过 app:// 协议加载本地文件');
    mainWindow.loadURL(`app://./index.html`);
    
    // 生产环境可选开发者工具
    // mainWindow.webContents.openDevTools();
  }

  // 窗口首次渲染完成时标记就绪
  // 实际显示由 tryShowMainWindow() 统一控制，需等待后端也就绪
  mainWindow.once('ready-to-show', () => {
    mainWindowReady = true;
    tryShowMainWindow();
  });

  // 窗口关闭时清理引用
  // 防止内存泄漏
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 配置外部链接处理策略
  // [用户体验] 点击链接时使用系统默认浏览器打开
  // [安全] 阻止在新窗口中打开链接，避免弹出窗口滥用
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ============================================================================
// IPC 处理器定义
// ============================================================================

/**
 * 获取服务器状态
 * 
 * 用途: 供前端查询后端服务是否就绪
 * 
 * [数据来源]
 * - pythonReady: 来自全局状态变量 isPythonServerReady
 * - port: 来自动态分配的 currentPythonServerPort
 * - frontendPort: 前端开发服务器端口
 */
ipcMain.handle('get-server-status', async () => {
  return {
    pythonReady: isPythonServerReady,
    port: currentPythonServerPort,
    frontendPort: FRONTEND_DEV_PORT
  };
});

/**
 * 重启 Python 服务器
 * 
 * 业务场景:
 * - 后端发生错误时，前端可以请求重启服务
 * - 实现无需重启整个应用的"软重启"功能
 * 
 * 执行步骤:
 * 1. 终止现有 Python 进程
 * 2. 重置就绪状态标志
 * 3. 重新启动 Python 服务（会自动查找新的可用端口）
 * 4. 等待服务器就绪
 * 
 * [潜在风险]
 * - 进行中的 API 请求可能失败
 * - 未保存的数据可能丢失
 * - 端口可能变化，前端需要重新获取
 */
ipcMain.handle('restart-python-server', async () => {
  logger.debug('[Main] 重启 Python 后端服务...');

  // 彻底终止现有进程树，避免旧进程残留导致端口冲突
  await stopPythonServer();

  try {
    // 重新启动（会自动查找新的可用端口）
    const port = await startPythonServer();
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
      port: currentPythonServerPort,
    };
  }
});

/**
 * 获取应用版本号
 * 
 * 用途: 供前端显示版本信息
 * 
 * [Electron] 版本来自 package.json 的 version 字段
 */
ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

/**
 * 获取用户数据目录路径
 * 
 * 用途: 供前端获取 Electron 应用存储用户数据的标准目录
 * 
 * [Electron] 使用 app.getPath('userData') 获取标准目录
 * - Windows: %APPDATA%/Precis
 * - macOS: ~/Library/Application Support/Precis
 * - Linux: ~/.config/Precis
 * 
 * [设计说明]
 * - 避免前端渲染进程直接导入 electron 模块
 * - 通过主进程统一处理平台差异
 */
ipcMain.handle('get-user-data-path', async () => {
  return app.getPath('userData');
});

ipcMain.handle('get-default-project-path', async () => {
  const userDataDir = app.getPath('userData');
  const cwd = process.cwd();
  const envCandidates = [
    path.join(cwd, 'precis.env'),
    path.join(cwd, '.env'),
    path.join(cwd, '..', 'precis.env'),
    path.join(cwd, '..', '.env'),
    path.join(userDataDir, 'precis.env'),
    path.join(userDataDir, '.env'),
  ];

  const readEnvValue = (key: string): string | undefined => {
    for (const fp of envCandidates) {
      try {
        if (!fs.existsSync(fp)) continue;
        const content = fs.readFileSync(fp, 'utf-8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx < 0) continue;
          const k = trimmed.slice(0, idx).trim();
          if (k !== key) continue;
          let v = trimmed.slice(idx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          return v;
        }
      } catch {
        continue;
      }
    }
    return undefined;
  };

  const envRoot = process.env.PRECIS_PROJECT_ROOT || readEnvValue('PRECIS_PROJECT_ROOT');
  const root = envRoot && path.isAbsolute(envRoot) ? envRoot : path.join(app.getPath('documents'), 'PrecisProjects');

  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    // ignore
  }

  if (envRoot && path.isAbsolute(envRoot)) {
    return root;
  }

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(root, ent.name);
      const v2 = path.join(dir, 'project.precis.yaml');
      if (fs.existsSync(v2)) {
        return dir;
      }
    }
  } catch {
    // ignore
  }

  const fallback = path.join(root, 'DefaultProject');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    // ignore
  }
  return fallback;
});

ipcMain.handle('save-config', async (event, configPath: string, dataPath: string) => {
  // ============================================================================
  // Electron 启动配置文件路径
  // ============================================================================
  // 使用用户数据目录下的 .precis/electron_launch.yaml，避免写入安装目录
  // Windows: %APPDATA%/Precis/.precis/electron_launch.yaml
  // macOS: ~/Library/Application Support/Precis/.precis/electron_launch.yaml
  // Linux: ~/.config/Precis/.precis/electron_launch.yaml
  const userDataDir = app.getPath('userData');
  const configDir = path.join(userDataDir, '.precis');
  const configFile = path.join(configDir, 'electron_launch.yaml');

  try {
    // 确保 .precis 目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 使用 js-yaml 序列化配置，避免手写 YAML 字符串和正则解析带来的安全风险
    const payload = {
      configPath,
      dataPath,
    };
    const content = yaml.dump(payload);

    fs.writeFileSync(configFile, content, 'utf-8');

    logger.debug('[Main] 配置已保存:', configFile);
    return true;
  } catch (error) {
    logger.error('[Main] 保存配置失败:', error);
    return false;
  }
});

ipcMain.handle('load-config', async () => {
  const userDataDir = app.getPath('userData');
  const configFile = path.join(userDataDir, '.precis', 'electron_launch.yaml');

  if (!fs.existsSync(configFile)) {
    logger.debug('[Main] 配置文件不存在');
    return { configPath: '', dataPath: '' };
  }

  try {
    const content = fs.readFileSync(configFile, 'utf-8');
    const parsed = yaml.load(content) as { configPath?: string; dataPath?: string } | null;
    const configPath = parsed?.configPath || '';
    const dataPath = parsed?.dataPath || '';
    logger.debug('[Main] 配置已加载:', { configPath, dataPath });
    return { configPath, dataPath };
  } catch (error) {
    logger.error('[Main] 读取配置失败:', error);
    return { configPath: '', dataPath: '' };
  }
});

ipcMain.handle('ensure-dir', async (event, dirPath: string) => {
  if (!dirPath || typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) return false;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
});

/**
 * 打开文件选择对话框
 * 
 * 用途: 供前端在 Electron 环境中选择本地文件
 * 
 * [Electron] dialog.showOpenDialog 的 options 参数:
 * - title: 对话框标题
 * - buttonLabel: 确定按钮的自定义标签
 * - filters: 文件类型过滤器数组
 * - properties: 对话框属性（openFile, multiSelections 等）
 * 
 * [Electron] OpenDialogResponse 返回值:
 * - canceled: 用户是否取消对话框
 * - filePaths: 用户选择的文件路径数组
 * 
 * [设计说明]
 * - 避免前端渲染进程直接导入 electron 模块
 * - 支持跨平台的文件选择功能
 */
ipcMain.handle('show-open-dialog', async (event, options: {
  title?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory' | 'dontAddToRecent'>;
}) => {
  const { dialog, BrowserWindow } = await import('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: options.title || '选择文件',
    buttonLabel: options.buttonLabel || '选择',
    filters: options.filters,
    properties: options.properties
  };
  
  if (win) {
    return await dialog.showOpenDialog(win, dialogOptions);
  } else {
    return await dialog.showOpenDialog(dialogOptions);
  }
});

/**
 * 检查本地文件是否存在
 * 
 * 业务用途:
 * - 验证数据源列表中的本地文件路径是否有效
 * - 在用户重新打开应用时检查文件是否被移动或删除
 * 
 * [安全性说明]
 * - 仅检查文件是否存在，不读取文件内容
 * - 路径验证在主进程完成，避免渲染进程直接访问文件系统
 * 
 * @param event IPC 事件对象
 * @param filePath 要检查的文件绝对路径
 * @returns Promise<boolean> - 文件是否存在
 */
ipcMain.handle('check-file-exists', async (event, filePath: string) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
  } catch (error) {
    logger.error('[Electron] 检查文件存在性失败:', error);
    return false;
  }
});

/**
 * 重新选择文件对话框
 * 
 * 业务用途:
 * - 当原有的文件路径无效时，让用户重新选择文件
 * - 保留原文件的文件名作为默认选择参考
 * 
 * [使用场景]
 * - 用户移动或删除了原本的数据文件
 * - 文件路径变更需要更新数据源配置
 * 
 * @param event IPC 事件对象
 * @param options 对话框配置选项
 * @returns Promise<OpenDialogResponse> - 用户选择的文件路径和取消状态
 */
ipcMain.handle('reselect-file', async (event, options: {
  title?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
}) => {
  const { dialog, BrowserWindow } = await import('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions = {
    title: options.title || '重新选择文件',
    buttonLabel: options.buttonLabel || '确认',
    filters: options.filters,
    properties: options.properties
  };

  if (win) {
    return await dialog.showOpenDialog(win, dialogOptions);
  } else {
    return await dialog.showOpenDialog(dialogOptions);
  }
});

/**
 * 使用系统默认程序打开文件
 * 
 * 业务用途:
 * - 允许用户通过点击"打开"按钮用 Excel 等默认程序查看数据文件
 * - 使用 Electron shell.openPath() 调用系统关联程序
 * 
 * [Electron] shell.openPath() 说明:
 * - 自动查找与文件扩展名关联的默认程序
 * - Windows: 使用注册的程序关联
 * - macOS: 使用 Launch Services
 * - Linux: 使用 xdg-open
 * 
 * @param event IPC 事件对象
 * @param filePath 要打开的文件绝对路径
 * @returns Promise<{ success: boolean; error?: string }> - 打开结果
 */
ipcMain.handle('open-file', async (event, filePath: string) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: '无效的文件路径' };
    }

    // 检查文件是否存在
    await new Promise<void>((resolve, reject) => {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
          reject(new Error('文件不存在'));
        } else {
          resolve();
        }
      });
    });

    // 使用系统默认程序打开文件
    const openError = await shell.openPath(filePath);
    if (openError) {
      logger.error('[Electron] 打开文件失败:', openError);
      return { success: false, error: openError };
    }

    logger.debug('[Electron] 已用系统程序打开文件:', filePath);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.error('[Electron] 打开文件失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

/**
 * 保存文本文件到用户数据目录
 * 
 * 业务用途:
 * - 保存项目路径配置等用户设置
 * - 持久化应用状态到本地文件系统
 * 
 * @param event IPC 事件对象
 * @param fileName 要保存的文件名（不含路径）
 * @param content 文件内容（JSON 格式）
 * @returns Promise<boolean> - 保存是否成功
 */
ipcMain.handle('save-text-file', async (event, fileName: string, content: string) => {
  try {
    if (!fileName || typeof fileName !== 'string') {
      return false;
    }

    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      logger.error('[Electron] save-text-file: 文件名包含非法字符:', fileName);
      return false;
    }

    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, fileName);
    
    fs.writeFileSync(filePath, content, 'utf-8');
    logger.debug('[Electron] 文件已保存:', filePath);
    return true;
  } catch (error) {
    logger.error('[Electron] 保存文件失败:', error);
    return false;
  }
});

/**
 * 从用户数据目录读取文本文件
 * 
 * 业务用途:
 * - 读取保存的项目路径配置
 * - 恢复应用状态
 * 
 * @param event IPC 事件对象
 * @param fileName 要读取的文件名（不含路径）
 * @returns Promise<string | null> - 文件内容，文件不存在返回 null
 */
ipcMain.handle('load-text-file', async (event, fileName: string) => {
  try {
    if (!fileName || typeof fileName !== 'string') {
      return null;
    }

    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      logger.error('[Electron] load-text-file: 文件名包含非法字符:', fileName);
      return null;
    }

    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, fileName);

    if (!fs.existsSync(filePath)) {
      logger.debug('[Electron] 文件不存在:', filePath);
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    logger.debug('[Electron] 文件已读取:', filePath);
    return content;
  } catch (error) {
    logger.error('[Electron] 读取文件失败:', error);
    return null;
  }
});

/**
 * 递归扫描目录下的所有文件
 * 
 * 业务用途:
 * - 扫描用户选择的目录，获取所有符合要求的文件
 * - 支持过滤特定扩展名的文件
 * 
 * 递归算法:
 * - 使用深度优先遍历
 * - 遇到目录则递归进入
 * - 遇到文件则检查扩展名后加入结果
 * 
 * @param dirPath 要扫描的目录绝对路径
 * @param allowedExtensions 允许的扩展名数组（如 ['.csv', '.xlsx', '.xls']）
 * @param result 结果数组，用于收集符合条件的文件路径
 */
function scanDirectoryRecursive(dirPath: string, allowedExtensions: string[], result: string[]): void {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // 递归扫描子目录
        scanDirectoryRecursive(fullPath, allowedExtensions, result);
      } else if (entry.isFile()) {
        // 检查文件扩展名
        const ext = path.extname(entry.name).toLowerCase();
        if (allowedExtensions.includes(ext)) {
          result.push(fullPath);
        }
      }
    }
  } catch (error) {
    logger.error('[Electron] 扫描目录失败:', dirPath, error);
  }
}

/**
 * 扫描目录获取符合条件的文件列表
 * 
 * 业务用途:
 * - 允许用户选择一个目录
 * - 递归扫描该目录下的所有文件
 * - 只返回符合扩展名的文件（.csv, .xlsx, .xls）
 * 
 * [安全性说明]
 * - 路径验证在主进程完成
 * - 只返回绝对路径
 * - 错误处理确保扫描失败不会导致应用崩溃
 * 
 * @param event IPC 事件对象
 * @param options 扫描选项
 * @param options.dirPath 要扫描的目录绝对路径
 * @param options.allowedExtensions 可选的允许扩展名数组，默认 ['.csv', '.xlsx', '.xls']
 * @returns Promise<string[]> - 符合条件的文件路径数组
 */
ipcMain.handle('scan-directory', async (event, options: {
  dirPath: string;
  allowedExtensions?: string[];
}) => {
  const { dirPath, allowedExtensions = ['.csv', '.xlsx', '.xls'] } = options;
  
  // 参数验证
  if (!dirPath || typeof dirPath !== 'string') {
    logger.error('[Electron] 无效的目录路径:', dirPath);
    return [];
  }

  // 验证目录是否存在
  if (!fs.existsSync(dirPath)) {
    logger.error('[Electron] 目录不存在:', dirPath);
    return [];
  }

  // 验证是否为目录
  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    logger.error('[Electron] 路径不是目录:', dirPath);
    return [];
  }

  logger.debug('[Electron] 开始扫描目录:', dirPath);
  logger.debug('[Electron] 允许的扩展名:', allowedExtensions);

  const result: string[] = [];
  scanDirectoryRecursive(dirPath, allowedExtensions, result);

  logger.debug('[Electron] 扫描完成，找到', result.length, '个文件');
  return result;
});

/**
 * 读取任意路径的文本文件
 * 
 * 业务用途:
 * - 读取工作区配置文件 (.precis/data_sources.yaml)
 * - 读取项目清单文件 (project.precis.yaml)
 * 
 * [安全性说明]
 * - 仅读取文本文件，不执行任何代码
 * - 路径验证确保是有效的绝对路径
 * 
 * @param event IPC 事件对象
 * @param filePath 文件的绝对路径
 * @returns Promise<string | null> - 文件内容，失败返回 null
 */
ipcMain.handle('read-file', async (event, filePath: string) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      logger.error('[Electron] 无效的文件路径:', filePath);
      return null;
    }

    const resolved = path.resolve(filePath);
    if (resolved !== filePath && resolved !== path.normalize(filePath)) {
      logger.error('[Electron] read-file: 路径包含非法穿越:', filePath);
      return null;
    }

    if (!path.isAbsolute(filePath)) {
      logger.error('[Electron] 路径必须是绝对路径:', filePath);
      return null;
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      logger.debug('[Electron] 文件不存在:', filePath);
      return null;
    }

    // 检查是否为文件
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      logger.error('[Electron] 路径不是文件:', filePath);
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    logger.debug('[Electron] 文件已读取:', filePath);
    return content;
  } catch (error) {
    logger.error('[Electron] 读取文件失败:', error);
    return null;
  }
});

/**
 * 写入文本文件到指定路径
 * 
 * 业务用途:
 * - 保存工作区配置
 * - 保存项目清单文件
 * - 自动创建父目录
 * 
 * [安全性说明]
 * - 路径验证确保是有效的绝对路径
 * - 自动创建不存在的父目录
 * 
 * @param event IPC 事件对象
 * @param filePath 文件的绝对路径
 * @param content 文件内容
 * @returns Promise<boolean> - 写入是否成功
 */
ipcMain.handle('write-file', async (event, filePath: string, content: string) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      logger.error('[Electron] 无效的文件路径:', filePath);
      return false;
    }

    const resolved = path.resolve(filePath);
    if (resolved !== filePath && resolved !== path.normalize(filePath)) {
      logger.error('[Electron] write-file: 路径包含非法穿越:', filePath);
      return false;
    }

    if (!path.isAbsolute(filePath)) {
      logger.error('[Electron] 路径必须是绝对路径:', filePath);
      return false;
    }

    // 自动创建父目录
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.debug('[Electron] 创建目录:', dirPath);
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    logger.debug('[Electron] 文件已保存:', filePath);
    return true;
  } catch (error) {
    logger.error('[Electron] 写入文件失败:', error);
    return false;
  }
});

/**
 * 获取当前工作目录
 * 
 * 业务用途:
 * - 前端确定项目根目录
 * - 用于构建配置文件的绝对路径
 * 
 * @returns Promise<string> - 当前工作目录的绝对路径
 */
ipcMain.handle('get-cwd', async () => {
  return process.cwd();
});

/**
 * [IPC] 读取主进程日志文件尾部内容
 *
 * 业务用途:
 * - 前端展示日志面板 / 用户复制日志用于反馈
 * - 配合错误对话框中的日志路径，提供应用内查看能力
 *
 * @returns Promise<string> - 日志尾部文本（最多 256KB），文件不存在时为空串
 */
ipcMain.handle('logs:read', async () => {
  return readLogFile();
});

/**
 * [IPC] 获取日志文件绝对路径
 *
 * @returns Promise<string> - 日志文件路径，userData 未就绪时为空串
 */
ipcMain.handle('logs:path', async () => {
  return getLogFilePath();
});

// ============================================================================
// 应用生命周期事件处理
// ============================================================================

/**
 * [Electron 主进程启动事件]
 * 
 * 执行时机: Electron 应用初始化完成后
 * 
 * 执行步骤:
 * 1. 创建主窗口
 * 2. (仅生产环境) 启动 Python 后端服务
 * 
 * [异步处理]
 * - 使用 async/await 确保后端启动完成后再继续
 * - 但不阻塞窗口创建
 */
app.whenReady().then(async () => {
  // 判断当前环境，用于决定是否隐藏系统菜单栏
  // 检测逻辑:
  // 1. 如果应用已打包 (app.isPackaged) -> 生产模式
  // 2. 如果有前端构建文件 (hasFrontendBuild) -> 生产模式
  // 3. 否则 -> 开发模式 (连接 Vite 开发服务器)
  const indexPath = path.join(FRONTEND_PATH, 'index.html');
  const hasFrontendBuild = fs.existsSync(indexPath);
  const isDev = !app.isPackaged && !hasFrontendBuild;

  // 尽早设置默认应用菜单栏: 生产环境隐藏, 开发环境保留默认菜单方便调试
  // 业务场景: 应用通过前端 UI 提供全部操作入口, 无需系统菜单
  // 平台差异:
  // - Windows/Linux: 菜单栏默认隐藏
  // - macOS: 屏幕顶部仍保留应用名菜单(系统强制), 但 File/Edit/View 等子菜单不再显示
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  // 注册 app:// 自定义协议处理器，将请求映射到前端构建目录
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // 解码 pathname 中可能存在的编码字符（如 %2F -> /），防止编码绕过路径穿越校验
    const decodedPathname = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(FRONTEND_PATH, decodedPathname));

    // 路径穿越校验：解析后的真实路径必须在 FRONTEND_PATH 范围内
    const realFilePath = path.resolve(filePath);
    const realFrontendPath = path.resolve(FRONTEND_PATH);
    const isInside =
      realFilePath === realFrontendPath ||
      realFilePath.startsWith(realFrontendPath + path.sep);
    if (!isInside) {
      logger.error('[Main] app:// 协议拒绝越界访问:', realFilePath);
      return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
    }

    return electronNet.fetch(`file://${filePath}`);
  });

  // 先显示 Splash Screen，让用户立即看到反馈
  createSplashWindow();

  // [启动顺序关键修复]
  // 必须先启动 Python 后端并确定实际端口，再创建/加载主窗口。
  // 否则渲染进程可能在后端端口尚未分配时就调用 getServerStatus()，
  // 拿到默认端口 18000 而无法连接，导致前端 Network Error。
  if (hasFrontendBuild) {
    // 生产环境: 启动 Python 后端并等待其就绪
    logger.info('[Main] 检测到打包环境，启动 Python 后端服务...');
    try {
      await startPythonServer();
      logger.info('[Main] 后端启动流程完成，验证 API 就绪...');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[Main] 后端启动失败:', errorMessage);
      isPythonServerReady = false;

      // 后端启动失败属于致命错误，应明确告知用户，而不是显示空白主窗口
      closeSplashWindow();
      dialog.showErrorBox(
        '后端服务启动失败',
        `Precis 无法启动本地后端服务，应用将无法使用。\n\n错误信息：${errorMessage}\n\n请尝试以下步骤：\n1. 检查是否有安全软件阻止了应用运行；\n2. 重新安装应用；\n3. 如问题持续，请将日志文件发送给开发团队。\n\n日志位置：${getLogFilePath() || '未知'}`
      );
      app.quit();
      return;
    }
  } else {
    // 开发环境: 后端由用户手动启动，轮询等待其就绪
    logger.info('[Main] 开发环境，等待外部后端服务就绪...');
  }

  // 统一轮询后端 API，确保真正可响应后再创建主窗口
  const apiReady = await waitForApiReady(currentPythonServerPort, 60000);
  if (apiReady) {
    logger.info('[Main] 后端 API 已就绪，端口:', currentPythonServerPort);
    backendReady = true;
  } else if (hasFrontendBuild) {
    // 生产环境：API 未就绪属于致命错误，直接退出并提示用户
    logger.error('[Main] 后端 API 就绪检测超时，端口:', currentPythonServerPort);
    closeSplashWindow();
    dialog.showErrorBox(
      '后端服务未就绪',
      `Precis 后端服务未能在预期时间内响应请求（端口：${currentPythonServerPort}）。\n\n请尝试重新启动应用。如果问题持续，请检查是否有其他程序占用了端口，或安全软件阻止了后端进程。`
    );
    app.quit();
    return;
  } else {
    // 开发环境：后端可能由用户手动启动，允许继续并显示主窗口
    logger.warn('[Main] 开发环境后端 API 未就绪，继续显示主窗口');
    backendReady = true;
  }

  // 后端已就绪且端口已确定，再创建主窗口并加载前端
  createWindow();

  tryShowMainWindow();

  // 应用启动时自动检查更新（仅在打包环境）
  if (app.isPackaged) {
    // 延迟 3 秒检查，避免影响应用启动速度
    setTimeout(() => {
      updateManager.checkForUpdatesIfAutoEnabled();
    }, 3000);
  }

  // [macOS 特定] 点击 Dock 图标时恢复窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * 所有窗口关闭事件
 * 
 * [平台差异]
 * - Windows/Linux: 关闭窗口会退出应用
 * - macOS: 关闭窗口仅隐藏，应用仍在 Dock 中运行
 * 
 * [进程清理]
 * - 确保 Python 进程被正确终止
 * - 避免僵尸进程
 */
app.on('window-all-closed', () => {
  // 终止 Python 后端进程树，避免窗口关闭后残留僵尸进程
  stopPythonServerSync(pythonProcess);

  // 非 macOS 平台直接退出应用
  // [macOS 约定] 应用应保持运行直到用户明确退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * 应用退出前事件
 * 
 * 用途: 确保在应用完全退出前清理资源
 * 
 * [与 window-all-closed 的区别]
 * - before-quit 在应用退出流程开始时触发
 * - 可以阻止退出流程
 * - 适合执行最后的清理操作
 */
app.on('before-quit', () => {
  stopPythonServerSync(pythonProcess);
  // 刷新文件日志流，确保退出前最后一批日志落盘
  flushLogs();
});

/**
 * 应用退出事件
 * 
 * 用途: 作为最后的保险，确保 Python 进程树已被清理
 */
app.on('quit', () => {
  stopPythonServerSync(pythonProcess);
});
