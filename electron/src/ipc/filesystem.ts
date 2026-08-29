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
import * as yaml from 'js-yaml';
import { logger } from '../logger';
import { t } from '../i18n';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 递归扫描目录下的所有文件
 *
 * 使用深度优先遍历：遇到目录递归进入，遇到文件检查扩展名后加入结果。
 * 注意：顶层目录已由调用方做 lstat 校验（防符号链接逃逸），递归内部沿用
 * withFileTypes 直接判断条目类型（readdirSync 的 dirent 不跟随符号链接）。
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
// 路径安全：根目录白名单包含校验
// ============================================================================
//
// 设计动机：renderer 进程可能被 XSS 攻击，任何经 window.electronAPI 传入的
// 文件路径都不可信。旧的"resolve 后与原值/normalize 比较"写法对绝对路径含 '..'
// 时失效（path.resolve 与 path.normalize 输出相同字符串，比较恒为真），形同虚设。
// 这里改为严格的根目录包含校验：路径必须落在 userData 或当前项目目录之下。
//
// 项目目录来自 electron_launch.yaml（由 save-config 写入），是用户在启动器里
// 显式选择的项目根；dataPath 为数据源目录，同属用户授权范围。

/**
 * 读取 electron_launch.yaml 中保存的项目配置目录与数据源目录。
 * 失败或缺省时返回空数组（调用方据此只允许 userData 根）。
 */
function loadProjectRoots(): string[] {
  try {
    const configFile = path.join(app.getPath('userData'), '.precis', 'electron_launch.yaml');
    if (!fs.existsSync(configFile)) return [];
    const parsed = yaml.load(fs.readFileSync(configFile, 'utf-8')) as {
      configPath?: string;
      dataPath?: string;
    } | null;
    const roots: string[] = [];
    if (parsed?.configPath) roots.push(parsed.configPath);
    if (parsed?.dataPath) roots.push(parsed.dataPath);
    return roots;
  } catch {
    return [];
  }
}

/**
 * 计算当前所有合法根目录（已规范化、去重、去空）。
 * - userData 根：app 自身配置目录（read-file 读项目清单等落在这里或项目目录）
 * - 项目 configPath / dataPath：用户在启动器授权的项目与数据目录
 */
function getAllowedRoots(): string[] {
  const roots = [app.getPath('userData'), ...loadProjectRoots()];
  const normalized = roots
    .filter((r): r is string => !!r && typeof r === 'string')
    .map((r) => path.resolve(r));
  return Array.from(new Set(normalized));
}

/**
 * 判断 resolved 路径是否落在任一合法根目录之下（含根本身）。
 * 必须用 resolved.startsWith(root + path.sep) 而非简单 startsWith(root)，
 * 否则根 "C:\proj" 会放行 "C:\project-evil"。
 */
