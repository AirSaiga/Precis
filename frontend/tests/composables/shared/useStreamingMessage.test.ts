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

  it('frontend_instruction 事件累积指令到 streamedInstructions', () => {
    const { message, handleEvent } = useStreamingMessage()
    const inst1 = { actionType: 'ADD_CONSTRAINT_NODE', constraintSpec: { type: 'NotNull' } }
    const inst2 = { actionType: 'ADD_SCHEMA', schemaSpec: { name: 'users' } }
    handleEvent('frontend_instruction', 1, { instruction: inst1 })
    handleEvent('frontend_instruction', 2, { instruction: inst2 })
    expect(message.streamedInstructions).toHaveLength(2)
    expect(message.streamedInstructions[0]).toEqual(inst1)
    expect(message.streamedInstructions[1]).toEqual(inst2)
  })

  it('frontend_instruction 缺失 instruction 字段不报错且不累积', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('frontend_instruction', 1, {})
    expect(message.streamedInstructions).toHaveLength(0)
  })

  it('start/reset 清空 streamedInstructions', () => {
    const { message, handleEvent, start, reset } = useStreamingMessage()
    handleEvent('frontend_instruction', 1, { instruction: { actionType: 'ADD_SCHEMA' } })
    expect(message.streamedInstructions).toHaveLength(1)
    start()
    expect(message.streamedInstructions).toHaveLength(0)
    handleEvent('frontend_instruction', 2, { instruction: { actionType: 'ADD_SCHEMA' } })
    expect(message.streamedInstructions).toHaveLength(1)
    reset()
    expect(message.streamedInstructions).toHaveLength(0)
  })

  // ---- ask_user 交互事件 ----

  it('初始状态 pendingAsk 为 null、askAnswered 为 false', () => {
    const { message } = useStreamingMessage()
    expect(message.pendingAsk).toBeNull()
    expect(message.askAnswered).toBe(false)
    expect(message.lastAskSummary).toBeNull()
  })

  it('user_input_requested 填充 pendingAsk（free_text）', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'free_text',
      prompt: '选哪个方案?',
      placeholder: '输入回答',
    })
    expect(message.pendingAsk).not.toBeNull()
    expect(message.pendingAsk?.askId).toBe('job-1#ask#1')
    expect(message.pendingAsk?.questionType).toBe('free_text')
    expect(message.pendingAsk?.prompt).toBe('选哪个方案?')
    expect(message.pendingAsk?.placeholder).toBe('输入回答')
    expect(message.askAnswered).toBe(false)
  })

  it('user_input_requested 映射 choice 的 options 与 multiple', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'choice',
      prompt: '选列',
      options: [
        { label: '列 A', value: 'col_a', description: '第一列' },
        { label: '列 B', value: 'col_b' },
      ],
      multiple: true,
    })
    expect(message.pendingAsk?.options).toHaveLength(2)
    expect(message.pendingAsk?.options?.[0].value).toBe('col_a')
    expect(message.pendingAsk?.options?.[0].description).toBe('第一列')
    expect(message.pendingAsk?.multiple).toBe(true)
  })

  it('user_input_requested 映射 value 的 valueType 与 optional', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'value',
      prompt: '输入数字',
      value_type: 'integer',
      optional: false,
    })
    expect(message.pendingAsk?.valueType).toBe('integer')
    expect(message.pendingAsk?.optional).toBe(false)
  })

  it('user_responded 清 pendingAsk、置 askAnswered、填 lastAskSummary（正常回答）', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'free_text',
      prompt: 'x',
    })
    expect(message.pendingAsk).not.toBeNull()
    handleEvent('user_responded', 2, {
      ask_id: 'job-1#ask#1',
      response: { answer: '用户回答' },
    })
    expect(message.pendingAsk).toBeNull()
    expect(message.askAnswered).toBe(true)
    expect(message.lastAskSummary).toBe('用户回答')
  })

  it('user_responded 跳过回答摘要为 skipped:reason', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'free_text',
      prompt: 'x',
    })
    handleEvent('user_responded', 2, {
      ask_id: 'job-1#ask#1',
      response: { skipped: true, reason: 'user_skipped' },
    })
    expect(message.askAnswered).toBe(true)
    expect(message.lastAskSummary).toBe('skipped:user_skipped')
  })

  it('user_responded 超时回答摘要为 skipped:timeout', () => {
    const { message, handleEvent } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'confirm',
      prompt: 'x',
    })
    handleEvent('user_responded', 2, {
      ask_id: 'job-1#ask#1',
      response: { skipped: true, reason: 'timeout' },
    })
    expect(message.lastAskSummary).toBe('skipped:timeout')
  })

  it('ask 事件与 apply 状态独立不互相干扰', () => {
    const { message, handleEvent } = useStreamingMessage()
    // 先设置 apply pending
    handleEvent('apply_pending', 1, {
      apply_id: 'job-1#apply#1',
      files: [],
      summary: {},
      success: true,
    })
    expect(message.pendingApply).not.toBeNull()
    // 再设置 ask pending（理论上不会同时，但验证字段独立）
    handleEvent('user_input_requested', 2, {
      ask_id: 'job-1#ask#1',
      question_type: 'choice',
      prompt: '选哪个?',
      options: [{ label: 'A', value: 'a' }],
    })
    expect(message.pendingApply).not.toBeNull() // apply 不受影响
    expect(message.pendingAsk).not.toBeNull() // ask 独立设置
    // apply 确认不影响 ask
    handleEvent('apply_confirmed', 3, {})
    expect(message.pendingApply).toBeNull()
    expect(message.pendingAsk).not.toBeNull() // ask 仍在
  })

  it('start/reset 清空 ask 状态', () => {
    const { message, handleEvent, start, reset } = useStreamingMessage()
    handleEvent('user_input_requested', 1, {
      ask_id: 'job-1#ask#1',
      question_type: 'free_text',
      prompt: 'x',
    })
    handleEvent('user_responded', 2, { ask_id: 'job-1#ask#1', response: { answer: 'a' } })
    expect(message.askAnswered).toBe(true)
    start()
    expect(message.pendingAsk).toBeNull()
    expect(message.askAnswered).toBe(false)
    expect(message.lastAskSummary).toBeNull()
    // 再测 reset
    handleEvent('user_input_requested', 3, {
      ask_id: 'job-1#ask#1',
      question_type: 'free_text',
      prompt: 'y',
    })
    reset()
    expect(message.pendingAsk).toBeNull()
    expect(message.askAnswered).toBe(false)
  })
})
