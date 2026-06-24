/**
 * @fileoverview Electron 主进程分级日志封装
 *
 * 复制自 frontend/src/core/utils/logger.ts 并适配 Electron 主进程：
 * - 开发模式或未打包时输出全部级别
 * - 生产模式输出 info/warn/error（保留后端启动关键信息）
 * - 同时写入控制台和用户数据目录下的日志文件，便于生产环境排错
 *
 * 日志轮转策略：
 * - main.log 达到 MAX_LOG_FILE_SIZE 后，滚动为 main.log.1（覆盖旧的），
 *   当前文件清空后继续写入。始终保留最近两份日志（main.log + main.log.1）。
 * - 轮转通过文件系统 copy + truncate 实现，不把整文件读入内存。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志文件最大大小（5MB），超过后触发轮转 */
const MAX_LOG_FILE_SIZE = 5 * 1024 * 1024;

/** 读取日志尾部时返回的最大字节数（256KB，避免大文件全量读入内存） */
const LOG_TAIL_MAX_BYTES = 256 * 1024;

/** 滚动窗口扫描就绪信号时保留的尾部字符数 */
// （此处常量供 main.ts 的 stderr 检测使用，logger 内部不直接用，保留导出供复用）

/** 是否已尝试初始化文件日志 */
let fileInitAttempted = false;

/** 日志文件写入流 */
let logStream: fs.WriteStream | null = null;

/** 日志文件路径 */
let logFilePath = '';

/** 轮转后的旧日志文件路径 */
let rotatedLogFilePath = '';

/**
 * 轮转当前日志文件：main.log → main.log.1，然后清空 main.log。
 *
 * 实现说明：
 * - 用 copyFileSync 复制后 truncateSync 清空，避免把整个文件读入内存。
 * - 任何步骤失败均降级为清空当前文件（保证后续写入不会继续膨胀）。
 */
function rotateLogFile(target: string, rotated: string): void {
  try {
    // 若存在上一轮的 .1 副本，先删除（Windows 不允许直接覆盖到被占用文件）
    if (fs.existsSync(rotated)) {
      fs.unlinkSync(rotated);
    }
    fs.copyFileSync(target, rotated);
    fs.truncateSync(target, 0);
  } catch {
    // 轮转失败时直接清空当前文件，至少阻止其继续增长
    try {
      fs.writeFileSync(target, '', 'utf-8');
    } catch {
      // 清空也失败则放弃，交给后续写入或下次启动再处理
    }
  }
}

/**
 * 延迟初始化文件日志。
 *
 * 说明：
 * - logger 在 app.whenReady 之前就可能被导入使用，因此文件流延迟到第一次写日志时创建。
 * - 如果 app.getPath('userData') 尚不可用，则本次降级为仅控制台输出，下次再试。
 * - 若日志文件超过 MAX_LOG_FILE_SIZE，先触发轮转再打开流。
 */
function ensureLogStream(): fs.WriteStream | null {
  if (logStream) {
    return logStream;
  }
  if (fileInitAttempted) {
    return null;
  }
  fileInitAttempted = true;

  try {
    const userData = app.getPath('userData');
    const logDir = path.join(userData, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    logFilePath = path.join(logDir, 'main.log');
    rotatedLogFilePath = path.join(logDir, 'main.log.1');

    // 如果日志文件过大，先轮转（保留为 .1），避免无限增长
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      if (stats.size > MAX_LOG_FILE_SIZE) {
        rotateLogFile(logFilePath, rotatedLogFilePath);
      }
    }

    logStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf-8' });
    logStream.on('error', (err) => {
      console.error('[Logger] 文件日志写入失败:', err);
      logStream = null;
    });
  } catch (err) {
    // 初始化失败时降级为仅控制台输出
    console.error('[Logger] 初始化文件日志失败:', err);
    logStream = null;
  }

  return logStream;
}

function shouldLog(level: LogLevel): boolean {
  // 开发模式或未打包时输出全部级别
  if (!app.isPackaged) return true;
  // 生产环境输出 info/warn/error（保留后端启动关键信息）
  return level === 'info' || level === 'warn' || level === 'error';
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  return ' ' + args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

function writeLog(level: LogLevel, message: string, args: unknown[]): void {
  const line = formatMessage(level, message) + formatArgs(args);

  // 始终输出到控制台
  switch (level) {
    case 'debug':
      console.debug(line);
      break;
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }

  // 尝试写入文件（生产环境下尤为重要）
  const stream = ensureLogStream();
  if (stream) {
    stream.write(line + '\n');
  }
}

/**
 * 获取当前日志文件路径。
 *
 * 用途：在错误对话框中向用户展示日志位置，或供前端读取日志。
 */
export function getLogFilePath(): string {
  ensureLogStream();
  return logFilePath;
}

/**
 * 读取日志尾部内容（用于错误报告 / 前端展示）。
 *
 * 实现说明：
 * - 优先读取轮转副本 main.log.1 的尾部 + 当前 main.log 全部，拼接返回，最多 LOG_TAIL_MAX_BYTES 字节。
 * - 用 fs.read 带 offset 读取尾部，避免把超大日志全文读入内存。
 * - 文件不存在或读取失败时返回空字符串。
 */
export function readLogFile(): string {
  const filePath = getLogFilePath();
  if (!filePath) return '';

  /** 读取单个文件的尾部（最多 maxBytes 字节） */
  const readTail = (p: string, maxBytes: number): string => {
    if (!fs.existsSync(p)) return '';
    let fd: number | null = null;
    try {
      const stat = fs.statSync(p);
      if (stat.size === 0) return '';
      const readSize = Math.min(stat.size, maxBytes);
      const offset = stat.size - readSize;
      const buf = Buffer.alloc(readSize);
      fd = fs.openSync(p, 'r');
      fs.readSync(fd, buf, 0, readSize, offset);
      return buf.toString('utf-8');
    } catch (err) {
      console.error('[Logger] 读取日志文件失败:', err);
      return '';
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // 忽略关闭失败
        }
      }
    }
  };

  // 先取轮转副本的尾部一半，再取当前文件的尾部一半，拼成完整上下文
  const halfBudget = Math.floor(LOG_TAIL_MAX_BYTES / 2);
  const rotated = rotatedLogFilePath ? readTail(rotatedLogFilePath, halfBudget) : '';
  const current = readTail(filePath, halfBudget);
  return (rotated + current).trimEnd();
}

/**
 * 刷新并关闭文件日志流，确保进程退出前最后一批日志落盘。
 *
 * 在 app 'before-quit' / 'quit' 事件中调用。
 */
export function flushLogs(): void {
  if (logStream) {
    try {
      logStream.end();
    } catch {
      // 忽略关闭失败
    }
    logStream = null;
  }
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) {
      writeLog('debug', message, args);
    }
  },

  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) {
      writeLog('info', message, args);
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) {
      writeLog('warn', message, args);
    }
  },

  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) {
      writeLog('error', message, args);
    }
  },
};
