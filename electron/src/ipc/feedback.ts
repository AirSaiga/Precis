/**
 * @file feedback.ts
 * @description 崩溃反馈辅助函数 + IPC handler（从 main.ts 抽出）
 *
 * 提供：
 * - feedbackStore 辅助函数：目录管理、文件路径、格式化
 * - registerFeedbackIpc：注册 feedback:* 和 logs:* 系列 IPC
 *
 * 依赖：app/fs/path/shell/logger + readLogFile/getLogFilePath（logger 模块）。
 * 无共享状态依赖（不读写 app-state）。
 */

import { app, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger, readLogFile, getLogFilePath } from '../logger';

// ============================================================================
// feedbackStore：辅助函数（纯文件操作，从 main.ts 迁移）
// ============================================================================

/** 反馈文件目录(userData/feedback/) */
export function getFeedbackDir(): string {
  return path.join(app.getPath('userData'), 'feedback');
}

/** pending crash 文件路径(渲染进程崩溃时写入,前端启动读取补弹) */
export function getPendingCrashPath(): string {
  return path.join(getFeedbackDir(), 'pending-crash.json');
}

/** 确保 feedback 目录存在 */
export function ensureFeedbackDir(): void {
  const dir = getFeedbackDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 格式化时间戳为文件名安全字符串 */
export function formatTimestampForFile(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 格式化崩溃报告为反馈文件纯文本(含错误信息 + 堆栈 + 主进程日志尾部) */
export function formatFeedbackText(report: unknown): string {
  const r = report as Record<string, unknown>;
  const logTail = readLogFile();
  return [
    '===== Precis 崩溃反馈 =====',
    `应用版本: ${r.appVersion ?? 'unknown'}`,
    `平台: ${process.platform}`,
    `时间: ${r.timestamp ?? new Date().toISOString()}`,
    '',
    '--- 错误信息 ---',
    `来源: ${r.source ?? 'unknown'}`,
    `消息: ${r.message ?? ''}`,
    r.url ? `URL: ${r.url}` : '',
    '',
    '--- 错误堆栈 ---',
    (r.stack as string) ?? '(无堆栈)',
    '',
    '--- 主进程日志尾部 ---',
    logTail,
    '============================',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ============================================================================
// IPC 注册
// ============================================================================

/**
 * 注册 logs:* 与 feedback:* 系列 IPC handler
 *
 * 包含：
 * - logs:read / logs:path：读取/获取主进程日志
 * - feedback:persist：持久化崩溃日志（保底记录）
 * - feedback:export：导出反馈文件并在文件管理器高亮
 * - feedback:read-pending / feedback:clear-pending：渲染进程崩溃待补弹记录管理
 */
export function registerFeedbackIpc(): void {
  // ---- logs ----
  ipcMain.handle('logs:read', async () => {
    return readLogFile();
  });

  ipcMain.handle('logs:path', async () => {
    return getLogFilePath();
  });

  // ---- feedback ----
  ipcMain.handle('feedback:persist', async (_event, report: unknown) => {
    try {
      ensureFeedbackDir();
      const r = report as Record<string, unknown>;
      const ts = (r.timestamp as string) ?? new Date().toISOString();
      const fp = String(r.fingerprint ?? 'unknown').slice(0, 8);
      const filename = `crash-${formatTimestampForFile(ts)}-${fp}.txt`;
      const filepath = path.join(getFeedbackDir(), filename);
      fs.writeFileSync(filepath, formatFeedbackText(report), 'utf-8');
    } catch (err) {
      logger.error('[Main] 持久化崩溃日志失败:', err);
    }
  });

  ipcMain.handle('feedback:export', async (_event, report: unknown) => {
    ensureFeedbackDir();
    const r = report as Record<string, unknown>;
    const ts = (r.timestamp as string) ?? new Date().toISOString();
    const filename = `precis-feedback-${formatTimestampForFile(ts)}.txt`;
    const filepath = path.join(getFeedbackDir(), filename);
    fs.writeFileSync(filepath, formatFeedbackText(report), 'utf-8');
    // 在文件管理器中高亮该文件,方便用户定位并发送
    shell.showItemInFolder(filepath);
  });

  ipcMain.handle('feedback:read-pending', async () => {
    try {
      const p = getPendingCrashPath();
      if (!fs.existsSync(p)) return null;
      const content = fs.readFileSync(p, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      logger.error('[Main] 读取 pending crash 失败:', err);
      return null;
    }
  });

  ipcMain.handle('feedback:clear-pending', async () => {
    try {
      const p = getPendingCrashPath();
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (err) {
      logger.error('[Main] 清除 pending crash 失败:', err);
    }
  });
}
