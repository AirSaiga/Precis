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
import * as path from 'path';
import * as fs from 'fs';
import { updateManager } from './update';
import { getBackendPath, getFrontendPath } from './utils/paths';
import { logger, getLogFilePath, flushLogs } from './logger';
import { waitForApiReady } from './startup-probe';
import { registerAllIpc } from './ipc';
import { ensureFeedbackDir, getPendingCrashPath } from './ipc/feedback';
import { appState } from './app-state';
import {
  startPythonServer,
  stopPythonServer,
  stopPythonServerSync,
} from './pythonProcess';

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
// 全局状态管理（8 个原裸 let 已迁移到 app-state.ts 的 appState 单一容器）
// 详见 app-state.ts。下方代码通过 appState.xxx 读写状态。
// ============================================================================

/**
 * Splash 启动状态机的阶段类型(线性推进)
 *
 * 状态流:
 * - 生产环境: initializing → starting → connecting → loading → done
 * - 开发环境: initializing → connecting → loading → done(跳过 starting)
 * - 失败时: 任意阶段 → error
 */
type SplashStage = 'initializing' | 'starting' | 'connecting' | 'loading' | 'done' | 'error';

/**
 * 向 Splash 窗口推送当前启动阶段状态
 *
 * 安全守卫:splash 窗口可能未创建或已销毁,此时静默丢弃消息(可接受,
 * 因为初始状态已是 initializing,splash.html 默认显示该状态)。
 *
 * @param stage - 启动阶段
 * @param error - 是否为错误状态(失败时 spinner 变红)
 */
function sendSplashStage(stage: SplashStage, error: boolean = false): void {
  if (!appState.splashWindow || appState.splashWindow.isDestroyed()) return;
  appState.splashWindow.webContents.send('splash:stage', { stage, error });
}

/**
 * 创建 Splash Screen（启动画面）
 *
 * 在应用启动时立即显示一个小型无边框窗口，展示品牌信息和加载动画。
 * 主窗口 ready-to-show 后自动关闭。
 */
function createSplashWindow(): void {
  appState.splashWindow = new BrowserWindow({
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
      preload: path.join(__dirname, 'splash-preload.js'), // Splash 专用 preload,暴露 splashAPI
    },
  });

  const splashPath = path.join(__dirname, '..', 'assets', 'splash.html');
  appState.splashWindow.loadFile(splashPath);

  appState.splashWindow.once('ready-to-show', () => {
    appState.splashWindow?.show();
    // splash 渲染进程就绪后,推送初始状态(此时 IPC 监听已注册)。
    // 生产环境紧接 'starting'(后端 spawn 前的漫长阶段),开发环境跳过。
    sendSplashStage('initializing');
    if (appState.isBackendSpawnEnvironment) {
      // 生产环境:紧接 'starting'(后端 spawn 前的漫长阶段)
      sendSplashStage('starting');
    } else {
      // 开发环境:不 spawn 后端,'connecting' 是首个真实状态(等待用户手动启动的后端)。
      // 在此发送而非启动流程中,避免 createSplashWindow 的 loadFile 尚未完成时竞态丢消息。
      sendSplashStage('connecting');
    }
  });

  appState.splashWindow.on('closed', () => {
    appState.splashWindow = null;
  });
}

/**
 * 关闭 Splash Screen
 *
 * 带渐隐动画效果，避免突兀消失。
 */
function closeSplashWindow(): void {
  if (!appState.splashWindow) return;
  if (appState.splashWindow.isDestroyed()) {
    appState.splashWindow = null;
    return;
  }
  appState.splashWindow.close();
  appState.splashWindow = null;
}

/**
 * 尝试关闭 Splash 并显示主窗口
 *
 * 改造点(原为同步立即关闭 splash):
 * 1. 先 sendSplashStage('done') —— 触发 splash 渲染进程启动淡出动画(CSS opacity → 0)
 * 2. 主窗口立即 show + focus —— 用户立即获得可交互界面,无需等待 splash 动画
 * 3. 延迟销毁 splash(setTimeout 320ms)—— 等淡出动画(~300ms)跑完再销毁窗口
 *
 * splash 在淡出期间仍 alwaysOnTop 覆盖在主窗口之上,属预期行为(半透明渐隐,不遮挡交互)。
 */
