/**
 * @file aiChatInstructionService.test.ts
 * @description AI 聊天指令服务单元测试
 *
 * 核心覆盖：
 * - AI 构造的合法边在加入画布前会通过连接验证器校验
 * - 非法边被拒绝，不会调用 vueFlowApi.addEdges
 * - 合法边的方向与 sourceHandle/targetHandle 格式符合 connectionRules
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Edge, Node as VueFlowNode } from '@vue-flow/core'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import { processFrontendInstructions, debouncedFitView } from '@/services/aiChatInstructionService'

const mocks = vi.hoisted(() => ({
  validateConnection: vi.fn(),
  addEdges: vi.fn(),
  addNodes: vi.fn(),
  removeNodes: vi.fn(),
  fitView: vi.fn(),
  findNode: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  graphStore: {
    nodes: [] as VueFlowNode[],
    edges: [] as Edge[],
    reconcileAll: vi.fn(),
    updateNodeData: vi.fn(),
  },
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid') }))

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: mocks.addEdges,
  addNodes: mocks.addNodes,
  removeNodes: mocks.removeNodes,
  fitView: mocks.fitView,
  findNode: mocks.findNode,
}))

vi.mock('@/composables/validation/useConnectionValidator', () => ({
  useConnectionValidator: vi.fn(() => ({ validateConnection: mocks.validateConnection })),
}))

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: vi.fn(() => mocks.graphStore),
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: vi.fn((key: string) => key) } },
}))

vi.mock('@/core/toast', () => ({
  toastError: mocks.toastError,
  toastSuccess: mocks.toastSuccess,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
    info: mocks.loggerInfo,
    debug: vi.fn(),
  },
}))

vi.mock('@/services/builders/schemaBuilder', () => ({
  fromBackendType: vi.fn((type: string) => type),
}))

function makeSchemaNode(
  id: string,
  columns: Array<{ id: string; columnName: string }> = []
): VueFlowNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'Schema_Users',
      tableName: 'Users',
      columns,
      saveState: 'saved',
    },
  } as VueFlowNode
}

function makeConstraintInstruction(
  constraintSpecOverrides: Record<string, unknown> = {}
): FrontendInstruction {
  return {
    actionType: 'ADD_CONSTRAINT_NODE',
    constraintSpec: {
      type: 'NOT_NULL',
      targetNodeId: 'schema-1',
      tableName: 'Users',
      targetColumn: 'name',
      constraintId: 'nn1',
      isInline: false,
      ...constraintSpecOverrides,
    },
  } as unknown as FrontendInstruction
}

describe('aiChatInstructionService', () => {
  beforeEach(() => {
    mocks.graphStore.nodes = []
    mocks.graphStore.edges = []
    mocks.graphStore.reconcileAll.mockReset()
    mocks.graphStore.updateNodeData.mockReset()
    mocks.validateConnection.mockReset().mockReturnValue({ isValid: true })
    mocks.addEdges.mockReset()
    mocks.addNodes.mockReset()
    mocks.removeNodes.mockReset()
    mocks.fitView.mockReset()
    mocks.findNode.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.loggerError.mockReset()
    mocks.loggerWarn.mockReset()
    mocks.loggerInfo.mockReset()
  })

  describe('debouncedFitView', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('防抖窗口内多次调用只 fitView 一次', () => {
      debouncedFitView(['a'])
      debouncedFitView(['b'])
      debouncedFitView(['c'])

      expect(mocks.fitView).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(mocks.fitView).toHaveBeenCalledTimes(1)
    })

    it('多次调用的 nodes 取并集,而非覆盖(schema + 子约束不应只框 schema)', () => {
      // 模拟 schema+约束场景:scheduleEnteringClass(c1)→[c1], 后续 debouncedFitView([schema, c1, c2])
      debouncedFitView(['c1'])
      debouncedFitView(['schema', 'c1', 'c2'])

      vi.advanceTimersByTime(500)
      expect(mocks.fitView).toHaveBeenCalledTimes(1)
      // 并集应包含全部三个节点,而非最后一次覆盖
      const calledNodes = mocks.fitView.mock.calls[0][0].nodes as string[]
      expect(calledNodes.sort()).toEqual(['c1', 'c2', 'schema'])
    })

    it('防抖窗口结束后再次调用会触发新的 fitView', () => {
      debouncedFitView(['a'])
      vi.advanceTimersByTime(500)
      expect(mocks.fitView).toHaveBeenCalledTimes(1)

      // 窗口结束后的新批次
      debouncedFitView(['b'])
      vi.advanceTimersByTime(500)
      expect(mocks.fitView).toHaveBeenCalledTimes(2)
    })
  })

  describe('ADD_CONSTRAINT_NODE', () => {
    it('创建合法约束节点并从 Schema 列连向约束节点', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('schema-1', [{ id: 'col-1', columnName: 'name' }])]

      await processFrontendInstructions([makeConstraintInstruction()])

      expect(mocks.addNodes).toHaveBeenCalledTimes(1)
      expect(mocks.addNodes).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-uuid',
          type: 'notNullConstraint',
        })
      )

      expect(mocks.validateConnection).toHaveBeenCalledTimes(1)
      expect(mocks.validateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'schema-1', type: 'schema' }),
        'source-right-col-1',
        expect.objectContaining({ id: 'test-uuid', type: 'notNullConstraint' }),
        'target-input-test-uuid'
      )

      expect(mocks.addEdges).toHaveBeenCalledTimes(1)
      expect(mocks.addEdges).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'schema-1',
          target: 'test-uuid',
          sourceHandle: 'source-right-col-1',
          targetHandle: 'target-input-test-uuid',
        })
      )

      expect(mocks.graphStore.reconcileAll).toHaveBeenCalled()
    })

    it('当 AI 只提供列名时能解析为列 ID', async () => {
      mocks.graphStore.nodes = [
        makeSchemaNode('schema-1', [{ id: 'col-abc', columnName: 'email' }]),
      ]

      await processFrontendInstructions([makeConstraintInstruction({ targetColumn: 'email' })])

      expect(mocks.validateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'schema-1' }),
        'source-right-col-abc',
        expect.anything(),
        expect.anything()
      )
      expect(mocks.addEdges).toHaveBeenCalledWith(
        expect.objectContaining({ sourceHandle: 'source-right-col-abc' })
      )
    })

    it('连接验证失败时不添加非法边，并记录错误', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('schema-1', [{ id: 'col-1', columnName: 'name' }])]
      mocks.validateConnection.mockReturnValue({
        isValid: false,
        errorCode: 'NO_MATCHING_RULE',
        message: 'No matching rule',
      })

      await processFrontendInstructions([makeConstraintInstruction()])

      expect(mocks.addEdges).not.toHaveBeenCalled()
      expect(mocks.loggerError).toHaveBeenCalledWith(expect.stringContaining('连接验证失败'))
      expect(mocks.toastError).toHaveBeenCalled()
    })

    it('目标列不存在时不创建连接', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('schema-1', [])]

      await processFrontendInstructions([makeConstraintInstruction()])

      expect(mocks.validateConnection).not.toHaveBeenCalled()
      expect(mocks.addEdges).not.toHaveBeenCalled()
      expect(mocks.toastError).toHaveBeenCalled()
    })
  })

  describe('ADD_REGEX', () => {
    it('创建 Regex 节点并从 Schema 列连向 Regex', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('schema-1', [{ id: 'col-1', columnName: 'name' }])]

      const instruction = {
        actionType: 'ADD_REGEX',
        constraintSpec: {
          type: 'NOT_NULL',
          targetNodeId: 'schema-1',
          tableName: 'Users',
          targetColumn: 'name',
          constraintId: 'dummy',
          isInline: false,
        },
        regexSpec: {
          name: 'emailRegex',
          pattern: '^.*$',
          targetNodeId: 'schema-1',
          targetColumn: 'name',
        },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.addNodes).toHaveBeenCalledWith(expect.objectContaining({ type: 'regex' }))

      expect(mocks.validateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'schema-1', type: 'schema' }),
        'source-right-col-1',
        expect.objectContaining({ type: 'regex' }),
        'regex-input'
      )

      expect(mocks.addEdges).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'schema-1',
          target: 'emailRegex',
          sourceHandle: 'source-right-col-1',
          targetHandle: 'regex-input',
        })
      )
    })

    it('Regex 连接验证失败时不添加边', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('schema-1', [{ id: 'col-1', columnName: 'name' }])]
      mocks.validateConnection.mockReturnValue({
        isValid: false,
        errorCode: 'TARGET_HANDLE_NOT_ALLOWED',
        message: 'Target handle not allowed',
      })

      const instruction = {
        actionType: 'ADD_REGEX',
        constraintSpec: {
          type: 'NOT_NULL',
          targetNodeId: 'schema-1',
          tableName: 'Users',
          targetColumn: 'name',
          constraintId: 'dummy',
          isInline: false,
        },
        regexSpec: {
          name: 'emailRegex',
          targetNodeId: 'schema-1',
          targetColumn: 'name',
        },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.addEdges).not.toHaveBeenCalled()
      expect(mocks.loggerError).toHaveBeenCalled()
      expect(mocks.toastError).toHaveBeenCalled()
    })
  })

  // ============================================================
  // DELETE 画布镜像（P1：约束文件已由后端删除，前端须同步删节点）
  // ============================================================
  describe('DELETE_CONSTRAINT_NODE', () => {
    it('独立约束：按 (类型, table, column) 定位并删除节点', async () => {
      // 画布上已有一个 notNullConstraint 节点
      mocks.graphStore.nodes = [
        makeSchemaNode('schema-1', [{ id: 'col_email', columnName: 'email' }]),
        {
          id: 'constraint-node-1',
          type: 'notNullConstraint',
          position: { x: 100, y: 0 },
          data: { configName: 'nn1', table: 'Users', column: 'email' },
        } as VueFlowNode,
      ]

      const instruction = makeConstraintInstruction({
        type: 'NOT_NULL',
        tableName: 'Users',
        targetColumn: 'email',
        isInline: false,
      })
      instruction.actionType = 'DELETE_CONSTRAINT_NODE'

      await processFrontendInstructions([instruction])

      expect(mocks.removeNodes).toHaveBeenCalledWith(['constraint-node-1'])
      expect(mocks.graphStore.reconcileAll).toHaveBeenCalled()
    })

    it('内联约束：从列移除约束', async () => {
      mocks.graphStore.nodes = [
        makeSchemaNode('schema-1', [{ id: 'col_email', columnName: 'email' } as never]),
      ]
      // 先用内联结构模拟列上有约束
      ;(mocks.graphStore.nodes[0].data as { columns: Array<Record<string, unknown>> }).columns[0] =
        {
          id: 'col_email',
          columnName: 'email',
          // CONSTRAINT_TYPE_MAP 把 'NOT_NULL' 映射为 'notNull'，toLowerCase 后键为 'not_null'
          constraints: { not_null: { id: 'nn1', enabled: true } },
        }

      const instruction = makeConstraintInstruction({
        type: 'NOT_NULL',
        targetNodeId: 'schema-1',
        tableName: 'Users',
        targetColumn: 'email',
        isInline: true,
      })
      instruction.actionType = 'DELETE_CONSTRAINT_NODE'

      await processFrontendInstructions([instruction])

      expect(mocks.graphStore.updateNodeData).toHaveBeenCalledWith(
        'schema-1',
        expect.objectContaining({ columns: expect.any(Array) })
      )
    })
  })

  describe('DELETE_SCHEMA', () => {
    it('精确 id 匹配删除', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('sc_users')]

      const instruction = {
        actionType: 'DELETE_SCHEMA',
        schemaSpec: { name: 'users', schemaId: 'sc_users' },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.removeNodes).toHaveBeenCalledWith('sc_users')
    })

    it('id 不匹配时按 tableName 兜底删除', async () => {
      // 节点 id 是 sc_xxx，但指令只给 name
      mocks.graphStore.nodes = [makeSchemaNode('sc_users_id')]

      const instruction = {
        actionType: 'DELETE_SCHEMA',
        schemaSpec: { name: 'Users' }, // 无 schemaId，靠 tableName 兜底
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.removeNodes).toHaveBeenCalledWith('sc_users_id')
    })
  })

  describe('DELETE_REGEX / DELETE_TRANSFORM', () => {
    it('DELETE_REGEX 按 configName 兜底删除', async () => {
      mocks.graphStore.nodes = [
        {
          id: 'some-other-id',
          type: 'regex',
          position: { x: 0, y: 0 },
          data: { configName: 'emailRegex' },
        } as VueFlowNode,
      ]

      const instruction = {
        actionType: 'DELETE_REGEX',
        regexSpec: { name: 'emailRegex', regexId: 'missing-id' },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.removeNodes).toHaveBeenCalledWith('some-other-id')
    })

    it('DELETE_TRANSFORM 按 id 删除', async () => {
      mocks.graphStore.nodes = [
        {
          id: 'tf-1',
          type: 'transform',
          position: { x: 0, y: 0 },
          data: { configName: 'CastType_tf-1' },
        } as VueFlowNode,
      ]

      const instruction = {
        actionType: 'DELETE_TRANSFORM',
        transformSpec: { transformId: 'tf-1', type: 'CastType' },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.removeNodes).toHaveBeenCalledWith('tf-1')
    })
  })

  // ============================================================
  // UPDATE 画布刷新（P1：后端已改 YAML，前端刷新节点数据）
  // ============================================================
  describe('UPDATE_SCHEMA / UPDATE_REGEX / UPDATE_TRANSFORM', () => {
    it('UPDATE_SCHEMA 刷新列结构', async () => {
      mocks.graphStore.nodes = [makeSchemaNode('sc_users')]

      const instruction = {
        actionType: 'UPDATE_SCHEMA',
        schemaSpec: {
          name: 'Users',
          schemaId: 'sc_users',
          columns: [{ name: 'phone', type: 'string' }],
        },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.graphStore.updateNodeData).toHaveBeenCalledWith(
        'sc_users',
        expect.objectContaining({ columns: expect.any(Array) })
      )
    })

    it('UPDATE_REGEX 刷新 pattern', async () => {
      mocks.graphStore.nodes = [
        {
          id: 'regex-1',
          type: 'regex',
          position: { x: 0, y: 0 },
          data: { configName: 'emailRegex' },
        } as VueFlowNode,
      ]

      const instruction = {
        actionType: 'UPDATE_REGEX',
        regexSpec: {
          name: 'emailRegex',
          regexId: 'regex-1',
          pattern: '^\\d+$',
          matchMode: 'full',
          caseSensitive: true,
        },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.graphStore.updateNodeData).toHaveBeenCalledWith(
        'regex-1',
        expect.objectContaining({ pattern: '^\\d+$' })
      )
    })

    it('UPDATE_TRANSFORM 刷新 params', async () => {
      mocks.graphStore.nodes = [
        {
          id: 'tf-1',
          type: 'transform',
          position: { x: 0, y: 0 },
          data: { configName: 'CastType_tf-1' },
        } as VueFlowNode,
      ]

      const instruction = {
        actionType: 'UPDATE_TRANSFORM',
        transformSpec: { transformId: 'tf-1', type: 'CastType', params: { to: 'integer' } },
      } as unknown as FrontendInstruction

      await processFrontendInstructions([instruction])

      expect(mocks.graphStore.updateNodeData).toHaveBeenCalledWith(
        'tf-1',
        expect.objectContaining({ params: { to: 'integer' } })
      )
    })
  })
})
