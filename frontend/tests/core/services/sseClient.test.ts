/**
 * @file sseClient.test.ts
 * @description SSE 客户端单元测试（纯逻辑：帧解析 + 去重 + token 头默认注入）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { parseSSEBuffer, createSSEClient } from '@/core/services/sseClient'
import { setApiToken } from '@/core/services/apiToken'

describe('parseSSEBuffer', () => {
  it('解析单个完整帧', () => {
    const buffer = 'id: 1\nevent: delta\ndata: {"text":"你好"}\n\n'
    const { events, remaining } = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe(1)
    expect(events[0].event).toBe('delta')
    expect(events[0].data).toBe('{"text":"你好"}')
    expect(remaining).toBe('')
  })

  it('解析多个帧', () => {
    const buffer = 'id: 1\nevent: delta\ndata: a\n\nid: 2\nevent: delta\ndata: b\n\n'
    const { events } = parseSSEBuffer(buffer)
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe(1)
    expect(events[1].id).toBe(2)
  })

  it('保留未完成的帧为 remaining', () => {
    const buffer = 'id: 1\nevent: delta\ndata: a\n\nid: 2\nevent: delt' // 第二帧未完成
    const { events, remaining } = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1) // 只完成第一帧
    expect(events[0].id).toBe(1)
    expect(remaining).toBe('id: 2\nevent: delt')
  })

  it('忽略注释行（心跳）', () => {
    const buffer = ':keep-alive\n\nid: 1\nevent: delta\ndata: a\n\n'
    const { events } = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1) // 心跳不计为事件
    expect(events[0].id).toBe(1)
  })

  it('默认 event 类型为 message', () => {
    const buffer = 'data: hello\n\n'
    const { events } = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('message')
    expect(events[0].id).toBeNull()
  })

  it('多行 data 用换行拼接', () => {
    const buffer = 'data: line1\ndata: line2\n\n'
    const { events } = parseSSEBuffer(buffer)
    expect(events[0].data).toBe('line1\nline2')
  })

  it('空缓冲返回空事件', () => {
    const { events, remaining } = parseSSEBuffer('')
    expect(events).toHaveLength(0)
    expect(remaining).toBe('')
  })

  it('兼容 CRLF 换行', () => {
    const buffer = 'id: 1\r\nevent: delta\r\ndata: a\r\n\r\n'
    const { events } = parseSSEBuffer(buffer)
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe(1)
    expect(events[0].data).toBe('a')
  })

  it('data 字段值前导空格被跳过', () => {
    const buffer = 'data: {"k":"v"}\n\n'
    const { events } = parseSSEBuffer(buffer)
    expect(events[0].data).toBe('{"k":"v"}')
  })
})

describe('createSSEClient token 头默认注入', () => {
  /**
   * 通过 stub 全局 fetch 捕获最终发出的请求头，验证 X-Precis-Auth 的默认注入：
   * - 有 token：connect/cancel 默认携带
   * - 调用方显式传入同名头：不被覆盖
   * - 无 token（Web/开发模式）：不注入
   */
  let captured: Array<{ url: string; headers: Record<string, string> }>
  const originalFetch = globalThis.fetch

  function stubFetch(body = 'ok') {
    captured = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch
  }

  const noop = () => {}
  /** noReconnect 选项：流自然结束时直接结束，避免测试留下重连定时器 */
  const opts = { noReconnect: true } as const

  beforeEach(() => {
    setApiToken('')
    stubFetch()
  })

  afterEach(() => {
    setApiToken('')
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('有 token 时 connect 默认注入 X-Precis-Auth', async () => {
    setApiToken('tok-123')
    const client = createSSEClient()
    await client.connect('/ai/chat/stream', {}, { onEvent: noop }, opts)
    client.close()
    expect(captured[0].headers['X-Precis-Auth']).toBe('tok-123')
  })

  it('调用方显式传入的 X-Precis-Auth 不被覆盖', async () => {
    setApiToken('tok-123')
    const client = createSSEClient()
    await client.connect(
      '/ai/chat/stream',
      {},
      { onEvent: noop },
      { ...opts, headers: { 'X-Precis-Auth': 'explicit' } }
    )
    client.close()
    expect(captured[0].headers['X-Precis-Auth']).toBe('explicit')
  })

  it('无 token 时不注入 X-Precis-Auth', async () => {
    const client = createSSEClient()
    await client.connect('/ai/chat/stream', {}, { onEvent: noop }, opts)
    client.close()
    expect('X-Precis-Auth' in captured[0].headers).toBe(false)
  })

  it('cancel 请求同样默认注入 token', async () => {
    setApiToken('tok-123')
    const client = createSSEClient()
    await client.cancel('job-1')
    expect(captured[0].url).toContain('/ai/jobs/job-1/cancel')
    expect(captured[0].headers['X-Precis-Auth']).toBe('tok-123')
  })
})
