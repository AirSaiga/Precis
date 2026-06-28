/**
 * @file sseClient.ts
 * @description 统一 SSE 客户端（fetch + ReadableStream）
 *
 * 三个场景（聊天/配置生成/迁移）共用。封装：
 * - POST fetch + 流式读取 ReadableStream，按 SSE 格式解析帧
 * - 自动重连（指数退避 1s/2s/5s，最多 3 次）+ Last-Event-ID 续传
 * - 事件去重（按 id）
 * - 取消（POST /ai/jobs/{id}/cancel）
 *
 * 设计说明：
 * - 用 fetch 而非原生 EventSource：EventSource 只支持 GET、不支持自定义 header
 *   （无法带 X-Project-Config-Path 和 Last-Event-ID），fetch 流式可控性更强。
 * - 终止事件（completed/error/cancelled）后正常关闭，不重连。
 */

import { getApiBaseUrl } from './httpClient'

/** API 路径前缀，与 Axios 实例的 baseURL 保持一致 */
const API_PREFIX = '/api/latest'

/** SSE 事件帧解析结果 */
export interface SSEEvent {
  id: number | null
  event: string
  data: string
}

/** SSE 连接选项 */
export interface SSEConnectOptions {
  /** 额外请求头（如 X-Project-Config-Path） */
  headers?: Record<string, string>
  /** 禁用自动重连。聊天流（非幂等）应设为 true，流断开即结束。
   * 生成/迁移（幂等）可保留 false（默认）启用重连续传。 */
  noReconnect?: boolean
}

/** SSE 客户端回调 */
export interface SSEClientCallbacks {
  onEvent: (event: string, id: number | null, data: unknown) => void
  onError?: (error: Error) => void
  onClose?: () => void
}

/** 重连退避序列（秒） */
const RECONNECT_BACKOFF = [1000, 2000, 5000]
const MAX_RECONNECT = RECONNECT_BACKOFF.length

/** 终止事件集合，收到后正常关闭不重连 */
const TERMINAL_EVENTS = new Set(['completed', 'error', 'cancelled'])

/**
 * 解析一段 SSE 文本缓冲，返回解析出的事件帧和剩余未完成缓冲。
 *
 * SSE 帧以空行（\n\n）分隔。每帧可能含多行：id: / event: / data:
 */
export function parseSSEBuffer(buffer: string): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = []
  // 按空行分帧（兼容 \n\n 和 \r\n\r\n）
  const parts = buffer.split(/\r?\n\r?\n/)
  // 最后一段可能是未完成帧，保留为 remaining
  const remaining = parts.pop() ?? ''

  for (const frame of parts) {
    if (!frame.trim()) continue
    const evt = parseSSEFrame(frame)
    if (evt) events.push(evt)
  }
  return { events, remaining }
}

/** 解析单个 SSE 帧文本为 SSEEvent。纯注释帧（无任何字段）返回 null。 */
function parseSSEFrame(frame: string): SSEEvent | null {
  let id: number | null = null
  let event = 'message'
  const dataLines: string[] = []
  let hasField = false // 是否出现过任何有效字段（id/event/data）

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue // 空行或注释（心跳）
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const field = line.slice(0, colonIdx)
    // 值跳过冒号后可能的一个空格
    let value = line.slice(colonIdx + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'id') {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) id = parsed
      hasField = true
    } else if (field === 'event') {
      event = value
      hasField = true
    } else if (field === 'data') {
      dataLines.push(value)
      hasField = true
    }
  }

  // 纯注释帧（只有 : 开头行）无任何有效字段，不作为事件
  if (!hasField) return null

  return { id, event, data: dataLines.join('\n') }
}

/**
 * 创建一个 SSE 客户端实例。
 *
 * 用法：
 * ```ts
 * const client = createSSEClient()
 * client.connect('/ai/chat/stream', body, { onEvent: (e, id, data) => {...} })
 * // 取消
 * await client.cancel('stream_xxx')
 * client.close()
 * ```
 */
export interface SSEClient {
  connect: (
    url: string,
    body: unknown,
    callbacks: SSEClientCallbacks,
    options?: SSEConnectOptions
  ) => Promise<void>
  cancel: (jobId: string) => Promise<void>
  close: () => void
  getLastEventId: () => number | null
}

