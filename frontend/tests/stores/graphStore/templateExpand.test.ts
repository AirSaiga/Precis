import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref, nextTick } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
  addEdges: vi.fn(),
  removeNodes: vi.fn(),
  removeEdges: vi.fn(),
}))

vi.mock('@/services/constraints/validationRegistry', () => ({
  getConstraintMetaByKind: vi.fn((kind: string) => {
    const map: Record<string, { nodeType: string }> = {
      notNull: { nodeType: 'notNullConstraint' },
      unique: { nodeType: 'uniqueConstraint' },
      foreignKey: { nodeType: 'foreignKeyConstraint' },
      allowedValues: { nodeType: 'allowedValuesConstraint' },
      conditional: { nodeType: 'conditionalConstraint' },
      scripted: { nodeType: 'scriptedConstraint' },
      range: { nodeType: 'rangeConstraint' },
      charset: { nodeType: 'charsetConstraint' },
      dateLogic: { nodeType: 'dateLogicConstraint' },
      composite: { nodeType: 'compositeConstraint' },
    }
    return map[kind] || null
  }),
  getConstraintKindByV2Type: vi.fn((v2Type: string) => {
    const map: Record<string, string> = {
      NotNull: 'notNull',
      Unique: 'unique',
      AllowedValues: 'allowedValues',
      ForeignKey: 'foreignKey',
      Range: 'range',
      Conditional: 'conditional',
      Scripted: 'scripted',
      Charset: 'charset',
      DateLogic: 'dateLogic',
      Composite: 'composite',
    }
    return map[v2Type] || undefined
  }),
}))

import { createTemplateExpandModule } from '@/stores/graphStore/modules/templateExpand'
import type { TemplateExpandResult } from '@/api/projectV2Api'
import { addNodes, addEdges, removeNodes, removeEdges } from '@/services/canvas/vueFlowApi'

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  overrides: Partial<CustomNode> = {}
): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { ...data } as CustomNodeData,
    ...overrides,
  } as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

function makeExpandResult(overrides: Partial<TemplateExpandResult> = {}): TemplateExpandResult {
  return {
    transforms: [],
    constraints: [],
    regex_nodes: [],
    manual_data: [],
    ...overrides,
  } as TemplateExpandResult
}

