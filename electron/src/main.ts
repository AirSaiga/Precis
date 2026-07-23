/**
 * @fileoverview Electron 主进程入口文件（瘦编排层，God 拆分批次3 后）
 *
 * 本文件是主进程的编排入口，原 1921 行单体已拆分为多个职责模块：
 * - app-state.ts：全局状态单一容器（8 个原裸 let，规避 commonjs 导出陷阱）
 * - constants.ts：共享常量（端口、超时）
 * - startup-probe.ts：后端启动信号检测 + 端口/API 轮询（纯函数）
 * - pythonProcess.ts：Python 子进程启停 + 进程树终止
 * - protocol.ts：app:// 自定义协议（⚠ 时序铁律：scheme 声明 whenReady 前，handler whenReady 内）
 * - windows/splashWindow.ts + mainWindow.ts：窗口管理
 * - ipc/：全部 IPC handler（config/filesystem/feedback/appInfo/backend）
 * - logger.ts / update.ts / utils/paths.ts（既有模块）
 *
 * 本文件职责（约 260 行）：
 * 1. 模块级：registerAppScheme()（协议特权声明，whenReady 前同步）
 * 2. whenReady 内：环境判断 → registerAllIpc → registerAppProtocolHandler →
 *    createSplashWindow → startPythonServer → createWindow → tryShowMainWindow
 *    （启动顺序铁律：必须先 startPythonServer 再 createWindow，否则端口未分配）
 * 3. 退出钩子：window-all-closed / before-quit / quit 三钩子都调 stopPythonServerSync
 *
 * ⚠️ 功能正确性需手动启动验证（dev + 生产打包）：后端启动、窗口显示、
 * IPC 响应、崩溃重放、退出清理（无僵尸 Python 进程）。
 */

import { app, BrowserWindow, Menu, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { updateManager } from './update';
import { getBackendPath, getFrontendPath } from './utils/paths';
import { logger, getLogFilePath, flushLogs } from './logger';
import { waitForApiReady, readBackendPortFile } from './startup-probe';
import { registerAllIpc } from './ipc';
import { ensureFeedbackDir, getPendingCrashPath } from './ipc/feedback';
import { appState } from './app-state';
import {
  startPythonServer,
  stopPythonServer,
  stopPythonServerSync,
} from './pythonProcess';
import { createSplashWindow, closeSplashWindow, sendSplashStage } from './windows/splashWindow';
import { createWindow, tryShowMainWindow } from './windows/mainWindow';
import { registerAppScheme, registerAppProtocolHandler } from './protocol';

/**
 * Vue 前端开发服务器的默认端口
 * 可通过环境变量 FRONTEND_DEV_PORT 覆盖
 * 与 frontend/vite.config.ts 中的配置保持一致
 */
const FRONTEND_DEV_PORT = parseInt(process.env.VITE_FRONTEND_PORT || '5173', 10);

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
// 自定义协议注册：app:// scheme 特权声明
// ⚠️ 时序铁律：registerAppScheme 必须在 app.whenReady 之前同步执行（模块加载时），
// registerAppProtocolHandler 必须在 whenReady 内执行。详见 protocol.ts。
// ============================================================================
registerAppScheme();

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
  // PRECIS_FORCE_DEV=1（由 start-dev.bat / start-electron.bat 注入）强制开发模式：
  // 即使存在 frontend/dist 构建产物，也不自启后端、不加载静态产物，改为等待外部后端 + Vite。
  // 仅未打包环境生效，打包应用始终忽略该变量。
  const forceDev = !app.isPackaged && process.env.PRECIS_FORCE_DEV === '1';
  const hasFrontendBuild = fs.existsSync(indexPath) && !forceDev;
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

  // 注册 IPC handler（config/filesystem/feedback/appInfo/backend）
  // 必须在 createWindow 之前，确保渲染进程 ready 后 invoke 任何 handler 都已就位
  registerAllIpc({ backendPath: BACKEND_PATH, frontendDevPort: FRONTEND_DEV_PORT });

  // 注册 app:// 协议处理器（whenReady 内，映射到前端构建目录）
  // ⚠️ protocol.handle 必须在 whenReady 内，与模块级的 registerAppScheme 时序分离
  registerAppProtocolHandler(FRONTEND_PATH);

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

  // 后端就绪确认:
  // - 生产环境(hasFrontendBuild):startPythonServer 内部已轮询 /docs 确认 API 就绪,
  //   此处无需重复轮询。此处仅推送 splash 阶段。
  // - 开发环境(外部后端):需轮询端口文件发现端口 + 确认 API 就绪(宽容超时)。
  if (hasFrontendBuild) {
    // 生产环境:startPythonServer 已 resolve,后端确定就绪
    sendSplashStage('connecting');
    appState.backendReady = true;
    logger.info('[Main] 后端 API 已就绪，端口:', appState.currentPythonServerPort);
  } else {
    // 开发环境:后端由外部手动启动,先读端口文件发现端口,再轮询 API 就绪
    const externalPort = await readBackendPortFile(BACKEND_PATH, 60000);
    if (externalPort !== null) {
      logger.info('[Main] 开发环境,从端口文件发现后端端口:', externalPort);
      appState.currentPythonServerPort = externalPort;
      const apiReady = await waitForApiReady(externalPort, 30000);
      if (apiReady) {
        appState.backendReady = true;
        appState.isPythonServerReady = true;
        logger.info('[Main] 开发环境后端 API 已就绪');
      } else {
        logger.warn('[Main] 开发环境后端 API 未就绪，继续显示主窗口');
        appState.backendReady = true;
      }
    } else {
      // 端口文件始终未出现:后端可能尚未启动,宽容地继续显示主窗口
      logger.warn('[Main] 开发环境未发现后端端口文件，继续显示主窗口');
      appState.backendReady = true;
    }
  }

  // 后端已就绪且端口已确定，再创建主窗口并加载前端
  sendSplashStage('loading');
  createWindow({ frontendPath: FRONTEND_PATH, frontendDevPort: FRONTEND_DEV_PORT });

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
      createWindow({ frontendPath: FRONTEND_PATH, frontendDevPort: FRONTEND_DEV_PORT });
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
  // [平台差异] 后端进程清理策略:
  // - Windows/Linux: 窗口全关即退出应用,终止后端进程树,避免僵尸进程。
  // - macOS: 应用保持运行(符合 macOS 约定),后端进程也保持常驻。
  //   旧实现无条件杀后端,导致用户点 Dock 重建窗口时后端已是僵尸态(主窗口显示但无后端)。
  //   macOS 后端仅在 before-quit/quit 时随应用退出清理。
  if (process.platform !== 'darwin') {
    stopPythonServerSync(appState.pythonProcess);
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