function isPathAllowed(resolved: string, roots: string[]): boolean {
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/**
 * open-file 允许的扩展名白名单：仅数据文件，拒绝可执行/脚本，防止 shell.openPath 触发代码执行。
 */
const OPEN_FILE_ALLOWED_EXTENSIONS = new Set([
  '.csv', '.tsv', '.xlsx', '.xls',
  '.json', '.jsonl', '.ndjson',
  '.yaml', '.yml',
  '.txt', '.md', '.log',
  '.parquet', '.feather',
]);

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
        title: options.title || t('dialog.selectFile'),
        buttonLabel: options.buttonLabel || t('dialog.selectButton'),
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
        title: options.title || t('dialog.reselectFile'),
        buttonLabel: options.buttonLabel || t('dialog.confirmButton'),
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
  // 用系统默认程序打开数据文件。
  // 安全：限制为数据文件扩展名白名单，拒绝可执行/脚本（.exe/.bat/.ps1/.scr/.cmd
  // 及无扩展名路径），防止 shell.openPath 触发任意代码执行。
  // 同时做根目录包含校验，与 read/write-file 一致。
  ipcMain.handle('open-file', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: t('fs.invalidPath') };
      }

      if (!path.isAbsolute(filePath)) {
        logger.error('[Electron] open-file: 路径必须是绝对路径:', filePath);
        return { success: false, error: t('fs.pathMustBeAbsolute') };
      }

      const resolved = path.resolve(filePath);
      const roots = getAllowedRoots();
      if (!isPathAllowed(resolved, roots)) {
        logger.error('[Electron] open-file: 路径不在允许的根目录之下:', filePath);
        return { success: false, error: t('fs.pathOutsideAllowed') };
      }

      const ext = path.extname(resolved).toLowerCase();
      if (!ext || !OPEN_FILE_ALLOWED_EXTENSIONS.has(ext)) {
        logger.error('[Electron] open-file: 拒绝打开非数据文件扩展名:', ext || '(无扩展名)', filePath);
        return {
          success: false,
          error: t('fs.fileTypeNotAllowed', { ext: ext || t('fs.noExtension') }),
        };
      }

      // 检查文件是否存在
      await new Promise<void>((resolve, reject) => {
        fs.access(resolved, fs.constants.F_OK, (err) => {
          if (err) {
            reject(new Error(t('fs.fileNotFound')));
          } else {
            resolve();
          }
        });
      });

      // 使用系统默认程序打开文件
      const openError = await shell.openPath(resolved);
      if (openError) {
        logger.error('[Electron] 打开文件失败:', openError);
        return { success: false, error: openError };
      }

      logger.debug('[Electron] 已用系统程序打开文件:', resolved);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('fs.unknownError');
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

      // 路径安全：必须落在 userData 或项目目录之下
      const resolvedScan = path.resolve(dirPath);
      const roots = getAllowedRoots();
      if (!isPathAllowed(resolvedScan, roots)) {
        logger.error('[Electron] scan-directory: 路径不在允许的根目录之下:', dirPath);
        return [];
      }

      // 顶层用 lstat 拒绝符号链接（防止符号链接逃逸出授权根）
      try {
        const lstat = fs.lstatSync(resolvedScan);
        if (lstat.isSymbolicLink()) {
          logger.error('[Electron] scan-directory: 拒绝扫描符号链接:', dirPath);
          return [];
        }
      } catch {
        logger.error('[Electron] scan-directory: 路径不可访问:', dirPath);
        return [];
      }

      // 验证目录是否存在
      if (!fs.existsSync(resolvedScan)) {
        logger.error('[Electron] 目录不存在:', dirPath);
        return [];
      }

      // 验证是否为目录
      const stats = fs.statSync(resolvedScan);
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

  // ---- read-file ----
  // 读取项目相关文本文件（工作区配置 / 项目清单等）
  // 路径安全：必须是绝对路径，且落在 userData 或当前项目目录之下（根目录包含校验）。
  // 旧的"resolve 后与 normalize 比较"写法对绝对路径含 '..' 失效，已废弃。
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        logger.error('[Electron] 无效的文件路径:', filePath);
        return null;
      }

      if (!path.isAbsolute(filePath)) {
        logger.error('[Electron] read-file: 路径必须是绝对路径:', filePath);
        return null;
      }

      const resolved = path.resolve(filePath);
      const roots = getAllowedRoots();
      if (!isPathAllowed(resolved, roots)) {
        logger.error('[Electron] read-file: 路径不在允许的根目录之下（拒绝读取）:', filePath);
        return null;
      }

      // 检查文件是否存在
      if (!fs.existsSync(resolved)) {
        logger.debug('[Electron] 文件不存在:', resolved);
        return null;
      }

      // 检查是否为文件
      const stats = fs.statSync(resolved);
      if (!stats.isFile()) {
        logger.error('[Electron] 路径不是文件:', resolved);
        return null;
      }

      const content = fs.readFileSync(resolved, 'utf-8');
      logger.debug('[Electron] 文件已读取:', resolved);
      return content;
    } catch (error) {
      logger.error('[Electron] 读取文件失败:', error);
      return null;
    }
  });

  // ---- write-file ----
  // 写入文本文件到指定绝对路径，自动创建父目录。
  // 路径安全：与 read-file 同样的根目录包含校验；写入比读取更敏感（还能 mkdir
  // 创造路径），严格限制在 userData 或项目目录之下。
  ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        logger.error('[Electron] 无效的文件路径:', filePath);
        return false;
      }

      if (!path.isAbsolute(filePath)) {
        logger.error('[Electron] write-file: 路径必须是绝对路径:', filePath);
        return false;
      }

      const resolved = path.resolve(filePath);
      const roots = getAllowedRoots();
      if (!isPathAllowed(resolved, roots)) {
        logger.error('[Electron] write-file: 路径不在允许的根目录之下（拒绝写入）:', filePath);
        return false;
      }

      // 自动创建父目录
      const dirPath = path.dirname(resolved);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.debug('[Electron] 创建目录:', dirPath);
      }

      fs.writeFileSync(resolved, content, 'utf-8');
      logger.debug('[Electron] 文件已保存:', resolved);
      return true;
    } catch (error) {
      logger.error('[Electron] 写入文件失败:', error);
      return false;
    }
  });
}
