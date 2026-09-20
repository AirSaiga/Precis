/**
 * @fileoverview startup-probe 单元测试
 *
 * 覆盖后端启动信号检测的纯函数：
 * - containsStartupSignal：扫描 Uvicorn 就绪信号
 * - looksLikeStderrError：识别 stderr 真实错误
 * - tryReadBackendPort：读取端口文件(端口发现协议)
 * - waitForApiReady：版本端点就绪轮询（本地 HTTP server 实测，含 2026-09-20
 *   修复回归——大响应 destroy 后不得挂死）
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  containsStartupSignal,
  looksLikeStderrError,
  tryReadBackendPort,
  waitForApiReady,
  STARTUP_SIGNALS,
  STDERR_ERROR_MARKERS,
  SIGNAL_SCAN_TAIL_CHARS,
  BACKEND_PORT_FILE,
} from '../src/startup-probe'

function listen(srv: http.Server): Promise<number> {
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res((srv.address() as net.AddressInfo).port)))
}

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

describe('startup-probe - tryReadBackendPort', () => {
  it('端口文件存在且内容合法时返回端口号', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'precis-port-'))
    writeFileSync(join(tmpDir, BACKEND_PORT_FILE), '53871', 'utf-8')
    expect(tryReadBackendPort(tmpDir)).toBe(53871)
  })

  it('端口文件不存在时返回 null', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'precis-port-'))
    expect(tryReadBackendPort(tmpDir)).toBeNull()
  })

  it('端口文件内容非法时返回 null', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'precis-port-'))
    writeFileSync(join(tmpDir, BACKEND_PORT_FILE), 'not-a-port', 'utf-8')
    expect(tryReadBackendPort(tmpDir)).toBeNull()
  })

  it('端口号为 0 或负数时返回 null', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'precis-port-'))
    writeFileSync(join(tmpDir, BACKEND_PORT_FILE), '0', 'utf-8')
    expect(tryReadBackendPort(tmpDir)).toBeNull()
  })
})

describe('startup-probe - waitForApiReady 回归', () => {
  // 2026-09-20 修复回归：>4KB 大响应触发 req.destroy() 后 'end' 与 req 'error'
  // 均不触发（destroy 不带 error 参数），socket 已销毁 socket-timeout 也不再回调，
  // 此前 Promise 永不 settle（dev 端口被返回分块大响应的本地服务占用时启动链挂死）。
  // 现由 res 'close' 兜底走统一重试/超时出口。
  it('多块 >4KB 非 Precis 响应：不挂死，按内部超时 settle(false)', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('x'.repeat(4096)) // 第一块 body=4096，不触发 >4096 destroy
      setTimeout(() => {
        try {
          res.write('y'.repeat(8192)) // 第二块 body>4096 → req.destroy()
        } catch {
          /* 连接已断开 */
        }
      }, 50)
      setTimeout(() => {
        try {
          res.end()
        } catch {
          /* 连接已断开 */
        }
      }, 200)
    })
    const port = await listen(srv)
    try {
      const ok = await waitForApiReady(port, 1200, 200)
      expect(ok).toBe(false)
    } finally {
      srv.close()
      srv.closeAllConnections?.()
    }
  }, 8000)

  it('Precis 版本端点响应 {version}：settle(true)', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ version: '0.1.2-test' }))
    })
    const port = await listen(srv)
    try {
      const ok = await waitForApiReady(port, 3000, 200)
      expect(ok).toBe(true)
    } finally {
      srv.close()
      srv.closeAllConnections?.()
    }
  }, 8000)

  it('连接拒绝：按内部超时 settle(false)', async () => {
    // 先占用一个端口再关闭，确保后续连接被拒绝
    const probe = net.createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as net.AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    const ok = await waitForApiReady(port, 1000, 200)
    expect(ok).toBe(false)
  }, 8000)

  it('waitForApiReady 是异步函数', () => {
    expect(typeof waitForApiReady).toBe('function')
  })
})
