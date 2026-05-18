/**
 * @fileoverview 分级日志封装
 *
 * 功能概述:
 * - 开发模式输出到 console
 * - 生产模式静默（避免泄露内部信息）
 * - 支持 future 接入远程日志上报
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isDev = typeof import.meta.env !== 'undefined' && import.meta.env.DEV

function shouldLog(level: LogLevel): boolean {
  if (isDev) return true
  // 生产环境只输出 warn/error
  return level === 'warn' || level === 'error'
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString()
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message), ...args)
    }
  },

  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message), ...args)
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message), ...args)
    }
  },

  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message), ...args)
    }
  },
}
