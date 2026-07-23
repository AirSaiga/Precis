/**
 * @file mainWindow.ts
 * @description 主窗口管理（从 main.ts 抽出）
 *
 * 提供主窗口的创建与显示控制：
 * - createWindow：创建主窗口，根据环境加载 dev server / app:// 协议
 * - tryShowMainWindow：三重 ready 守卫（mainWindowReady && backendReady && mainWindow）
 *
 * tryShowMainWindow 三重守卫：只有当主窗口渲染就绪、后端就绪、窗口实例存在三者
 * 同时满足时才显示主窗口并关闭 splash。这是启动时序的关键协调点。
 *
 * createWindow 内的渲染进程崩溃监听（render-process-gone）写入 pending-crash.json，
 * 重启后由前端读出补弹反馈窗口。
 *
 * 依赖：BrowserWindow/shell/dialog/app + path/fs + appState + logger +
 *      splashWindow(closeSplashWindow) + ipc/feedback(ensureFeedbackDir/getPendingCrashPath)
 */

import { app, BrowserWindow, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { appState } from '../app-state';
import { logger } from '../logger';
import { ensureFeedbackDir, getPendingCrashPath } from '../ipc/feedback';
import { closeSplashWindow, sendSplashStage } from './splashWindow';
import { getPreloadPath } from '../utils/paths';

/** createWindow 所需的运行时路径配置（由 main.ts 注入） */
export interface WindowConfig {
  /** 前端构建产物目录（生产环境用 app:// 协议映射） */
  frontendPath: string;
  /** 前端开发服务器端口（开发环境 loadURL） */
  frontendDevPort: number;
}

/**
 * 尝试显示主窗口（三重 ready 守卫）
 *
 * 只有当 mainWindowReady && backendReady && mainWindow 三者同时满足时，
 * 才推送 splash 'done' 阶段、显示主窗口、延迟关闭 splash（等淡出动画）。
 */
export function tryShowMainWindow(): void {
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
 * 根据环境加载开发服务器（isDev）或 app:// 协议（生产）。
 * 配置 webPreferences 安全选项（nodeIntegration: false, contextIsolation: true, sandbox: true）。
 * 注册窗口事件：ready-to-show（触发 tryShowMainWindow）、closed（清理引用）、
 * setWindowOpenHandler（外部链接系统浏览器打开）、render-process-gone（崩溃重放）、unresponsive。
 *
 * @param config - 前端路径配置（frontendPath + frontendDevPort）
 */
export function createWindow(config: WindowConfig): void {
  const { frontendPath, frontendDevPort } = config;
  // 判断当前环境（PRECIS_FORCE_DEV=1 时即使存在构建产物也强制开发模式，见 main.ts）
  const indexPath = path.join(frontendPath, 'index.html');
  const forceDev = !app.isPackaged && process.env.PRECIS_FORCE_DEV === '1';
  const hasFrontendBuild = fs.existsSync(indexPath) && !forceDev;
  const isDev = !app.isPackaged && !hasFrontendBuild;

  // 创建浏览器窗口实例
  appState.mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1200, // 最小宽度约束，保证画布操作区可用
    minHeight: 800, // 最小高度约束，保证面板信息完整显示
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: getPreloadPath(__dirname),
    },
    titleBarStyle: 'default', // 使用系统默认标题栏
    autoHideMenuBar: !isDev, // 生产环境隐藏传统菜单栏，开发环境保留方便调试
    show: false, // 先创建后显示，避免闪烁
    backgroundColor: '#ffffff', // 白色背景避免透明闪烁
  });

  // 调试信息
  logger.debug('[Main] __dirname:', __dirname);
  logger.debug('[Main] frontendPath:', frontendPath);
  logger.debug('[Main] indexPath:', indexPath);
  logger.debug('[Main] hasFrontendBuild:', hasFrontendBuild);
  logger.debug('[Main] isPackaged:', app.isPackaged);
  logger.debug('[Main] NODE_ENV:', process.env.NODE_ENV);
  logger.debug('[Main] isDev:', isDev);

  // 根据环境选择加载方式
  if (isDev) {
    // 开发环境: 连接到 Vite 开发服务器
    logger.debug('[Main] 开发模式: 连接到 Vite 开发服务器');
    logger.debug('[Main] 开发服务器地址:', `http://localhost:${frontendDevPort}`);
    appState.mainWindow.loadURL(`http://localhost:${frontendDevPort}`);

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
