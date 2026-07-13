/**
 * @file splashWindow.ts
 * @description Splash 启动窗口管理（从 main.ts 抽出）
 *
 * 提供 Splash 窗口的创建、关闭、状态推送：
 * - sendSplashStage：向 splash 推送启动阶段（initializing/starting/connecting/loading/done/error）
 * - createSplashWindow：创建 splash 窗口并加载 splash.html
 * - closeSplashWindow：带渐隐效果关闭 splash
 *
 * Splash 状态机（线性推进）：
 * - 生产环境: initializing → starting → connecting → loading → done
 * - 开发环境: initializing → connecting → loading → done（跳过 starting）
 * - 失败时: 任意阶段 → error
 *
 * 依赖：BrowserWindow + path + appState + logger。无 Python/IPC 依赖。
 */

import { BrowserWindow } from 'electron';
import * as path from 'path';
import { appState } from '../app-state';

/** Splash 启动状态机的阶段类型(线性推进) */
export type SplashStage =
  | 'initializing'
  | 'starting'
  | 'connecting'
  | 'loading'
  | 'done'
  | 'error';

/**
 * 向 Splash 窗口推送当前启动阶段状态
 *
 * 安全守卫:splash 窗口可能未创建或已销毁,此时静默丢弃消息(可接受,
 * 因为初始状态已是 initializing,splash.html 默认显示该状态)。
 *
 * @param stage - 启动阶段
 * @param error - 是否为错误状态(失败时 spinner 变红)
 */
export function sendSplashStage(stage: SplashStage, error: boolean = false): void {
  if (!appState.splashWindow || appState.splashWindow.isDestroyed()) return;
  appState.splashWindow.webContents.send('splash:stage', { stage, error });
}

/**
 * 创建 Splash Screen（启动画面）
 *
 * 在应用启动时立即显示一个小型无边框窗口，展示品牌信息和加载动画。
 * 主窗口 ready-to-show 后自动关闭。
 */
export function createSplashWindow(): void {
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
export function closeSplashWindow(): void {
  if (!appState.splashWindow) return;
  if (appState.splashWindow.isDestroyed()) {
    appState.splashWindow = null;
    return;
  }
  appState.splashWindow.close();
  appState.splashWindow = null;
}
