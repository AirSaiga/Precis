/**
 * @fileoverview Electron 自动更新模块
 *
 * 功能概述:
 * - 管理应用的自动更新流程
 * - 支持 GitHub Releases 和自定义更新服务器
 * - 提供完整的更新状态管理和事件处理
 *
 * 架构设计:
 * - 使用 electron-updater 库处理更新逻辑
 * - 支持两种更新源类型（github / custom）
 * - 通过 IPC 与渲染进程通信
 */

import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';
import { t } from './i18n';
import { appState } from './app-state';
import { stopPythonServerSync } from './pythonProcess';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export interface UpdateConfig {
  sourceType: 'github' | 'custom';
  sourceUrl?: string;
  autoCheck: boolean;
  autoDownload: boolean;
}

const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  sourceType: 'github',
  autoCheck: true,
  autoDownload: false,
};

/**
 * 校验自定义更新源 URL。
 *
 * 威胁模型：渲染进程一旦被 XSS，攻击者可经 update:save-config IPC（或篡改
 * userData/update-config.json 后等待启动重放）把更新源指向恶意 generic 服务器；
 * autoInstallOnAppQuit=true 时，恶意 latest.yml 引导的安装包会在应用退出时静默
 * 安装，形成"更新源劫持 → RCE"链路。因此凡是要 setFeedURL 的 URL 必须通过本校验：
 * - 必须是合法 URL，scheme 仅允许 https；
 * - 本机更新演练（electron/scripts/serve-updates.js 默认 http://localhost:8080）
 *   依赖 http，仅当 host 为 127.0.0.1 / localhost 时放行 http。WHATWG URL 解析器
 *   会把十进制/十六进制简写 IP 归一化（如 2130706433 → 127.0.0.1），归一后仍指向
 *   回环地址才放行；localhost@evil.com、127.0.0.1.evil.com 这类混淆的 hostname
 *   均为 evil.com，直接拒绝；
 * - 其余 http、file:、ftp: 等一律拒绝。
 *
 * @returns 合法返回 null；非法返回拒绝原因（用于日志告警）
 */
export function validateUpdateSourceUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `更新源不是合法 URL: ${url}`;
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = parsed.hostname.toLowerCase();

  if (scheme === 'https') {
    return null;
  }
  if (scheme === 'http' && (host === '127.0.0.1' || host === 'localhost')) {
    return null;
  }
  return `不允许的更新源（scheme=${scheme}, host=${host}）：仅允许 https，或 http + 本机回环地址（127.0.0.1/localhost）`;
}

class UpdateManager {
  private state: UpdateState = { status: 'idle' };
  private config: UpdateConfig = { ...DEFAULT_UPDATE_CONFIG };
  private configPath: string = '';

  constructor() {
    this.init();
  }

  private init(): void {
    this.loadConfig();
    // 持久化的自定义更新源在启动时重放 setFeedURL（修复：此前仅在 saveConfig 时设置，
    // 重启后 autoUpdater 回退到默认 GitHub 源，用户配置的自定义源静默失效）
    this.applyFeedUrl();
    this.setupAutoUpdater();
    this.setupIpcHandlers();
  }

  /**
   * 把配置中的更新源应用到 autoUpdater。
   * github 源无需手动设置 feedURL（electron-updater 自动从 package.json 读取）。
   * custom 源必须先过 validateUpdateSourceUrl 白名单：该函数是启动重放（loadConfig
   * 之后）与保存配置（saveConfig）两条路径共用的最后闸门，配置文件即使被篡改，
   * 非法源也无法进入 setFeedURL。
   */
  private applyFeedUrl(): void {
    if (this.config.sourceType === 'custom' && this.config.sourceUrl) {
      const reason = validateUpdateSourceUrl(this.config.sourceUrl);
      if (reason) {
        // 拒绝应用并告警；不 setFeedURL 时 electron-updater 回退默认 GitHub 源（安全兜底）
        logger.error('[UpdateManager] 拒绝应用非法更新源:', reason, 'url:', this.config.sourceUrl);
        return;
      }
      autoUpdater.setFeedURL({ provider: 'generic', url: this.config.sourceUrl });
    }
  }

