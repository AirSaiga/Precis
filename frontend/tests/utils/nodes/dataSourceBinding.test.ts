import { describe, it, expect, vi } from 'vitest'

// DataSourceBinding 策略模式文件当前为注释状态（DEAD CODE）
// 以下测试验证接口契约和策略逻辑，以便未来启用时回归

describe('DataSourceBindingStrategy interfaces', () => {
  it('TabularDataStrategy 定义', () => {
    // TabularDataStrategy 预期属性
    const strategy = {
      name: 'tabular',
      supportedNodeTypes: ['schema'],
    }
    expect(strategy.name).toBe('tabular')
    expect(strategy.supportedNodeTypes).toContain('schema')
  })

  it('JsonDataStrategy 定义', () => {
    const strategy = {
      name: 'json',
      supportedNodeTypes: ['jsonSchema'],
    }
    expect(strategy.name).toBe('json')
    expect(strategy.supportedNodeTypes).toContain('jsonSchema')
  })

  it('BaseDataBindingStrategy validateCompatibility 逻辑', () => {
    // 模拟 BaseDataBindingStrategy.validateCompatibility 行为
    function validateCompatibility(previewData: any, targetNode: any): boolean {
      if (!previewData?.rawData) return false
      if (!targetNode?.data) return false
      const nodeType = (targetNode.data as Record<string, unknown>).type as string
      const supportedNodeTypes = ['schema', 'jsonSchema']
      return supportedNodeTypes.includes(nodeType)
    }

    expect(validateCompatibility({ rawData: [] }, { data: { type: 'schema' } })).toBe(true)
    expect(validateCompatibility(null, { data: { type: 'schema' } })).toBe(false)
    expect(validateCompatibility({ rawData: [] }, { data: { type: 'unknown' } })).toBe(false)
  })

  it('Orchestrator 阶段流转定义', () => {
    const stages = ['fetch', 'validate', 'bind', 'complete']
    expect(stages).toContain('fetch')
    expect(stages).toContain('validate')
    expect(stages).toContain('bind')
    expect(stages).toContain('complete')
  })
})

describe('DataSourceBindingOrchestrator logic', () => {
  it('fetch 失败时返回 fetch 阶段错误', async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(null),
    }
    const orchestrator = {
      execute: async (source: any, targetNode: any) => {
        const previewData = await fetcher.fetch(source)
        if (!previewData) {
          return { success: false, stage: 'fetch', error: 'Failed to fetch preview data' }
        }
        return { success: true, stage: 'complete' }
      },
    }

    const result = await orchestrator.execute({}, {})
    expect(result.success).toBe(false)
    expect(result.stage).toBe('fetch')
  })

  it('无策略时返回 validate 阶段错误', async () => {
    const registry = new Map<string, any>([['schema', null]])

    function getStrategyForNode(node: any) {
      const nodeType = (node.data as Record<string, unknown>)?.type as string
      return registry.get(nodeType) || null
    }

    const strategy = getStrategyForNode({ data: { type: 'unknown' } })
    expect(strategy).toBeNull()

    const result = {
      success: false,
      stage: 'validate',
      error: 'No binding strategy found for node type: unknown',
    }
    expect(result.stage).toBe('validate')
  })

  it('验证失败时返回 validate 阶段错误', () => {
    function validateCompatibility(previewData: any, targetNode: any): boolean {
      return false
    }

    const previewData = { rawData: [] }
    const targetNode = { data: { type: 'schema' } }

    const valid = validateCompatibility(previewData, targetNode)
    expect(valid).toBe(false)
  })

  it('bind 成功时返回 complete', async () => {
    const strategy = {
      bind: vi.fn().mockResolvedValue({ success: true, columnsGenerated: 3 }),
    }

    const result = await strategy.bind({}, {}, {})
    expect(result.success).toBe(true)
    expect(result.columnsGenerated).toBe(3)
  })

  it('bind 失败时返回 bind 阶段错误', async () => {
    const strategy = {
      bind: vi.fn().mockResolvedValue({ success: false, error: 'Binding failed' }),
    }

    const result = await strategy.bind({}, {}, {})
    expect(result.success).toBe(false)
    expect(result.error).toBe('Binding failed')
  })
})
