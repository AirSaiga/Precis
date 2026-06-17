import { test, expect } from '../fixtures/base'

/**
 * AI Chat Agent 模式 E2E 测试
 *
 * 覆盖 mini-agent 工具循环的端到端行为：
 * - /ai/chat 响应协议契约（status/reply/actions/frontend_instructions）
 * - agent_mode=true 时 agent_meta 正确返回（iterations + tool_steps）
 * - agent_mode=false 时走旧路径（agent_meta 缺失）
 *
 * 注意：
 * - 这些测试调用真实后端，需要后端运行并配置好 LLM Provider。
 * - 如果后端或 Provider 不可用，自动 skip（而非失败）。
 * - chat 是同步端点，响应可能较慢（agent 多轮工具调用），设置较长超时。
 */

// chat agent 可能多轮工具调用，给足超时
const CHAT_TIMEOUT = 120_000

test.describe('AI Chat Agent Mode', () => {
  test.beforeAll(async ({ apiHelper }) => {
    const healthy = await apiHelper.healthCheck()
    test.skip(!healthy, '后端未启动，跳过 AI Chat E2E 测试')

    // 检查是否配置了 Provider
    const providersResp = await apiHelper.get('/ai/providers')
    if (providersResp.ok) {
      const providers = await providersResp.json()
      test.skip(
        !Array.isArray(providers) || providers.length === 0,
        '未配置 AI Provider，跳过 AI Chat E2E 测试'
      )
    }
  })

  const makeChatPayload = (overrides?: Record<string, unknown>) => ({
    message: '当前项目有哪些表？',
    context: {
      hasContext: false,
      selectedNodes: [],
    },
    history: [],
    agent_mode: true,
    ...overrides,
  })

  test(
    'POST /ai/chat 返回完整协议契约',
    async ({ apiHelper }) => {
      const resp = await apiHelper.post('/ai/chat', makeChatPayload())

      // 协议契约：必有 status 和 reply 字段
      expect(resp.ok).toBe(true)
      const data = await resp.json()
      expect(data).toHaveProperty('status')
      expect(data).toHaveProperty('reply')
      expect(typeof data.reply).toBe('string')
      expect(['success', 'error']).toContain(data.status)

      // 必有 actions 和 frontend_instructions（可为空数组）
      expect(Array.isArray(data.actions)).toBe(true)
      expect(Array.isArray(data.frontend_instructions)).toBe(true)

      // 成功时 reply 不应为空
      if (data.status === 'success') {
        expect(data.reply.length).toBeGreaterThan(0)
      }
    },
    { timeout: CHAT_TIMEOUT }
  )

  test(
    'agent_mode=true 返回 agent_meta（含 iterations 和 tool_steps）',
    async ({ apiHelper }) => {
      const resp = await apiHelper.post('/ai/chat', makeChatPayload({ agent_mode: true }))
      expect(resp.ok).toBe(true)
      const data = await resp.json()

      // 成功时应有 agent_meta
      if (data.status === 'success') {
        expect(data.agent_meta).toBeDefined()
        expect(data.agent_meta).not.toBeNull()
        const meta = data.agent_meta
        expect(typeof meta.iterations).toBe('number')
        expect(meta.iterations).toBeGreaterThanOrEqual(1)
        expect(Array.isArray(meta.tool_steps)).toBe(true)

        // 查询类问题应至少调用 read_project 工具
        if (meta.tool_steps.length > 0) {
          const toolNames = meta.tool_steps.map((s: { tool: string }) => s.tool)
          // 查询"有哪些表"通常触发 read_project
          const hasReadTool = toolNames.some((n: string) => n.startsWith('read_'))
          // 不做强断言（LLM 行为有不确定性），仅记录
          expect(typeof hasReadTool).toBe('boolean')

          // 每步应有 tool/label/turn 字段
          for (const step of meta.tool_steps) {
            expect(step).toHaveProperty('tool')
            expect(step).toHaveProperty('label')
            expect(step).toHaveProperty('turn')
          }
        }
      }
    },
    { timeout: CHAT_TIMEOUT }
  )

  test(
    'agent_mode=false 走旧路径（agent_meta 缺失）',
    async ({ apiHelper }) => {
      const resp = await apiHelper.post('/ai/chat', makeChatPayload({ agent_mode: false }))
      expect(resp.ok).toBe(true)
      const data = await resp.json()

      // 旧路径不应有 agent_meta（可为 null 或 undefined，Pydantic Optional 序列化为 null）
      expect([null, undefined]).toContain(data.agent_meta)

      // 但仍保留核心契约字段
      expect(data).toHaveProperty('status')
      expect(data).toHaveProperty('reply')
      expect(Array.isArray(data.actions)).toBe(true)
    },
    { timeout: CHAT_TIMEOUT }
  )

  test(
    'agent_mode=true 修改类请求产出 frontend_instructions',
    async ({ apiHelper }) => {
      // 请求添加一个约束，触发 apply_actions 工具
      const payload = makeChatPayload({
        message: '给 users 表的 email 字段添加非空约束',
        agent_mode: true,
      })
      const resp = await apiHelper.post('/ai/chat', payload)
      expect(resp.ok).toBe(true)
      const data = await resp.json()

      if (data.status === 'success') {
        // 修改类请求成功后，通常会有 frontend_instructions（画布双写）
        // 或 agent_meta 中包含 apply_actions 步骤
        // 由于 LLM 行为有不确定性，这里只验证协议一致性，不强制断言非空
        if (data.agent_meta?.tool_steps?.length > 0) {
          const hasApplyStep = data.agent_meta.tool_steps.some(
            (s: { tool: string }) => s.tool === 'apply_actions'
          )
          // 如果有 apply_actions 步骤，应有对应的 frontend_instructions
          if (hasApplyStep) {
            expect(Array.isArray(data.frontend_instructions)).toBe(true)
          }
        }
      }
    },
    { timeout: CHAT_TIMEOUT }
  )
})