  private loadConfig(): void {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'update-config.json');

    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.config = { ...DEFAULT_UPDATE_CONFIG, ...JSON.parse(content) };
      }
    } catch (error) {
      logger.error('[UpdateManager] 加载配置失败:', error);
    }
  }

  public saveConfig(config: Partial<UpdateConfig>): boolean {
    // 保存路径同样过白名单：非法 sourceUrl 直接拒绝保存，不落盘、不应用
    if (config.sourceUrl !== undefined && config.sourceUrl !== null && config.sourceUrl !== '') {
      const reason = validateUpdateSourceUrl(config.sourceUrl);
      if (reason) {
        logger.error('[UpdateManager] 拒绝保存非法更新源:', reason, 'url:', config.sourceUrl);
        return false;
      }
    }

    this.config = { ...this.config, ...config };

    this.applyFeedUrl();

    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.debug('[UpdateManager] 配置已保存');
    } catch (error) {
      logger.error('[UpdateManager] 保存配置失败:', error);
    }
    return true;
  }

  public getConfig(): UpdateConfig {
    return { ...this.config };
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = this.config.autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;
    // Alpha 阶段未签名：关闭差分下载（要求签名一致性）+ 允许降级
    // 正式签名后可移除这两行
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.allowDowngrade = true;

    autoUpdater.on('checking-for-update', () => {
      this.updateState({ status: 'checking' });
      logger.debug('[UpdateManager] 正在检查更新...');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      let releaseNotes: string | undefined;
      if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes;
      } else if (info.releaseNotes && info.releaseNotes.length > 0) {
        const note = info.releaseNotes[0]?.note;
        releaseNotes = note ?? undefined;
      }

      this.updateState({
        status: 'update-available',
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes,
      });
      logger.debug('[UpdateManager] 发现新版本:', info.version);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateState({
        status: 'update-not-available',
        version: info.version,
      });
      logger.debug('[UpdateManager] 当前已是最新版本');
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateState({
        status: 'downloading',
        progress: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateState({
        status: 'downloaded',
        version: info.version,
        releaseDate: info.releaseDate,
      });
      logger.debug('[UpdateManager] 更新已下载完成:', info.version);
    });

    autoUpdater.on('error', (error: Error) => {
      this.updateState({
        status: 'error',
        error: error.message,
      });
      logger.error('[UpdateManager] 更新错误:', error);
    });
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('update:get-status', async () => {
      return this.state;
    });

    ipcMain.handle('update:get-config', async () => {
      return this.getConfig();
    });

    ipcMain.handle('update:save-config', async (event, config: Partial<UpdateConfig>) => {
      // 更新源是 XSS → 更新劫持链路的关键入口：saveConfig 内部会对 sourceUrl
      // 做 validateUpdateSourceUrl 白名单校验，非法时拒绝保存并返回 false，
      // 渲染进程设置面板据此提示失败。
      const saved = this.saveConfig(config);
      if (!saved) {
        return false;
      }
      autoUpdater.autoDownload = this.config.autoDownload;
      return true;
    });

    ipcMain.handle('update:check', async () => {
      logger.debug('[UpdateManager] 收到检查更新请求');

      try {
        await autoUpdater.checkForUpdates();
        return this.state;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t('fs.unknownError');
        this.updateState({ status: 'error', error: errorMessage });
        return this.state;
      }
    });

    ipcMain.handle('update:download', async () => {
      if (this.state.status !== 'update-available') {
        return { success: false, error: t('update.noUpdateAvailable') };
      }

      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : t('update.downloadFailed');
        return { success: false, error: errorMessage };
      }
    });

    ipcMain.handle('update:install', async () => {
      if (this.state.status !== 'downloaded') {
        return { success: false, error: t('update.downloadNotComplete') };
      }

      // NSIS 安装器需要整目录覆盖 resources（backend/python-runtime 都在 extraResources），
      // 必须在退出前同步终止 Python 子进程树，否则文件被占用导致安装失败。
      // before-quit 钩子会兜底再清理一次（stopPythonServerSync 幂等，null 引用直接返回）。
      stopPythonServerSync(appState.pythonProcess);

      autoUpdater.quitAndInstall();
      return { success: true };
    });
  }

  private updateState(newState: Partial<UpdateState>): void {
    this.state = { ...this.state, ...newState };
    // 主 → 渲染推送：渲染进程经 update:state-changed 事件驱动 UI，轮询仅作兜底
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('update:state-changed', this.state);
      }
    }
  }

  public getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * 应用启动时检查更新（如果配置了 autoCheck）
   */
  public async checkForUpdatesIfAutoEnabled(): Promise<void> {
    if (!this.config.autoCheck) {
      logger.debug('[UpdateManager] 自动检查更新已关闭，跳过');
      return;
    }

    if (!app.isPackaged) {
      logger.debug('[UpdateManager] 开发环境，跳过自动更新检查');
      return;
    }

    logger.debug('[UpdateManager] 启动时自动检查更新...');
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      logger.error('[UpdateManager] 自动检查更新失败:', errorMessage);
    }
  }
}

export const updateManager = new UpdateManager();
export default updateManager;
