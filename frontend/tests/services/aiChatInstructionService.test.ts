/**
 * @file aiChatInstructionService.test.ts
 * @description AI 聊天指令服务单元测试
 *
 * 核心覆盖：
 * - AI 构造的合法边在加入画布前会通过连接验证器校验
 * - 非法边被拒绝，不会调用 vueFlowApi.addEdges
 * - 合法边的方向与 sourceHandle/targetHandle 格式符合 connectionRules
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Edge, Node as VueFlowNode } from '@vue-flow/core'
import type { FrontendInstruction } from '@/stores/aiChatStore'
import { processFrontendInstructions } from '@/services/aiChatInstructionService'

const mocks = vi.hoisted(() => ({
  validateConnection: vi.fn(),
  addEdges: vi.fn(),
  addNodes: vi.fn(),
  removeNodes: vi.fn(),
  fitView: vi.fn(),
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
}))

vi.mock('@/composables/validation/useConnectionValidator', () => ({
  useConnectionValidator: vi.fn(() => ({ validateConnection: mocks.validateConnection })),
}))

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: vi.fn(() => mocks.graphStore),
}))

vi.mock('@vue-flow/core', () => ({
  useVueFlow: vi.fn(() => ({ fitView: mocks.fitView })),
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
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.loggerError.mockReset()
    mocks.loggerWarn.mockReset()
    mocks.loggerInfo.mockReset()
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
})
