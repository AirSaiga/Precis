/**
 * @file filesystem.ts
 * @description 文件系统 IPC handler（从 main.ts 抽出）
 *
 * 提供文件/目录操作相关的 IPC：
 * - ensure-dir：确保目录存在
 * - show-open-dialog / reselect-file：文件选择对话框
 * - check-file-exists：文件存在性检查
 * - open-file：用系统默认程序打开文件
 * - save-text-file / load-text-file：用户数据目录文本文件读写
 * - scan-directory：递归扫描目录（含 scanDirectoryRecursive 辅助）
 *
 * 依赖：app/path/fs/dialog/shell/BrowserWindow/logger。无共享状态依赖。
 */

import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../logger';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 递归扫描目录下的所有文件
 *
 * 使用深度优先遍历：遇到目录递归进入，遇到文件检查扩展名后加入结果。
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

// ============================================================================
// IPC 注册
// ============================================================================

/**
 * 注册文件系统相关 IPC handler
 */
export function registerFilesystemIpc(): void {
  // ---- ensure-dir ----
  ipcMain.handle('ensure-dir', async (_event, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) return false;
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  });

  // ---- show-open-dialog ----
  ipcMain.handle(
    'show-open-dialog',
    async (
      event,
      options: {
        title?: string;
        buttonLabel?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: Array<
          | 'openFile'
          | 'openDirectory'
          | 'multiSelections'
          | 'showHiddenFiles'
          | 'createDirectory'
          | 'promptToCreate'
          | 'noResolveAliases'
          | 'treatPackageAsDirectory'
          | 'dontAddToRecent'
        >;
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        title: options.title || '选择文件',
        buttonLabel: options.buttonLabel || '选择',
        filters: options.filters,
        properties: options.properties,
      };

      if (win) {
        return await dialog.showOpenDialog(win, dialogOptions);
      } else {
        return await dialog.showOpenDialog(dialogOptions);
      }
    }
  );

  // ---- check-file-exists ----
  ipcMain.handle('check-file-exists', async (_event, filePath: string) => {
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

  // ---- reselect-file ----
  ipcMain.handle(
    'reselect-file',
    async (
      event,
      options: {
        title?: string;
        buttonLabel?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
      }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        title: options.title || '重新选择文件',
        buttonLabel: options.buttonLabel || '确认',
        filters: options.filters,
        properties: options.properties,
      };

      if (win) {
        return await dialog.showOpenDialog(win, dialogOptions);
      } else {
        return await dialog.showOpenDialog(dialogOptions);
      }
    }
  );

  // ---- open-file ----
  ipcMain.handle('open-file', async (_event, filePath: string) => {
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

  // ---- save-text-file ----
  ipcMain.handle('save-text-file', async (_event, fileName: string, content: string) => {
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

  // ---- load-text-file ----
  ipcMain.handle('load-text-file', async (_event, fileName: string) => {
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

  // ---- scan-directory ----
  ipcMain.handle(
    'scan-directory',
    async (
      _event,
      options: {
        dirPath: string;
        allowedExtensions?: string[];
      }
    ) => {
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
    }
  );
}