function tryShowMainWindow(): void {
  if (!appState.mainWindowReady) return;
  if (!appState.backendReady) return;
  if (!appState.mainWindow) return;
  sendSplashStage('done');
  appState.mainWindow.show();
  appState.mainWindow.focus();
  // 延迟销毁 splash,让淡出动画跑完(~300ms 动画 + 20ms 余量)
  setTimeout(() => {
    closeSplashWindow();
  }, 320);
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
  appState.mainWindow = new BrowserWindow({
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
    appState.mainWindow.loadURL(`http://localhost:${FRONTEND_DEV_PORT}`);
    
    // 自动打开开发者工具，便于调试
    appState.mainWindow.webContents.openDevTools();
  } else {
    // 生产环境: 通过自定义 app:// 协议加载本地打包文件
    // 使用自定义协议替代 file://，避免 CORS 限制和 webSecurity 问题
    logger.debug('[Main] 生产模式: 通过 app:// 协议加载本地文件');
    appState.mainWindow.loadURL(`app://./index.html`);
    
    // 生产环境可选开发者工具
    // appState.mainWindow.webContents.openDevTools();
  }

  // 窗口首次渲染完成时标记就绪
  // 实际显示由 tryShowMainWindow() 统一控制，需等待后端也就绪
  appState.mainWindow.once('ready-to-show', () => {
    appState.mainWindowReady = true;
    tryShowMainWindow();
  });

  // 窗口关闭时清理引用
  // 防止内存泄漏
  appState.mainWindow.on('closed', () => {
    appState.mainWindow = null;
  });

  // 配置外部链接处理策略
  // [用户体验] 点击链接时使用系统默认浏览器打开
  // [安全] 阻止在新窗口中打开链接，避免弹出窗口滥用
  appState.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 渲染进程崩溃监听:此时 Vue 已死,只能用原生 dialog 兜底。
  // 将崩溃记录写入 pending-crash.json,重启后由前端读出并补弹反馈窗口。
  appState.mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('[Main] 渲染进程崩溃:', details.reason, 'exitCode:', details.exitCode);
    try {
      ensureFeedbackDir();
      const pending = {
        source: 'main-process',
        message: `渲染进程意外退出 (${details.reason})`,
        timestamp: new Date().toISOString(),
        exitCode: details.exitCode,
      };
      fs.writeFileSync(getPendingCrashPath(), JSON.stringify(pending, null, 2), 'utf-8');
    } catch (err) {
      logger.error('[Main] 写入 pending crash 失败:', err);
    }

    const choice = dialog.showMessageBoxSync(appState.mainWindow!, {
      type: 'error',
      title: '应用遇到问题',
      message: '渲染进程意外退出',
      detail: `原因: ${details.reason}\n崩溃记录已保存,重启后将提示您导出反馈。`,
      buttons: ['重启应用', '退出'],
      noLink: true,
    });
    if (choice === 0) {
      app.relaunch();
      app.exit(0);
    } else {
      app.quit();
    }
  });

  // 渲染进程无响应监听(可能是长任务卡死,不强制退出,仅记录)
  appState.mainWindow.webContents.on('unresponsive', () => {
    logger.warn('[Main] 渲染进程无响应');
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
 * - pythonReady: 来自全局状态变量 appState.isPythonServerReady
 * - port: 来自动态分配的 appState.currentPythonServerPort
 * - frontendPort: 前端开发服务器端口
 */
ipcMain.handle('get-server-status', async () => {
  return {
    pythonReady: appState.isPythonServerReady,
    port: appState.currentPythonServerPort,
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
    const port = await startPythonServer(BACKEND_PATH);
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
 * [IPC] 获取应用版本号(供 Splash 窗口显示)
 *
 * Splash 在启动早期需要显示版本号,但其自身无 app 引用,
 * 通过此 IPC 从主进程查询。与 get-app-version 逻辑相同,
 * 但走独立通道以保持 splash IPC 命名空间隔离(splash:*)。
 */
ipcMain.handle('splash:get-version', async () => {
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
  // 标记是否需要本地启动后端,供 splash 状态机判断是否推送 'starting' 阶段
  appState.isBackendSpawnEnvironment = hasFrontendBuild;

  // 尽早设置默认应用菜单栏: 生产环境隐藏, 开发环境保留默认菜单方便调试
  // 业务场景: 应用通过前端 UI 提供全部操作入口, 无需系统菜单
  // 平台差异:
  // - Windows/Linux: 菜单栏默认隐藏
  // - macOS: 屏幕顶部仍保留应用名菜单(系统强制), 但 File/Edit/View 等子菜单不再显示
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  // 注册 IPC handler（config/filesystem/feedback/logs）
  // 必须在 createWindow 之前，确保渲染进程 ready 后 invoke 任何 handler 都已就位
  registerAllIpc();

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
      await startPythonServer(BACKEND_PATH);
      logger.info('[Main] 后端启动流程完成，验证 API 就绪...');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[Main] 后端启动失败:', errorMessage);
      appState.isPythonServerReady = false;

      // 发送错误状态让 splash 变红提示,停顿让用户看清后再弹原生错误框
      sendSplashStage('error', true);
      await new Promise((resolve) => setTimeout(resolve, 800));

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
  // 生产环境在此推送 'connecting'(后端已 spawn,转为等待 API 就绪);
  // 开发环境已在 splash ready-to-show 中推送过,此处跳过避免重复。
  if (appState.isBackendSpawnEnvironment) {
    sendSplashStage('connecting');
  }
  const apiReady = await waitForApiReady(appState.currentPythonServerPort, 60000);
  if (apiReady) {
    logger.info('[Main] 后端 API 已就绪，端口:', appState.currentPythonServerPort);
    appState.backendReady = true;
  } else if (hasFrontendBuild) {
    // 生产环境：API 未就绪属于致命错误，直接退出并提示用户
    logger.error('[Main] 后端 API 就绪检测超时，端口:', appState.currentPythonServerPort);
    sendSplashStage('error', true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    closeSplashWindow();
    dialog.showErrorBox(
      '后端服务未就绪',
      `Precis 后端服务未能在预期时间内响应请求（端口：${appState.currentPythonServerPort}）。\n\n请尝试重新启动应用。如果问题持续，请检查是否有其他程序占用了端口，或安全软件阻止了后端进程。`
    );
    app.quit();
    return;
  } else {
    // 开发环境：后端可能由用户手动启动，允许继续并显示主窗口
    logger.warn('[Main] 开发环境后端 API 未就绪，继续显示主窗口');
    appState.backendReady = true;
  }

  // 后端已就绪且端口已确定，再创建主窗口并加载前端
  sendSplashStage('loading');
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
  stopPythonServerSync(appState.pythonProcess);

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
  stopPythonServerSync(appState.pythonProcess);
  // 刷新文件日志流，确保退出前最后一批日志落盘
  flushLogs();
});

/**
 * 应用退出事件
 * 
 * 用途: 作为最后的保险，确保 Python 进程树已被清理
 */
app.on('quit', () => {
  stopPythonServerSync(appState.pythonProcess);
});
