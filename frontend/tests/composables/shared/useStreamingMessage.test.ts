/**
 * @file useStreamingMessage.test.ts
 * @description 流式状态机单元测试
 */

import { describe, it, expect } from 'vitest'
import { useStreamingMessage } from '@/composables/shared/useStreamingMessage'

describe('useStreamingMessage', () => {
  it('初始状态为空且非流式', () => {
    const { message } = useStreamingMessage()
    expect(message.content).toBe('')
    expect(message.toolSteps).toHaveLength(0)
    expect(message.isStreaming).toBe(false)
    expect(message.status).toBe('streaming')
  })

  it('start 后进入流式状态', () => {
    const { message, start } = useStreamingMessage()
    start()
    expect(message.isStreaming).toBe(true)
    expect(message.status).toBe('streaming')
  })

  it('delta 事件累积文本', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('delta', 1, { text: '你' })
    handleEvent('delta', 2, { text: '好' })
    handleEvent('delta', 3, { text: '世界' })
    expect(message.content).toBe('你好世界')
  })

  it('tool_call 添加 running 步骤', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('tool_call', 1, { tool: 'read_project', call_id: 'c1', turn: 1, label: '读取项目' })
    expect(message.toolSteps).toHaveLength(1)
    expect(message.toolSteps[0]).toMatchObject({
      tool: 'read_project',
      label: '读取项目',
      turn: 1,
      status: 'running',
    })
  })

  it('tool_result 更新对应步骤为 success', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('tool_call', 1, { tool: 'read_project', call_id: 'c1', turn: 1, label: '读取项目' })
    handleEvent('tool_result', 2, { name: 'read_project', call_id: 'c1', success: true })
    expect(message.toolSteps[0].status).toBe('success')
  })

  it('tool_result 失败标记 failed', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('tool_call', 1, {
      tool: 'apply_actions',
      call_id: 'c1',
      turn: 1,
      label: '修改配置',
    })
    handleEvent('tool_result', 2, {
      name: 'apply_actions',
      call_id: 'c1',
      success: false,
      error: 'boom',
    })
    expect(message.toolSteps[0].status).toBe('failed')
    expect(message.toolSteps[0].error).toBe('boom')
  })

  it('多步骤按 name 匹配最近的 running', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('tool_call', 1, { tool: 'read_project', call_id: 'c1', turn: 1, label: '读取项目' })
    handleEvent('tool_call', 2, { tool: 'read_project', call_id: 'c2', turn: 2, label: '读取项目' })
    handleEvent('tool_result', 3, { name: 'read_project', call_id: 'c2', success: true })
    // 应更新第二个（最近一个 running）
    expect(message.toolSteps[1].status).toBe('success')
    expect(message.toolSteps[0].status).toBe('running')
  })

  it('completed 用完整快照覆盖累积结果（容错兜底）', () => {
    const { message, handleEvent } = useStreamingMessage()
    // 中途只收到部分 delta
    handleEvent('delta', 1, { text: '不完' })
    // completed 携带完整 reply
    handleEvent('completed', 2, {
      reply: '完整的回复文本',
      tool_steps: [{ tool: 'read_project', label: '读取项目', turn: 1, action_count: 2 }],
      frontend_instructions: [{ type: 'x' }],
      iterations: 1,
    })
    expect(message.status).toBe('completed')
    expect(message.isStreaming).toBe(false)
    // content 被完整 reply 覆盖
    expect(message.content).toBe('完整的回复文本')
    // tool_steps 用完整快照
    expect(message.toolSteps).toHaveLength(1)
    expect(message.toolSteps[0].actionCount).toBe(2)
    expect(message.result?.iterations).toBe(1)
  })

  it('cancelled 状态如实记录已执行轮次', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('tool_call', 1, { tool: 'read_project', call_id: 'c1', turn: 1, label: '读取项目' })
    handleEvent('cancelled', 2, { completed_turns: 2, partial: true, tool_steps: [] })
    expect(message.status).toBe('cancelled')
    expect(message.isStreaming).toBe(false)
    expect(message.completedTurns).toBe(2)
  })

  it('error 记录错误信息', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('error', 1, { message: 'LLM 超时', code: 'TIMEOUT' })
    expect(message.status).toBe('error')
    expect(message.isStreaming).toBe(false)
    expect(message.errorMessage).toBe('LLM 超时')
  })

  it('reset 清空所有状态', () => {
    const { message, handleEvent, reset } = useStreamingMessage()
    handleEvent('delta', 1, { text: '内容' })
    handleEvent('completed', 2, { reply: '内容' })
    reset()
    expect(message.content).toBe('')
    expect(message.toolSteps).toHaveLength(0)
    expect(message.isStreaming).toBe(false)
    expect(message.status).toBe('streaming')
    expect(message.result).toBeNull()
  })

  it('忽略未知事件', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('unknown_event', 1, { foo: 'bar' })
    expect(message.content).toBe('')
    expect(message.toolSteps).toHaveLength(0)
  })

  it('delta 缺失 text 字段不报错', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('delta', 1, {})
    expect(message.content).toBe('')
  })
})
