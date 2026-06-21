/**
 * @fileoverview Electron 主进程分级日志封装
 *
 * 复制自 frontend/src/core/utils/logger.ts 并适配 Electron 主进程：
 * - 生产模式（app.isPackaged）只输出 warn/error
 * - 开发模式输出全部级别
 * - 统一带时间戳与级别前缀
 */

import { app } from 'electron';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function shouldLog(level: LogLevel): boolean {
  // 开发模式或未打包时输出全部级别
  if (!app.isPackaged) return true;
  // 生产环境只输出 warn/error
  return level === 'warn' || level === 'error';
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message), ...args);
    }
  },

  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message), ...args);
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message), ...args);
    }
  },

  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message), ...args);
    }
  },
};
