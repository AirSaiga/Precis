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
import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

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

class UpdateManager {
  private state: UpdateState = { status: 'idle' };
  private config: UpdateConfig = { ...DEFAULT_UPDATE_CONFIG };
  private configPath: string = '';

  constructor() {
    this.init();
  }

  private init(): void {
    this.loadConfig();
    this.setupAutoUpdater();
    this.setupIpcHandlers();
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
      console.error('[UpdateManager] 加载配置失败:', error);
    }
  }

  public saveConfig(config: Partial<UpdateConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.config.sourceType === 'custom' && this.config.sourceUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: this.config.sourceUrl });
    }
    // github 源无需手动设置 feedURL，electron-updater 会自动从 package.json repository 读取

    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log('[UpdateManager] 配置已保存');
    } catch (error) {
      console.error('[UpdateManager] 保存配置失败:', error);
    }
  }

  public getConfig(): UpdateConfig {
    return { ...this.config };
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = this.config.autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.updateState({ status: 'checking' });
      console.log('[UpdateManager] 正在检查更新...');
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
      console.log('[UpdateManager] 发现新版本:', info.version);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateState({
        status: 'update-not-available',
        version: info.version,
      });
      console.log('[UpdateManager] 当前已是最新版本');
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
      console.log('[UpdateManager] 更新已下载完成:', info.version);
    });

    autoUpdater.on('error', (error: Error) => {
      this.updateState({
        status: 'error',
        error: error.message,
      });
      console.error('[UpdateManager] 更新错误:', error);
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
      this.saveConfig(config);
      autoUpdater.autoDownload = this.config.autoDownload;
      return true;
    });

    ipcMain.handle('update:check', async () => {
      console.log('[UpdateManager] 收到检查更新请求');

      try {
        await autoUpdater.checkForUpdates();
        return this.state;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        this.updateState({ status: 'error', error: errorMessage });
        return this.state;
      }
    });

    ipcMain.handle('update:download', async () => {
      if (this.state.status !== 'update-available') {
        return { success: false, error: '没有可用的更新' };
      }

      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '下载失败';
        return { success: false, error: errorMessage };
      }
    });

    ipcMain.handle('update:install', async () => {
      if (this.state.status !== 'downloaded') {
        return { success: false, error: '更新未下载完成' };
      }

      autoUpdater.quitAndInstall();
      return { success: true };
    });
  }

  private updateState(newState: Partial<UpdateState>): void {
    this.state = { ...this.state, ...newState };
  }

  public getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * 应用启动时检查更新（如果配置了 autoCheck）
   */
  public async checkForUpdatesIfAutoEnabled(): Promise<void> {
    if (!this.config.autoCheck) {
      console.log('[UpdateManager] 自动检查更新已关闭，跳过');
      return;
    }

    if (!app.isPackaged) {
      console.log('[UpdateManager] 开发环境，跳过自动更新检查');
      return;
    }

    console.log('[UpdateManager] 启动时自动检查更新...');
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('[UpdateManager] 自动检查更新失败:', errorMessage);
    }
  }
}

export const updateManager = new UpdateManager();
export default updateManager;
