/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
