/**
 * @file useStreamingMessage.ts
 * @description 流式消息状态机
 *
 * 把 SSE 事件流聚合成可渲染的消息状态。三个场景（聊天/生成/迁移）共用。
 *
 * 核心状态：
 * - content：累积的 delta 文本
 * - toolSteps：工具轨迹（折叠卡数据源）
 * - status：streaming | completed | cancelled | error
 *
 * 关键容错：completed/cancelled/error 的完整快照会覆盖累积结果，保证最终一致性
 * （即便中途 delta 丢失，前端也能渲染完整结果）。
 */

import { reactive } from 'vue'

/** 单个工具步骤（折叠卡中的一行） */
export interface ToolStep {
  tool: string
  label: string
  turn: number
  /** 工具调用 ID，用于精确匹配 tool_result（无则用 tool+turn 退化匹配） */
  callId?: string
  actionCount?: number
  status: 'running' | 'success' | 'failed'
  error?: string
}

/** apply_pending 事件携带的单个文件 diff */
export interface PendingFileDiff {
  path: string
  status: 'modified' | 'created' | 'deleted'
  diff: string
  before_preview?: string
  after_preview?: string
}

/** apply_pending 事件数据 */
export interface PendingApply {
  /** 本次 apply 的 ID（{job_id}#{seq}），回传给 confirm 端点定位具体待确认项 */
  applyId?: string
  files: PendingFileDiff[]
  summary: Record<string, number>
  success: boolean
  error?: string
}

/** 流式消息状态 */
export interface StreamingMessage {
  content: string
  toolSteps: ToolStep[]
  isStreaming: boolean
  status: 'streaming' | 'completed' | 'cancelled' | 'error'
  /** completed/cancelled 事件携带的完整数据（reply/tool_steps/frontend_instructions 等） */
  result: StreamingResult | null
  /** 取消/失败时的元信息 */
  errorMessage: string
  completedTurns: number
  /** 流式任务 ID（started 事件捕获，供 confirm 端点使用） */
  jobId: string
  /** 挂起的 apply_actions 改动（apply_pending 事件填充） */
  pendingApply: PendingApply | null
  /**
   * 流式画布生长：apply_actions 落盘后逐条收到的 frontend_instruction 事件累积。
   * 每条已由 aiChatStore 实时执行（processFrontendInstructions + fitView），
   * 完成后供 completed 兜底批量路径去重，避免重复应用同一指令。
   */
  streamedInstructions: unknown[]
}

/** 终止事件的完整快照（completed/cancelled 携带） */
export interface StreamingResult {
  reply?: string
  frontend_instructions?: unknown[]
  tool_steps?: Array<{ tool: string; label: string; turn: number; action_count?: number }>
  iterations?: number
}

/** SSE 事件 data 的结构（与后端 types.py 对齐） */
interface EventData {
  text?: string
  job_id?: string
  turn?: number
  tool?: string
  call_id?: string
  label?: string
  action_count?: number
  success?: boolean
  error?: string
  name?: string
  reply?: string
  frontend_instructions?: unknown[]
  tool_steps?: Array<{ tool: string; label: string; turn: number; action_count?: number }>
  iterations?: number
  completed_turns?: number
  partial?: boolean
  message?: string
  code?: string
  files?: unknown[]
  summary?: Record<string, number>
  /** apply_pending 携带的本次 apply ID（{job_id}#{seq}） */
  apply_id?: string
  reason?: string
  decision?: string
  /** frontend_instruction 事件携带的单条前端指令（流式画布生长） */
  instruction?: unknown
}

/**
 * 创建一个流式消息状态机。
 *
 * 用法：
 * ```ts
 * const { message, handleEvent, reset } = useStreamingMessage()
 * // 喂入 SSE 事件
 * handleEvent('delta', 3, { text: '你好' })
 * handleEvent('completed', 9, { reply: '你好世界', tool_steps: [...] })
 * ```
 */
/**
 * 合并后端 tool_steps 快照与本地已有步骤，保留已有 status（不强制全标 success）。
 *
 * 后端 tool_steps 是权威的完整列表，但不含 status 信息（只有 tool/label/turn/action_count）。
 * 本地步骤在流式过程中已通过 tool_result 更新了 status（success/failed）。
 * 合并策略：以后端快照为基准，若本地有同 tool+turn 的步骤，沿用其 status。
 */
function mergeToolSteps(
  existingSteps: ToolStep[],
  backendSteps: Array<{ tool: string; label: string; turn: number; action_count?: number }>
): ToolStep[] {
  return backendSteps.map((bs) => {
    // 查找本地已有的同 tool+turn 步骤
    const local = existingSteps.find((s) => s.tool === bs.tool && s.turn === bs.turn)
    return {
      tool: bs.tool,
      label: bs.label,
      turn: bs.turn,
      actionCount: bs.action_count,
      // 沿用本地已有的 status（可能已通过 tool_result 更新为 failed），默认 success
      status: local?.status ?? ('success' as const),
      error: local?.error,
    }
  })
}