export function createSSEClient(): SSEClient {
  let lastEventId: number | null = null
  let aborted = false
  let abortController: AbortController | null = null
  let reconnectCount = 0
  let connectUrl = ''
  let connectBody: unknown = null
  let callbacksRef: SSEClientCallbacks | null = null
  let connectOptions: SSEConnectOptions | undefined = undefined

  /** 实际发起一次 fetch 连接并处理流 */
  async function doConnect(): Promise<void> {
    if (aborted) return
    abortController = new AbortController()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(connectOptions?.headers ?? {}),
    }
    if (lastEventId !== null) {
      headers['Last-Event-ID'] = String(lastEventId)
    }

    let response: Response
    try {
      response = await fetch(`${getApiBaseUrl()}${API_PREFIX}${connectUrl}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(connectBody),
        signal: abortController.signal,
      })
    } catch (err) {
      if (aborted) return
      handleReconnect(err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (!response.ok || !response.body) {
      // 尝试读取错误响应体提取 detail（后端 HTTPException 会返回 JSON detail）
      let errorDetail = `SSE 响应异常: ${response.status}`
      try {
        const errorBody = await response.text()
        if (errorBody) {
          try {
            const parsed = JSON.parse(errorBody)
            if (typeof parsed.detail === 'string') {
              errorDetail = parsed.detail
            }
          } catch {
            // 非 JSON 响应保持原样
          }
        }
      } catch {
        // 读取 body 失败忽略
      }
      // 4xx 客户端错误不重试（如 400 未配置 Provider），直接报错
      if (response.status >= 400 && response.status < 500) {
        callbacksRef?.onError?.(new Error(errorDetail))
        callbacksRef?.onClose?.()
        return
      }
      handleReconnect(new Error(errorDetail))
      return
    }

    reconnectCount = 0 // 连接成功，重置重连计数

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (aborted) break
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, remaining } = parseSSEBuffer(buffer)
        buffer = remaining
        for (const evt of events) {
          // 去重：丢弃已处理的 id
          if (evt.id !== null && lastEventId !== null && evt.id <= lastEventId) continue
          if (evt.id !== null) lastEventId = evt.id
          let parsedData: unknown = evt.data
          if (evt.data) {
            try {
              parsedData = JSON.parse(evt.data)
            } catch {
              // 非 JSON data 保持原样字符串
            }
          }
          callbacksRef?.onEvent(evt.event, evt.id, parsedData)
          // 终止事件：正常关闭，不重连
          if (TERMINAL_EVENTS.has(evt.event)) {
            callbacksRef?.onClose?.()
            return
          }
        }
      }
      // 流自然结束（非终止事件）：尝试重连
      if (!aborted) {
        handleReconnect(new Error('SSE 流意外结束'))
      }
    } catch (err) {
      if (aborted) return
      handleReconnect(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /** 处理重连（指数退避，达到上限后报错）。noReconnect 模式下直接报错不重连。 */
  function handleReconnect(err: Error): void {
    if (aborted) return
    // noReconnect 模式（聊天流）：流断开即结束，直接报错，不产生幽灵后台任务
    if (connectOptions?.noReconnect) {
      callbacksRef?.onError?.(err)
      callbacksRef?.onClose?.()
      return
    }
    if (reconnectCount >= MAX_RECONNECT) {
      callbacksRef?.onError?.(err)
      callbacksRef?.onClose?.()
      return
    }
    const delay = RECONNECT_BACKOFF[reconnectCount]
    reconnectCount++
    setTimeout(() => {
      if (!aborted) void doConnect()
    }, delay)
  }

  return {
    async connect(url, body, callbacks, options) {
      connectUrl = url
      connectBody = body
      callbacksRef = callbacks
      connectOptions = options
      reconnectCount = 0
      aborted = false
      await doConnect()
    },
    async cancel(jobId) {
      await fetch(`${getApiBaseUrl()}${API_PREFIX}/ai/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    },
    close() {
      if (aborted) return // 已关闭，幂等
      aborted = true
      abortController?.abort()
      // 显式触发 onClose，让依赖它做清理的调用方（如 generation/migration）能收到回调
      callbacksRef?.onClose?.()
    },
    getLastEventId() {
      return lastEventId
    },
  }
}
