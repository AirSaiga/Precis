/**
 * @file sseClient.test.ts
 * @description SSE 客户端单元测试（纯逻辑：帧解析 + 去重）
 */

import { describe, it, expect } from 'vitest'
import { parseSSEBuffer } from '@/core/services/sseClient'

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
