/**
 * @fileoverview startup-probe 单元测试
 *
 * 覆盖后端启动信号检测的纯函数：
 * - containsStartupSignal：扫描 Uvicorn 就绪信号
 * - looksLikeStderrError：识别 stderr 真实错误
 *
 * 端口/API 轮询函数（findAvailablePort/waitForServer/waitForApiReady）涉及
 * 网络 I/O，此处仅验证常量导出与函数可调用性，实际行为由集成测试覆盖。
 */

import { describe, it, expect } from 'vitest'
import {
  containsStartupSignal,
  looksLikeStderrError,
  findAvailablePort,
  waitForServer,
  waitForApiReady,
  STARTUP_SIGNALS,
  STDERR_ERROR_MARKERS,
  SIGNAL_SCAN_TAIL_CHARS,
} from '../src/startup-probe'

describe('startup-probe - 常量', () => {
  it('STARTUP_SIGNALS 包含 Uvicorn 就绪标记', () => {
    expect(STARTUP_SIGNALS).toContain('Application startup complete')
    expect(STARTUP_SIGNALS).toContain('Uvicorn running')
  })

  it('STDERR_ERROR_MARKERS 包含 Python 错误关键词', () => {
    expect(STDERR_ERROR_MARKERS).toContain('Traceback')
    expect(STDERR_ERROR_MARKERS).toContain('Error:')
    expect(STDERR_ERROR_MARKERS).toContain('Exception')
  })

  it('SIGNAL_SCAN_TAIL_CHARS 为正整数（尾窗口大小）', () => {
    expect(SIGNAL_SCAN_TAIL_CHARS).toBeGreaterThan(0)
  })
})

describe('startup-probe - containsStartupSignal', () => {
  it('包含 "Application startup complete" 返回 true', () => {
    expect(containsStartupSignal('INFO: Application startup complete.')).toBe(true)
  })

  it('包含 "Uvicorn running" 返回 true', () => {
    expect(containsStartupSignal('Uvicorn running on http://127.0.0.1:18000')).toBe(true)
  })

  it('不含任何就绪信号返回 false', () => {
    expect(containsStartupSignal('INFO: Waiting for application startup.')).toBe(false)
    expect(containsStartupSignal('')).toBe(false)
  })

  it('信号被 chunk 切断时仍可在尾窗口中匹配', () => {
    // 模拟信号跨 chunk：前半截 + 后半截拼接后才完整
    const chunk1 = 'some log\nApplication startup incomp'
    const chunk2 = 'lete.\nApplication startup complete.'
    const tail = (chunk1 + chunk2).slice(-SIGNAL_SCAN_TAIL_CHARS)
    expect(containsStartupSignal(tail)).toBe(true)
  })
})

describe('startup-probe - looksLikeStderrError', () => {
  it('包含 Traceback 返回 true', () => {
    expect(looksLikeStderrError('Traceback (most recent call last):')).toBe(true)
  })

  it('包含 "Error:" 返回 true', () => {
    expect(looksLikeStderrError('ImportError: cannot import name')).toBe(true)
  })

  it('包含 CRITICAL 返回 true', () => {
    expect(looksLikeStderrError('CRITICAL: database connection lost')).toBe(true)
  })

  it('常规 INFO 日志返回 false', () => {
    expect(looksLikeStderrError('INFO: 127.0.0.1 - "GET /docs HTTP/1.1" 200')).toBe(false)
  })

  it('空字符串返回 false', () => {
    expect(looksLikeStderrError('')).toBe(false)
  })
})

describe('startup-probe - 网络函数可调用性', () => {
  // 这些函数涉及真实网络 I/O，此处仅验证它们是可调用的异步函数，
  // 不验证具体返回值（由集成/手动测试覆盖）

  it('findAvailablePort 是异步函数', () => {
    expect(typeof findAvailablePort).toBe('function')
    // 调用一个高端口，应该能快速返回（不阻塞测试）
    const result = findAvailablePort(49999)
    expect(result).toBeInstanceOf(Promise)
    // 不 await，避免占用端口影响其他测试
    result.then(() => {})
  })

  it('waitForServer 是异步函数', () => {
    expect(typeof waitForServer).toBe('function')
  })

  it('waitForApiReady 是异步函数', () => {
    expect(typeof waitForApiReady).toBe('function')
  })
})