export function useStreamingMessage() {
  const message = reactive<StreamingMessage>({
    content: '',
    toolSteps: [],
    isStreaming: false,
    status: 'streaming',
    result: null,
    errorMessage: '',
    completedTurns: 0,
    jobId: '',
    pendingApply: null,
    streamedInstructions: [],
  })

  /** 开始一次新的流式会话（重置状态） */
  function start() {
    message.content = ''
    message.toolSteps = []
    message.isStreaming = true
    message.status = 'streaming'
    message.result = null
    message.errorMessage = ''
    message.completedTurns = 0
    message.jobId = ''
    message.pendingApply = null
    message.streamedInstructions = []
  }

  /** 重置为初始空状态 */
  function reset() {
    message.content = ''
    message.toolSteps = []
    message.isStreaming = false
    message.status = 'streaming'
    message.result = null
    message.errorMessage = ''
    message.completedTurns = 0
    message.jobId = ''
    message.pendingApply = null
    message.streamedInstructions = []
  }

  /** 处理一个 SSE 事件，更新状态 */
  function handleEvent(event: string, _id: number | null, rawData: unknown) {
    const data = (rawData ?? {}) as EventData

    switch (event) {
      case 'started': {
        if (typeof data.job_id === 'string') {
          message.jobId = data.job_id
        }
        break
      }
      case 'delta': {
        if (typeof data.text === 'string') {
          message.content += data.text
        }
        break
      }
      case 'turn_start': {
        // 新轮次开始：当前无 running 步骤时提示新一轮（可选，折叠卡自身按轮次展示）
        break
      }
      case 'tool_call': {
        // 去重：同 callId 的步骤不重复 push（防止重连重放）
        const callId = data.call_id ?? undefined
        if (callId && message.toolSteps.some((s) => s.callId === callId)) {
          break
        }
        message.toolSteps.push({
          tool: data.tool ?? 'unknown',
          label: data.label ?? data.tool ?? 'unknown',
          turn: data.turn ?? 0,
          callId,
          actionCount: data.action_count,
          status: 'running',
        })
        break
      }
      case 'tool_result': {
        // 优先用 call_id 精确匹配，无 call_id 时退化 name+turn 匹配最近 running 步骤
        const callId = data.call_id ?? undefined
        let targetStep: ToolStep | undefined
        if (callId) {
          targetStep = message.toolSteps.find((s) => s.callId === callId)
        }
        if (!targetStep) {
          // 退化匹配：按 name 找最近一个 running 步骤
          const name = data.name ?? data.tool
          const idx = [...message.toolSteps]
            .reverse()
            .findIndex((s) => s.tool === name && s.status === 'running')
          if (idx !== -1) {
            targetStep = message.toolSteps[message.toolSteps.length - 1 - idx]
          }
        }
        if (targetStep) {
          targetStep.status = data.success === false ? 'failed' : 'success'
          if (data.error) targetStep.error = data.error
        }
        break
      }
      case 'apply_pending': {
        message.pendingApply = {
          applyId: typeof data.apply_id === 'string' ? data.apply_id : undefined,
          files: Array.isArray(data.files) ? (data.files as PendingFileDiff[]) : [],
          summary: (data.summary ?? {}) as Record<string, number>,
          success: data.success !== false,
          error: typeof data.error === 'string' ? data.error : undefined,
        }
        break
      }
      case 'apply_confirmed': {
        message.pendingApply = null
        break
      }
      case 'apply_rejected': {
        message.pendingApply = null
        break
      }
      case 'frontend_instruction': {
        // 流式画布生长：累积 apply_actions 落盘的单条指令。
        // 纯状态累积，实际执行（processFrontendInstructions + fitView）由 aiChatStore 在
        // onEvent 处理时完成；此处记录供 completed 兜底批量路径去重。
        if (data.instruction) {
          message.streamedInstructions.push(data.instruction)
        }
        break
      }
      case 'completed': {
        // 终止事件：用完整快照覆盖累积结果（容错兜底，防丢）
        message.isStreaming = false
        message.status = 'completed'
        message.result = {
          reply: data.reply,
          frontend_instructions: data.frontend_instructions,
          tool_steps: data.tool_steps,
          iterations: data.iterations,
        }
        if (typeof data.reply === 'string') {
          message.content = data.reply
        }
        // 用完整 tool_steps 覆盖，但保留已有 status（不强制全标 success）
        if (Array.isArray(data.tool_steps)) {
          message.toolSteps = mergeToolSteps(message.toolSteps, data.tool_steps)
        }
        break
      }
      case 'cancelled': {
        message.isStreaming = false
        message.status = 'cancelled'
        message.completedTurns = data.completed_turns ?? 0
        // cancelled 也写 result（携带已执行的 frontend_instructions/iterations）
        message.result = {
          reply: data.reply,
          frontend_instructions: data.frontend_instructions,
          tool_steps: data.tool_steps,
          iterations: data.completed_turns,
        }
        if (Array.isArray(data.tool_steps)) {
          message.toolSteps = mergeToolSteps(message.toolSteps, data.tool_steps)
        }
        break
      }
      case 'error': {
        message.isStreaming = false
        message.status = 'error'
        message.errorMessage = data.message ?? '未知错误'
        break
      }
      // started/progress 等事件不直接改变消息状态，可选记录
      default:
        break
    }
  }

  return { message, handleEvent, start, reset }
}
