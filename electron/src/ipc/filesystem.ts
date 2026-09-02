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
 * scan-directory 递归深度上限（AGENTS.md 约定：递归必须设深度上限）。
 * 防止异常深的目录树（或深层符号链接链）拖垮主进程 / 被用于资源耗尽。
 */
const SCAN_DIRECTORY_MAX_DEPTH = 8;

/**
 * 递归扫描目录下的所有文件
 *
 * 使用深度优先遍历：遇到目录递归进入，遇到文件检查扩展名后加入结果。
 * 超过 maxDepth 深度停止递归（防资源耗尽）。
 * 注意：顶层目录已由调用方做 lstat 校验（防符号链接逃逸），递归内部沿用
 * withFileTypes 直接判断条目类型（readdirSync 的 dirent 不跟随符号链接）。
 */
function scanDirectoryRecursive(
  dirPath: string,
  allowedExtensions: string[],
  result: string[],
  depth: number,
  maxDepth: number = SCAN_DIRECTORY_MAX_DEPTH
): void {
  if (depth > maxDepth) {
    logger.warn('[Electron] 扫描目录超过最大深度，停止递归:', dirPath);
    return;
  }
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // 递归扫描子目录
        scanDirectoryRecursive(fullPath, allowedExtensions, result, depth + 1, maxDepth);
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

/**
 * save-text-file 禁止覆写的受保护文件名（userData 下的主进程专属配置）。
 *
 * 威胁模型：update-config.json 保存自动更新源配置。若渲染进程可直接覆写它，
 * XSS 后即可把更新源指向恶意 generic 服务器，配合 autoInstallOnAppQuit=true
 * 在用户退出应用时静默安装恶意安装包（更新源劫持 → RCE）。修改更新配置的唯一
 * 合法入口是 update:save-config IPC——其内部经 validateUpdateSourceUrl 做
 * https/本机回环白名单校验。此处按文件名精确匹配拒绝写入，作为纵深防御的一环
 * （与 update.ts 的 apply 时校验互为冗余）。
 */
const SAVE_TEXT_FILE_PROTECTED_NAMES = new Set(['update-config.json']);

/**
 * write-file 禁止覆写的 userData 受保护文件（相对 userData 根的 POSIX 风格路径，
 * 小写）。save-text-file 的闸门按"相对文件名"设防，覆盖不了走绝对路径的 write-file
 * 入口——后者此前可直接覆写这两份主进程专属配置，绕过 update:save-config 的
 * 源校验（换源劫持链）并毒化 getAllowedRoots 的授权根信任源（越权读写任意目录）。
 */
const PROTECTED_USERDATA_RELATIVE_PATHS = new Set(['update-config.json', '.precis/electron_launch.yaml']);

/**
 * Windows 文件名归一化：Win32 落盘时会剥除文件名末尾的点与空格，
 * 'update-config.json.' 实际写入 update-config.json，须归一后比较防绕过。
 */
function normalizeWindowsFileName(name: string): string {
  return name.replace(/[. ]+$/, '');
}

/** 受保护文件名判定：小写归一 + Windows 尾点/尾空格归一化，防 Update-Config.JSON / 尾点变体绕过 */
function isProtectedUserDataFileName(fileName: string): boolean {
  return SAVE_TEXT_FILE_PROTECTED_NAMES.has(normalizeWindowsFileName(fileName).toLowerCase());
}

/**
 * 判断绝对路径是否指向 userData 根下的受保护文件（write-file 入口闸门）。
 * 每段路径都做尾点/尾空格归一化（'.precis.' 目录在 Win32 下与 '.precis' 同址）。
 */
function isProtectedUserDataPath(resolved: string, userDataRoot: string): boolean {
  if (!resolved.startsWith(userDataRoot + path.sep)) {
    return false;
  }
  const relative = path
    .relative(userDataRoot, resolved)
    .split(path.sep)
    .map((segment) => normalizeWindowsFileName(segment).toLowerCase())
    .join('/');
  return PROTECTED_USERDATA_RELATIVE_PATHS.has(relative);
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
      // [安全] 与 write-file 同源的根目录包含校验：目录创建原语同样能构造路径
      // （此前无任何校验，任意绝对路径可被 mkdir）
      if (!isPathAllowed(path.resolve(dirPath), getAllowedRoots())) {
        logger.error('[Electron] ensure-dir: 路径不在允许的根目录之下（拒绝创建）:', dirPath);
        return false;
      }
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
  // 安全：update-config.json 属主进程专属配置（更新源白名单校验只存在于
  // update:save-config 路径），拒绝渲染进程经本 IPC 直接覆写（见
  // SAVE_TEXT_FILE_PROTECTED_NAMES 注释中的威胁模型）。
  ipcMain.handle('save-text-file', async (_event, fileName: string, content: string) => {
    try {
      if (!fileName || typeof fileName !== 'string') {
        return false;
      }

      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        logger.error('[Electron] save-text-file: 文件名包含非法字符:', fileName);
        return false;
      }

      if (isProtectedUserDataFileName(fileName)) {
        logger.error('[Electron] save-text-file: 拒绝写入受保护文件:', fileName);
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
      scanDirectoryRecursive(dirPath, allowedExtensions, result, 1);

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

      // [安全] userData 根下的主进程专属配置（更新源/授权根信任源）不可经此入口覆写：
      // 覆写 update-config.json 可绕过 update:save-config 的源校验（换源劫持链）；
      // 覆写 .precis/electron_launch.yaml 可毒化授权根信任源（getAllowedRoots 每次调用
      // 都重读它），使 read-file/write-file 的白名单扩到任意目录。
      if (isProtectedUserDataPath(resolved, path.resolve(app.getPath('userData')))) {
        logger.error('[Electron] write-file: 拒绝覆写 userData 受保护文件:', filePath);
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