describe('templateExpand module', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let updateNodeDataCalls: Array<{ nodeId: string; data: Partial<CustomNodeData> }>
  let module: ReturnType<typeof createTemplateExpandModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    updateNodeDataCalls = []
    module = createTemplateExpandModule({
      nodes,
      edges,
      updateNodeData: (nodeId, data) => {
        updateNodeDataCalls.push({ nodeId, data })
        const idx = nodes.value.findIndex((n) => n.id === nodeId)
        if (idx >= 0) {
          nodes.value[idx] = {
            ...nodes.value[idx],
            data: { ...nodes.value[idx].data, ...data } as CustomNodeData,
          } as CustomNode
        }
      },
    })
    vi.mocked(addNodes).mockClear()
    vi.mocked(addEdges).mockClear()
    vi.mocked(removeNodes).mockClear()
    vi.mocked(removeEdges).mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.mocked(addNodes).mockClear()
    vi.mocked(addEdges).mockClear()
    vi.mocked(removeNodes).mockClear()
    vi.mocked(removeEdges).mockClear()
  })

  // --------------------------------------------------------------------------
  // clearExpansion
  // --------------------------------------------------------------------------
  describe('clearExpansion', () => {
    it('无展开节点时不操作', () => {
      module.clearExpansion('ti-1')
      expect(removeNodes).not.toHaveBeenCalled()
      expect(removeEdges).not.toHaveBeenCalled()
    })

    it('清除展开节点并删除关联边', async () => {
      nodes.value = [
        makeNode('ti-1', 'templateInstance', { expanded: true }),
        makeNode('child-1', 'notNullConstraint', {}, { parentNode: 'ti-1' }),
        makeNode('child-2', 'transform', {}, { parentNode: 'ti-1' }),
      ]
      edges.value = [makeEdge('e1', 'child-1', 'child-2'), makeEdge('e2', 'external', 'ti-1')]

      // 先展开一次建立追踪
      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'child-1',
              type: 'NotNull',
              input_from_node: null,
              description: 'nn',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      // 重置 mock 计数
      vi.mocked(addNodes).mockClear()
      vi.mocked(addEdges).mockClear()
      vi.mocked(removeNodes).mockClear()
      vi.mocked(removeEdges).mockClear()

      module.clearExpansion('ti-1')

      expect(removeEdges).toHaveBeenCalled()
      expect(removeNodes).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // collapseExpansion / reExpand
  // --------------------------------------------------------------------------
  describe('collapseExpansion & reExpand', () => {
    it('折叠隐藏子节点', async () => {
      nodes.value = [
        makeNode('ti-1', 'templateInstance', { expanded: true }),
        makeNode('child-1', 'notNullConstraint', {}, { parentNode: 'ti-1' }),
      ]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'child-1',
              type: 'NotNull',
              input_from_node: null,
              description: 'nn',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      module.collapseExpansion('ti-1')

      const child = nodes.value.find((n) => n.id === 'child-1')
      expect(child?.hidden).toBe(true)

      const parent = nodes.value.find((n) => n.id === 'ti-1')
      expect((parent?.data as any)?.expanded).toBe(false)
    })

    it('再次展开显示子节点', async () => {
      nodes.value = [
        makeNode('ti-1', 'templateInstance', { expanded: false }),
        makeNode('child-1', 'notNullConstraint', { hidden: true }, { parentNode: 'ti-1' }),
      ]

      // 手动注入展开追踪
      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'child-1',
              type: 'NotNull',
              input_from_node: null,
              description: 'nn',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      module.collapseExpansion('ti-1')

      // reExpand 需要子节点已经存在
      const result = module.reExpand('ti-1')
      expect(result).toBe(true)

      const child = nodes.value.find((n) => n.id === 'child-1')
      expect(child?.hidden).toBe(false)
    })

    it('reExpand 无展开记录返回 false', () => {
      const result = module.reExpand('ti-1')
      expect(result).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // resetAll / getExpandedIds
  // --------------------------------------------------------------------------
  describe('resetAll & getExpandedIds', () => {
    it('resetAll 清空所有追踪', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]
      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: null,
              description: 'nn',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      expect(module.getExpandedIds('ti-1').length).toBeGreaterThan(0)

      module.resetAll()
      expect(module.getExpandedIds('ti-1')).toHaveLength(0)
    })

    it('getExpandedIds 返回空数组', () => {
      expect(module.getExpandedIds('unknown')).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // expandOnCanvas - 5 stage pipeline
  // --------------------------------------------------------------------------
  describe('expandOnCanvas - 5 stage pipeline', () => {
    it('空结果不创建节点', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', { inputFromNode: 'schema-1' })]
      await module.expandOnCanvas('ti-1', makeExpandResult())
      expect(addNodes).not.toHaveBeenCalled()
    })

    it('实例节点不存在时不操作', async () => {
      await module.expandOnCanvas(
        'nonexistent',
        makeExpandResult({
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: null,
              description: 'nn',
              refs: {},
              params: {},
            },
          ],
        })
      )
      expect(addNodes).not.toHaveBeenCalled()
    })

    it('创建 constraint 节点', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', { inputFromNode: 'schema-1' })]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: null,
              description: 'NN Email',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = addNodes.mock.calls[0][0] as CustomNode
      expect(node.type).toBe('notNullConstraint')
      expect(node.parentNode).toBe('ti-1')
      expect((node.data as any).configName).toBe('NN Email')
      expect((node.data as any).table).toBe('t1')
      expect((node.data as any).column).toBe('c1')
      expect((node.data as any).inputColumn).toBe('c1')
      expect((node.data as any).sourceRef).toEqual({ nodeId: 't1', columnId: 'c1' })
    })

    it('创建 transform 节点', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', { inputFromNode: 'schema-1' })]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          transforms: [
            {
              id: 't1',
              type: 'UpperCase',
              input_from_node: null,
              description: 'Upper',
              input_column: 'name',
              params: {},
              output_columns: ['upper_name'],
            },
          ],
        })
      )

      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = addNodes.mock.calls[0][0] as CustomNode
      expect(node.type).toBe('transform')
      expect((node.data as any).transformType).toBe('UpperCase')
      expect((node.data as any).inputColumn).toBe('name')
    })

    it('创建 regex 节点', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', { inputFromNode: 'schema-1' })]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          regex_nodes: [
            {
              id: 'r1',
              type: 'regex',
              input_from_node: null,
              name: 'Email Regex',
              pattern: '^.*$',
              description: 'email pattern',
              match_mode: 'full',
              case_sensitive: true,
              parameters: [],
            },
          ],
        })
      )

      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = addNodes.mock.calls[0][0] as CustomNode
      expect(node.type).toBe('regex')
      expect((node.data as any).pattern).toBe('^.*$')
    })

    it('transform → constraint 插入 transformOutput 合成节点', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', { inputFromNode: 'schema-1' })]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          transforms: [
            {
              id: 't1',
              type: 'UpperCase',
              input_from_node: null,
              description: 'Upper',
              output_columns: ['upper_name'],
            },
          ],
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: 't1',
              description: 'NN',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      // transform + transformOutput + constraint = 3 nodes
      expect(addNodes).toHaveBeenCalledTimes(3)

      const types = addNodes.mock.calls.map((c) => (c[0] as CustomNode).type)
      expect(types).toContain('transformOutput')
      expect(types).toContain('notNullConstraint')

      expect(addEdges).toHaveBeenCalled()
      const edgeIds = addEdges.mock.calls[0][0] as Edge[]
      expect(edgeIds.length).toBeGreaterThan(0)
    })

    it('展开结果中的 manualData 节点被正确创建', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          manual_data: [
            {
              id: 'md1',
              column_name: 'age',
              column_data_type: 'integer',
              rows: [['18'], ['25'], ['65']],
            },
          ],
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: 'md1',
              description: 'NN',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      const createdNodes = addNodes.mock.calls.map((c) => c[0] as CustomNode)
      const mdNode = createdNodes.find((n) => n.type === 'manualData')
      expect(mdNode).toBeDefined()
      expect(mdNode!.id).toBe('md1')
      expect((mdNode!.data as Record<string, unknown>).columnName).toBe('age')
      expect((mdNode!.data as Record<string, unknown>).columnDataType).toBe('integer')
      expect((mdNode!.data as Record<string, unknown>).rows).toEqual([['18'], ['25'], ['65']])
    })

    it('更新实例节点 expanded 和 nodeCount', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: null,
              description: 'NN',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      const expandedCall = updateNodeDataCalls.find(
        (c) => c.nodeId === 'ti-1' && c.data.expanded === true
      )
      expect(expandedCall).toBeDefined()

      const countCall = updateNodeDataCalls.find(
        (c) => c.nodeId === 'ti-1' && typeof c.data.nodeCount === 'number'
      )
      expect(countCall).toBeDefined()
    })

    it('设置容器尺寸', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: null,
              description: 'NN',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      const parent = nodes.value.find((n) => n.id === 'ti-1')
      expect(parent?.width).toBeGreaterThan(0)
      expect(parent?.height).toBeGreaterThan(0)
      expect(parent?.style?.width).toBeTruthy()
      expect(parent?.style?.height).toBeTruthy()
    })

    it('复用已存在的 transformOutput 节点', async () => {
      nodes.value = [
        makeNode('ti-1', 'templateInstance', {}),
        makeNode('output-t1', 'transformOutput', { parentTransformId: 't1' }),
      ]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          transforms: [
            {
              id: 't1',
              type: 'UpperCase',
              input_from_node: null,
              description: 'Upper',
              output_columns: ['upper_name'],
            },
          ],
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: 't1',
              description: 'NN',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      const ids = addNodes.mock.calls.map((c) => (c[0] as CustomNode).id)
      // output-t1 已存在，不应再次创建
      expect(ids.filter((id) => id === 'output-t1')).toHaveLength(0)
    })

    it('10 种约束类型映射正确', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]

      const constraintTypes = [
        { type: 'NotNull', expectedNodeType: 'notNullConstraint' },
        { type: 'Unique', expectedNodeType: 'uniqueConstraint' },
        { type: 'ForeignKey', expectedNodeType: 'foreignKeyConstraint' },
        { type: 'AllowedValues', expectedNodeType: 'allowedValuesConstraint' },
        { type: 'Conditional', expectedNodeType: 'conditionalConstraint' },
        { type: 'Scripted', expectedNodeType: 'scriptedConstraint' },
        { type: 'Range', expectedNodeType: 'rangeConstraint' },
        { type: 'Charset', expectedNodeType: 'charsetConstraint' },
        { type: 'DateLogic', expectedNodeType: 'dateLogicConstraint' },
        { type: 'Composite', expectedNodeType: 'compositeConstraint' },
      ]

      for (const ct of constraintTypes) {
        addNodes.mockClear()
        addEdges.mockClear()

        const refs: Record<string, unknown> = { table_id: 't1' }
        const params: Record<string, unknown> = {}

        if (ct.type === 'NotNull') refs.column_id = 'c1'
        if (ct.type === 'Unique') refs.column_ids = ['c1']
        if (ct.type === 'AllowedValues') {
          refs.column_id = 'c1'
          params.allowed_values = ['a', 'b']
        }
        if (ct.type === 'ForeignKey') {
          refs.from_table_id = 't1'
          refs.from_column_id = 'c1'
          refs.to_table_id = 't2'
          refs.to_column_id = 'c2'
        }
        if (ct.type === 'Range') {
          refs.column_id = 'c1'
          params.min = 0
          params.max = 100
          params.boundary_mode = 'inclusive'
        }
        if (ct.type === 'Conditional') {
          refs.if_column_id = 'c1'
          refs.then_column_id = 'c2'
          params.if_conditions = []
        }
        if (ct.type === 'Scripted') {
          refs.column_id = 'c1'
          params.expression = 'true'
        }
        if (ct.type === 'Charset') {
          refs.column_id = 'c1'
          params.charset_mode = 'ascii'
        }
        if (ct.type === 'DateLogic') {
          refs.column_id = 'c1'
          params.logic_mode = 'compare'
        }
        if (ct.type === 'Composite') {
          /* no refs needed */
        }

        await module.expandOnCanvas(
          'ti-1',
          makeExpandResult({
            constraints: [
              {
                id: `c-${ct.type}`,
                type: ct.type,
                input_from_node: null,
                description: `${ct.type} test`,
                refs,
                params,
              },
            ],
          })
        )

        expect(addNodes).toHaveBeenCalled()
        const node = addNodes.mock.calls[0][0] as CustomNode
        expect(node.type).toBe(ct.expectedNodeType)
      }
    })

    it('未知约束类型跳过', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          constraints: [
            {
              id: 'c1',
              type: 'UnknownType',
              input_from_node: null,
              description: 'Unknown',
              refs: { table_id: 't1' },
              params: {},
            },
          ],
        })
      )

      // UnknownType 映射不到 kind，所以 buildConstraintNodeData 返回 null，不创建节点
      const types = addNodes.mock.calls.map((c) => (c[0] as CustomNode).type)
      expect(types).not.toContain('UnknownType')
    })

    it('内部边创建时不向 constraint 回写 inputFromNode', async () => {
      nodes.value = [makeNode('ti-1', 'templateInstance', {})]

      await module.expandOnCanvas(
        'ti-1',
        makeExpandResult({
          manual_data: [
            {
              id: 'md1',
              column_name: 'age',
              column_data_type: 'integer',
              rows: [['18']],
            },
          ],
          constraints: [
            {
              id: 'c1',
              type: 'NotNull',
              input_from_node: 'md1',
              description: 'NN',
              refs: { table_id: 't1', column_id: 'c1' },
              params: {},
            },
          ],
        })
      )

      expect(addEdges).toHaveBeenCalled()
      const createdEdges = addEdges.mock.calls[0][0] as Edge[]
      expect(createdEdges.length).toBeGreaterThan(0)

      // 自包含 DAG 中，constraint 节点不应被写入 inputFromNode
      const allAddedNodes = addNodes.mock.calls.flatMap((call) => call[0] as CustomNode[])
      const constraint = allAddedNodes.find((n) => n.id === 'c1')
      expect(constraint).toBeDefined()
      expect((constraint!.data as Record<string, unknown>).inputFromNode).toBeUndefined()
    })
  })
})
