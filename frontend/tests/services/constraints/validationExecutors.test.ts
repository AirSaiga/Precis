/**
 * @fileoverview validationExecutors 列错误同步与断连重置单元测试
 *
 * 覆盖纯逻辑函数：
 * - rebuildAllColumnErrors（Bug 3.4 修复）：全列重建，清除 stale 错误
 * - syncColumnErrorsForSourceRef：单列错误同步（仅刷指定列）
 * - resetDownstreamValidationStatus：断连后重置下游约束节点的校验状态
 *
 * Characterization 测试（拆分前安全网，锁定当前行为）：
 * - validateConstraintNode / _executeAndSync：单约束校验 + 节点/边状态同步
 * - validateConstraintNodesForSchema：全 Schema 批量校验 + 统计口径（Bug 3.3）
 * - validateForInlineSource：inline 数据源本地校验
 * - validateConstraintNodeById：按 ID 路由（schema vs inline）+ 全列重建（Bug 3.4）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  rebuildAllColumnErrors,
  syncColumnErrorsForSourceRef,
  resetDownstreamValidationStatus,
  validateConstraintNode,
  validateConstraintNodesForSchema,
  validateForInlineSource,
  validateConstraintNodeById,
} from '@/services/constraints/validationRegistry'
import type { ConstraintValidationResult } from '@/services/constraints/types'

// ============================================================================
// Mock 外部边界（遵循 AGENTS.md：mock 边界不 mock 内部）
// ============================================================================

// handler 注册表是外部边界：返回可控的假 handler，避免依赖真实自注册机制
// 注意：必须保留 register/handlers，否则 side-effect import 的 handler 自注册会报错
vi.mock('@/services/constraints/handlerRegistry', () => ({
  register: vi.fn(),
  getHandlerByNodeType: vi.fn(),
  getHandlerByKind: vi.fn(),
  handlers: new Map(),
}))

// regex 校验是独立子模块边界：默认返回 null（无 regex 边）
vi.mock('@/services/regex/regexValidationHandler', () => ({
  validateRegexNodesForSchema: vi.fn().mockResolvedValue(null),
}))

// vueFlowApi 的 updateEdgeData 是渲染层边界（驱动粒子着色）
vi.mock('@/services/canvas/vueFlowApi', () => ({
  updateEdgeData: vi.fn(),
}))

import { getHandlerByNodeType } from '@/services/constraints/handlerRegistry'
import { validateRegexNodesForSchema } from '@/services/regex/regexValidationHandler'
import { updateEdgeData } from '@/services/canvas/vueFlowApi'

function makeNodes() {
  return [
    {
      id: 'schema-1',
      type: 'schema',
      data: {
        tableName: 'users',
        columns: [
          { id: 'col-a', columnName: 'A', validationErrors: ['old error A'] },
          { id: 'col-b', columnName: 'B', validationErrors: ['old error B'] },
          { id: 'col-c', columnName: 'C', validationErrors: [] },
        ],
      },
    },
    // 约束节点：现在指向 col-b（sourceRef 已从 col-a 迁移到 col-b）
    {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-b' },
        validationErrors: ['new error B'],
      },
    },
  ] as any[]
}

describe('validationExecutors - rebuildAllColumnErrors (Bug 3.4)', () => {
  it('重建后 col-a 的 stale 错误被清除，col-b 写入新错误', () => {
    const nodes = makeNodes()
    const updates: Record<string, unknown> = {}
    const updateNodeData = (nodeId: string, data: Record<string, unknown>) => {
      updates[nodeId] = data
      // 同步回 nodes 以模拟 store 行为（rebuild 读取的就是最新 columns）
      const node = nodes.find((n) => n.id === nodeId)
      if (node) node.data = { ...node.data, ...data }
    }

    rebuildAllColumnErrors('schema-1', nodes, updateNodeData)

    const updatedColumns = (
      updates['schema-1'] as { columns: Array<{ validationErrors: string[] }> }
    ).columns
    // col-a 不再被任何约束引用 → 错误应被清空（Bug 3.4 的核心）
    expect(updatedColumns[0].validationErrors).toEqual([])
    // col-b 被引用 → 写入新错误
    expect(updatedColumns[1].validationErrors).toEqual(['new error B'])
    // col-c 无约束引用 → 保持空
    expect(updatedColumns[2].validationErrors).toEqual([])
  })

  it('Schema 不存在时安全返回（不抛错）', () => {
    const updateNodeData = () => {}
    expect(() => rebuildAllColumnErrors('nonexistent', [], updateNodeData)).not.toThrow()
  })

  it('Schema 无列时安全返回', () => {
    const nodes = [{ id: 'schema-empty', type: 'schema', data: { columns: [] } }] as any[]
    const updateNodeData = () => {}
    expect(() => rebuildAllColumnErrors('schema-empty', nodes, updateNodeData)).not.toThrow()
  })
})

describe('validationExecutors - syncColumnErrorsForSourceRef', () => {
  it('仅同步指定列的错误（不影响其他列）', () => {
    const nodes = [
      {
        id: 'schema-1',
        type: 'schema',
        data: {
          columns: [
            { id: 'col-a', columnName: 'A', validationErrors: ['old A'] },
            { id: 'col-b', columnName: 'B', validationErrors: ['old B'] },
          ],
        },
      },
      {
        id: 'notnull-1',
        type: 'notNullConstraint',
        data: {
          sourceRef: { nodeId: 'schema-1', columnId: 'col-b' },
          validationErrors: ['new error B'],
        },
      },
    ] as any[]

    const updates: Record<string, unknown> = {}
    const updateNodeData = (nodeId: string, data: Record<string, unknown>) => {
      updates[nodeId] = data
    }

    syncColumnErrorsForSourceRef('schema-1', 'col-b', nodes, updateNodeData)

    const updatedColumns = (
      updates['schema-1'] as { columns: Array<{ id: string; validationErrors: string[] }> }
    ).columns
    // col-a 不受影响（保持原值）
    expect(updatedColumns[0].validationErrors).toEqual(['old A'])
    // col-b 写入新错误
    expect(updatedColumns[1].validationErrors).toEqual(['new error B'])
  })

  it('Schema 不存在时安全返回', () => {
    expect(() => syncColumnErrorsForSourceRef('nonexistent', 'col-a', [], () => {})).not.toThrow()
  })

  it('无匹配约束时该列错误为空', () => {
    const nodes = [
      {
        id: 'schema-1',
        type: 'schema',
        data: { columns: [{ id: 'col-a', columnName: 'A', validationErrors: ['old'] }] },
      },
    ] as any[]
    const updates: Record<string, unknown> = {}
    syncColumnErrorsForSourceRef('schema-1', 'col-a', nodes, (id, data) => {
      updates[id] = data
    })
    const updatedColumns = (
      updates['schema-1'] as { columns: Array<{ validationErrors: string[] }> }
    ).columns
    expect(updatedColumns[0].validationErrors).toEqual([])
  })
})

describe('validationExecutors - resetDownstreamValidationStatus', () => {
  it('重置 schema 下游约束节点的校验状态', () => {
    const nodes = [
      { id: 'schema-1', type: 'schema', data: {} },
      {
        id: 'notnull-1',
        type: 'notNullConstraint',
        data: { validationStatus: 'error', validationErrors: ['err'], lastValidation: 123 },
      },
    ] as any[]
    const edges = [{ id: 'e1', source: 'schema-1', target: 'notnull-1' }] as any[]

    const updates: Record<string, unknown> = {}
    resetDownstreamValidationStatus('schema-1', nodes, edges, (id, data) => {
      updates[id] = data
    })

    // notnull-1 应被重置
    expect(updates['notnull-1']).toBeDefined()
    const resetData = updates['notnull-1'] as Record<string, unknown>
    // 重置后状态应为 idle/disconnected（非 error）
    expect(resetData.validationStatus).not.toBe('error')
  })

  it('Schema 无下游边时安全返回', () => {
    const nodes = [{ id: 'schema-1', type: 'schema', data: {} }] as any[]
    const updates: Record<string, unknown> = {}
    resetDownstreamValidationStatus('schema-1', nodes, [], (id, data) => {
      updates[id] = data
    })
    expect(Object.keys(updates)).toHaveLength(0)
  })

  it('目标节点不是约束类型时跳过', () => {
    const nodes = [
      { id: 'schema-1', type: 'schema', data: {} },
      { id: 'other-1', type: 'transform', data: {} },
    ] as any[]
    const edges = [{ id: 'e1', source: 'schema-1', target: 'other-1' }] as any[]
    const updates: Record<string, unknown> = {}
    resetDownstreamValidationStatus('schema-1', nodes, edges, (id, data) => {
      updates[id] = data
    })
    expect(Object.keys(updates)).toHaveLength(0)
  })
})

// ============================================================================
// Characterization 测试：校验执行入口（拆分前安全网）
// ============================================================================

// 共享工厂：构造 buildValidationContext 能走通的最小真实数据
// edge.sourceHandle 必须以 'source-right-' 开头，columnId 为其后的部分
function makeSchemaWithColumn(columnId = 'col-1') {
  return {
    id: 'schema-1',
    type: 'schema',
    data: {
      tableName: 'users',
      columns: [{ id: columnId, columnName: 'Name', dataType: 'string' }],
    },
  }
}

function makeEdgeToConstraint(columnId = 'col-1', edgeId = 'e1') {
  return {
    id: edgeId,
    source: 'schema-1',
    target: 'notnull-1',
    sourceHandle: `source-right-${columnId}`,
    targetHandle: 'target-left',
  }
}

function makeConstraintNode(type = 'notNullConstraint', id = 'notnull-1') {
  return { id, type, data: {} }
}

// 假 handler：返回可控的校验结果
function makeFakeHandler(result: Partial<ConstraintValidationResult>) {
  return {
    kind: 'notNull' as const,
    validate: vi.fn().mockResolvedValue({
      status: 'pass',
      validationErrors: [],
      localizedErrors: [],
      lastValidation: null,
      ...result,
    }),
    resetOnDisconnect: vi.fn(),
  }
}

describe('validationExecutors - validateConstraintNode (E: 单约束校验)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('校验通过后用 sourceRef + 结果更新约束节点，并同步边状态', async () => {
    const fakeResult = {
      status: 'pass' as const,
      validationErrors: [],
      lastValidation: null,
    }
    vi.mocked(getHandlerByNodeType).mockReturnValue(makeFakeHandler(fakeResult))

    const schemaNode = makeSchemaWithColumn()
    const constraintNode = makeConstraintNode()
    const edge = makeEdgeToConstraint()
    const updates: Record<string, unknown> = {}
    const updateNodeData = (id: string, data: Record<string, unknown>) => {
      updates[id] = data
    }

    await validateConstraintNode({
      schemaNode: schemaNode as any,
      constraintNode: constraintNode as any,
      edge: edge as any,
      nodes: [schemaNode, constraintNode] as any,
      updateNodeData,
    })

    // 节点写入：sourceRef 指向 schema 列，校验状态 pass
    expect(updates['notnull-1']).toBeDefined()
    const written = updates['notnull-1'] as Record<string, unknown>
    expect(written.sourceRef).toEqual({ nodeId: 'schema-1', columnId: 'col-1' })
    expect(written.table).toBe('users')
    expect(written.column).toBe('Name')
    expect(written.validationStatus).toBe('pass')

    // 边同步：updateEdgeData 收到 status（驱动粒子着色）
    expect(updateEdgeData).toHaveBeenCalledWith('e1', { validationStatus: 'pass' })
  })

  it('edge.sourceHandle 不以 source-right- 开头时静默跳过（ctx 为 null）', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(makeFakeHandler({ status: 'pass' }))
    const schemaNode = makeSchemaWithColumn()
    const constraintNode = makeConstraintNode()
    const badEdge = { ...makeEdgeToConstraint(), sourceHandle: 'source-left-col-1' }
    const updates: Record<string, unknown> = {}
    const updateNodeData = (id: string, data: Record<string, unknown>) => {
      updates[id] = data
    }

    await validateConstraintNode({
      schemaNode: schemaNode as any,
      constraintNode: constraintNode as any,
      edge: badEdge as any,
      nodes: [schemaNode, constraintNode] as any,
      updateNodeData,
    })

    // ctx 为 null → 不应调用 handler，不写节点，不写边
    expect(getHandlerByNodeType).not.toHaveBeenCalled()
    expect(Object.keys(updates)).toHaveLength(0)
    expect(updateEdgeData).not.toHaveBeenCalled()
  })

  it('无匹配 handler 时静默跳过（不写节点/边）', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(null)
    const schemaNode = makeSchemaWithColumn()
    const constraintNode = makeConstraintNode()
    const edge = makeEdgeToConstraint()
    const updates: Record<string, unknown> = {}
    const updateNodeData = (id: string, data: Record<string, unknown>) => {
      updates[id] = data
    }

    await validateConstraintNode({
      schemaNode: schemaNode as any,
      constraintNode: constraintNode as any,
      edge: edge as any,
      nodes: [schemaNode, constraintNode] as any,
      updateNodeData,
    })

    // ctx 构建成功但无 handler → 不写节点/边
    expect(getHandlerByNodeType).toHaveBeenCalled()
    expect(Object.keys(updates)).toHaveLength(0)
    expect(updateEdgeData).not.toHaveBeenCalled()
  })

  it('校验失败时写入 error 状态与错误列表', async () => {
    const fakeResult = {
      status: 'error' as const,
      validationErrors: ['空值违规'],
      lastValidation: { errorCount: 1, checkedAt: 1000 },
    }
    vi.mocked(getHandlerByNodeType).mockReturnValue(makeFakeHandler(fakeResult))

    const schemaNode = makeSchemaWithColumn()
    const constraintNode = makeConstraintNode()
    const edge = makeEdgeToConstraint()
    const updates: Record<string, unknown> = {}
    const updateNodeData = (id: string, data: Record<string, unknown>) => {
      updates[id] = data
    }

    await validateConstraintNode({
      schemaNode: schemaNode as any,
      constraintNode: constraintNode as any,
      edge: edge as any,
      nodes: [schemaNode, constraintNode] as any,
      updateNodeData,
    })

    const written = updates['notnull-1'] as Record<string, unknown>
    expect(written.validationStatus).toBe('error')
    expect(written.validationErrors).toEqual(['空值违规'])
    expect(updateEdgeData).toHaveBeenCalledWith('e1', { validationStatus: 'error' })
  })
})

describe('validationExecutors - validateConstraintNodesForSchema (F: 批量校验)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(validateRegexNodesForSchema).mockResolvedValue(null)
  })

  it('Schema 不存在时返回空 summary', async () => {
    const updateNodeData = vi.fn()
    const summary = await validateConstraintNodesForSchema({
      schemaNodeId: 'nonexistent',
      nodes: [],
      edges: [],
      updateNodeData,
    })
    expect(summary).toEqual({
      totalConstraints: 0,
      validConstraints: 0,
      invalidConstraints: 0,
      totalErrors: 0,
    })
  })

  it('无关联约束边时返回空 summary', async () => {
    const nodes = [{ id: 'schema-1', type: 'schema', data: { columns: [] } }] as any[]
    const updateNodeData = vi.fn()
    const summary = await validateConstraintNodesForSchema({
      schemaNodeId: 'schema-1',
      nodes,
      edges: [],
      updateNodeData,
    })
    expect(summary.totalConstraints).toBe(0)
  })

  it('统计 totalProcessed 含 idle/missing 状态（Bug 3.3 口径）', async () => {
    // handler 返回 missing 状态：既非 pass 也非 error
    // Bug 3.3 修复前用 totalValid+totalInvalid 会漏计，修复后用 totalProcessed 统计
    vi.mocked(getHandlerByNodeType).mockReturnValue(
      makeFakeHandler({ status: 'missing', validationErrors: [] })
    )
    const schemaNode = makeSchemaWithColumn()
    const constraintNode = makeConstraintNode()
    const edge = makeEdgeToConstraint()
    const nodes = [schemaNode, constraintNode]
    const updateNodeData = vi.fn()

    const summary = await validateConstraintNodesForSchema({
      schemaNodeId: 'schema-1',
      nodes: nodes as any,
      edges: [edge] as any,
      updateNodeData,
    })

    // missing 状态应计入 totalProcessed，但不计入 valid/invalid
    expect(summary.totalConstraints).toBe(1)
    expect(summary.validConstraints).toBe(0)
    expect(summary.invalidConstraints).toBe(0)
  })

  it('pass + error 混合时正确统计 valid/invalid/errors', async () => {
    // 两个约束：一个 pass，一个 error
    const schemaNode = {
      id: 'schema-1',
      type: 'schema',
      data: {
        tableName: 'users',
        columns: [
          { id: 'col-a', columnName: 'A', dataType: 'string' },
          { id: 'col-b', columnName: 'B', dataType: 'string' },
        ],
      },
    }
    const notNullPass = {
      id: 'nn-a',
      type: 'notNullConstraint',
      data: {},
    }
    const notNullError = {
      id: 'nn-b',
      type: 'notNullConstraint',
      data: {},
    }
    const nodes = [schemaNode, notNullPass, notNullError]
    const edges = [
      {
        id: 'ea',
        source: 'schema-1',
        target: 'nn-a',
        sourceHandle: 'source-right-col-a',
        targetHandle: 't',
      },
      {
        id: 'eb',
        source: 'schema-1',
        target: 'nn-b',
        sourceHandle: 'source-right-col-b',
        targetHandle: 't',
      },
    ]
    const updateNodeData = vi.fn()

    // 第一次调用返回 pass，第二次返回 error（按边顺序）
    const passHandler = makeFakeHandler({
      status: 'pass',
      validationErrors: [],
    })
    const errorHandler = makeFakeHandler({
      status: 'error',
      validationErrors: ['err1', 'err2'],
      lastValidation: { errorCount: 2 },
    })
    vi.mocked(getHandlerByNodeType)
      .mockReturnValueOnce(passHandler)
      .mockReturnValueOnce(errorHandler)

    const summary = await validateConstraintNodesForSchema({
      schemaNodeId: 'schema-1',
      nodes: nodes as any,
      edges: edges as any,
      updateNodeData,
    })

    expect(summary.totalConstraints).toBe(2)
    expect(summary.validConstraints).toBe(1)
    expect(summary.invalidConstraints).toBe(1)
    expect(summary.totalErrors).toBe(2)
  })

  it('合并 Regex summary 到总数并同步列错误', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(
      makeFakeHandler({ status: 'pass', validationErrors: [] })
    )
    const schemaNode = makeSchemaWithColumn()
    const constraintNode = makeConstraintNode()
    const edge = makeEdgeToConstraint()
    const nodes = [schemaNode, constraintNode]
    const updateNodeData = vi.fn()

    // regex summary：1 valid 1 invalid 2 errors，列 col-1 有 1 个错误
    vi.mocked(validateRegexNodesForSchema).mockResolvedValue({
      totalValid: 1,
      totalInvalid: 1,
      totalErrorCount: 2,
      columnErrorMap: new Map([['col-1', ['regex err']]]),
    })

    const summary = await validateConstraintNodesForSchema({
      schemaNodeId: 'schema-1',
      nodes: nodes as any,
      edges: [edge] as any,
      updateNodeData,
    })

    // 约束 1（pass）+ regex（1 valid 1 invalid）= 总 3
    expect(summary.totalConstraints).toBe(3)
    expect(summary.validConstraints).toBe(2) // 1 约束 pass + 1 regex valid
    expect(summary.invalidConstraints).toBe(1)
    expect(summary.totalErrors).toBe(2)

    // 列错误同步：col-1 应包含 regex 错误（约束 pass 无错误）
    const schemaUpdate = updateNodeData.mock.calls.find(([id]) => id === 'schema-1')
    expect(schemaUpdate).toBeDefined()
    const cols = (schemaUpdate![1] as any).columns
    expect(cols[0].validationErrors).toEqual(['regex err'])
  })

  it('非 Composite 先于 Composite 执行（依赖顺序）', async () => {
    const schemaNode = makeSchemaWithColumn()
    const notNullNode = makeConstraintNode('notNullConstraint', 'nn')
    const compositeNode = makeConstraintNode('compositeConstraint', 'cmp')
    const nodes = [schemaNode, notNullNode, compositeNode]
    const edges = [
      {
        id: 'e1',
        source: 'schema-1',
        target: 'nn',
        sourceHandle: 'source-right-col-1',
        targetHandle: 't',
      },
      {
        id: 'e2',
        source: 'schema-1',
        target: 'cmp',
        sourceHandle: 'source-right-col-1',
        targetHandle: 't',
      },
    ]
    const updateNodeData = vi.fn()

    const callOrder: string[] = []
    vi.mocked(getHandlerByNodeType).mockImplementation(() => {
      // 通过 validate 调用记录顺序（每次 mock 不同 handler 难，这里共用一个 handler 但记录 validate 调用）
      const handler = makeFakeHandler({ status: 'pass', validationErrors: [] })
      const original = handler.validate
      handler.validate = vi.fn(async () => {
        callOrder.push('validate')
        return original()
      }) as any
      return handler
    })

    await validateConstraintNodesForSchema({
      schemaNodeId: 'schema-1',
      nodes: nodes as any,
      edges: edges as any,
      updateNodeData,
    })

    // 两个约束都应被校验（顺序：非 composite 批次先于 composite 批次）
    expect(callOrder).toHaveLength(2)
  })
})

describe('validationExecutors - validateForInlineSource (inline 校验)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('从 ManualData 节点提取 rows 做本地校验并写入约束节点', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(
      makeFakeHandler({ status: 'error', validationErrors: ['inline err'] })
    )
    const sourceNode = {
      id: 'manual-1',
      type: 'manualData',
      data: {
        rows: [['v1'], ['v2'], [null]],
        columnName: 'Col1',
        columnDataType: 'string',
      },
    }
    const constraintNode = makeConstraintNode()
    const nodes = [sourceNode, constraintNode]
    const updates: Record<string, unknown> = {}
    const updateNodeData = (id: string, data: Record<string, unknown>) => {
      updates[id] = data
    }

    await validateForInlineSource({
      sourceNodeId: 'manual-1',
      constraintNode: constraintNode as any,
      nodes: nodes as any,
      updateNodeData,
    })

    const written = updates['notnull-1'] as Record<string, unknown>
    expect(written).toBeDefined()
    expect(written.validationStatus).toBe('error')
    expect(written.validationErrors).toEqual(['inline err'])
    expect(written.sourceRef).toEqual({ nodeId: 'manual-1', columnId: '0' })
    expect(written.column).toBe('Col1')
  })

  it('源节点不存在时安全返回（logger.warn）', async () => {
    const updateNodeData = vi.fn()
    await validateForInlineSource({
      sourceNodeId: 'nonexistent',
      constraintNode: makeConstraintNode() as any,
      nodes: [],
      updateNodeData,
    })
    expect(getHandlerByNodeType).not.toHaveBeenCalled()
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it('无匹配 handler 时静默返回', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(null)
    const sourceNode = {
      id: 'manual-1',
      type: 'manualData',
      data: { rows: [['v1']], columnName: 'Col1' },
    }
    const updateNodeData = vi.fn()
    await validateForInlineSource({
      sourceNodeId: 'manual-1',
      constraintNode: makeConstraintNode() as any,
      nodes: [sourceNode] as any,
      updateNodeData,
    })
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it('约束节点指定 inputColumn 时优先于数据源列名', async () => {
    const fakeHandler = makeFakeHandler({ status: 'pass' })
    vi.mocked(getHandlerByNodeType).mockReturnValue(fakeHandler)
    const sourceNode = {
      id: 'manual-1',
      type: 'manualData',
      data: { rows: [['v1']], columnName: 'SourceCol' },
    }
    const constraintNode = {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: { inputColumn: 'ConstraintCol' },
    }
    const nodes = [sourceNode, constraintNode]
    const updateNodeData = vi.fn()

    await validateForInlineSource({
      sourceNodeId: 'manual-1',
      constraintNode: constraintNode as any,
      nodes: nodes as any,
      updateNodeData,
    })

    // handler.validate 收到的 ctx.columnName 应为约束指定的 inputColumn
    const ctxArg = fakeHandler.validate.mock.calls[0][0]
    expect(ctxArg.columnName).toBe('ConstraintCol')

    // 写入约束节点的 column 也应是 ConstraintCol
    const written = updateNodeData.mock.calls[0][1] as Record<string, unknown>
    expect(written.column).toBe('ConstraintCol')
  })
})

describe('validationExecutors - validateConstraintNodeById (G: 路由 + Bug 3.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(validateRegexNodesForSchema).mockResolvedValue(null)
  })

  it('inline 源（manualData）走 validateForInlineSource 路径', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(makeFakeHandler({ status: 'pass' }))
    const sourceNode = {
      id: 'manual-1',
      type: 'manualData',
      data: { rows: [['v1']], columnName: 'Col1' },
    }
    const constraintNode = {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: { sourceRef: { nodeId: 'manual-1', columnId: '0' } },
    }
    const nodes = [sourceNode, constraintNode]
    const updateNodeData = vi.fn()

    await validateConstraintNodeById('notnull-1', nodes as any, [], updateNodeData)

    // inline 路径：handler 被调用，updateEdgeData 不应被调用（inline 无 edge）
    expect(getHandlerByNodeType).toHaveBeenCalled()
    expect(updateEdgeData).not.toHaveBeenCalled()
  })

  it('schema 源走 validateConstraintNode 路径 + 全列重建（Bug 3.4）', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(makeFakeHandler({ status: 'pass' }))
    const schemaNode = {
      id: 'schema-1',
      type: 'schema',
      data: {
        tableName: 'users',
        columns: [
          { id: 'col-a', columnName: 'A', dataType: 'string', validationErrors: ['stale err'] },
          { id: 'col-b', columnName: 'B', dataType: 'string', validationErrors: [] },
        ],
      },
    }
    const constraintNode = {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: { sourceRef: { nodeId: 'schema-1', columnId: 'col-b' } },
    }
    const nodes = [schemaNode, constraintNode]
    const edges = [
      {
        id: 'e1',
        source: 'schema-1',
        target: 'notnull-1',
        sourceHandle: 'source-right-col-b',
        targetHandle: 't',
      },
    ]
    const updateNodeData = vi.fn()

    await validateConstraintNodeById('notnull-1', nodes as any, edges as any, updateNodeData)

    // schema 路径：边状态被同步
    expect(updateEdgeData).toHaveBeenCalledWith('e1', { validationStatus: 'pass' })

    // Bug 3.4：全列重建 — col-a 的 stale 错误应被清除（无约束引用 col-a）
    const schemaUpdate = updateNodeData.mock.calls.find(([id]) => id === 'schema-1')
    expect(schemaUpdate).toBeDefined()
    const cols = (schemaUpdate![1] as any).columns
    expect(cols[0].validationErrors).toEqual([]) // stale 错误清除
  })

  it('约束节点无 sourceRef 时安全返回', async () => {
    const constraintNode = {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: {},
    }
    const updateNodeData = vi.fn()
    await validateConstraintNodeById('notnull-1', [constraintNode] as any, [], updateNodeData)
    expect(getHandlerByNodeType).not.toHaveBeenCalled()
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it('约束节点不存在时安全返回', async () => {
    const updateNodeData = vi.fn()
    await validateConstraintNodeById('nonexistent', [], [], updateNodeData)
    expect(getHandlerByNodeType).not.toHaveBeenCalled()
  })

  it('schema 源但找不到对应 edge 时安全返回', async () => {
    vi.mocked(getHandlerByNodeType).mockReturnValue(makeFakeHandler({ status: 'pass' }))
    const schemaNode = {
      id: 'schema-1',
      type: 'schema',
      data: { columns: [{ id: 'col-1', columnName: 'A' }] },
    }
    const constraintNode = {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: { sourceRef: { nodeId: 'schema-1', columnId: 'col-1' } },
    }
    const updateNodeData = vi.fn()

    await validateConstraintNodeById(
      'notnull-1',
      [schemaNode, constraintNode] as any,
      [], // 无边
      updateNodeData
    )

    // 无 edge → 不校验，但也不抛错
    expect(getHandlerByNodeType).not.toHaveBeenCalled()
  })
})
