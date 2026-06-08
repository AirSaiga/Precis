import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { hydrateManifestConstraintsFromV2Config } from '@/stores/graphStore/modules/v2/persistence/load/hydrateConstraints'

function makeSchemaNode(id: string, tableName: string, columns: Array<{ id: string; columnName: string }> = []): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: { tableName, columns } as CustomNodeData,
  } as CustomNode
}

describe('hydrateManifestConstraintsFromV2Config', () => {
  it('空 constraints 列表返回空结果', () => {
    const config = { manifest: { constraints: [] }, constraints: {} }
    const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes: [] })
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  describe('NotNull', () => {
    it('创建 NotNull 节点和边', () => {
      const config = {
        manifest: { constraints: [{ id: 'c1' }] },
        constraints: {
          c1: {
            type: 'NotNull',
            description: 'email required',
            refs: { table_id: 's1', column_id: 'col1' },
            params: {},
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'email' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('notNullConstraint')
      expect((result.nodes[0].data as any).table).toBe('users')
      expect((result.nodes[0].data as any).column).toBe('email')
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0].source).toBe('s1')
      expect(result.edges[0].target).toBe('c1')
    })
  })

  describe('Unique', () => {
    it('创建 Unique 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c2' }] },
        constraints: {
          c2: {
            type: 'Unique',
            description: 'unique email',
            refs: { table_id: 's1', column_ids: ['col1'] },
            params: {},
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'email' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('uniqueConstraint')
    })
  })

  describe('AllowedValues', () => {
    it('创建 AllowedValues 节点并构造 Set', () => {
      const config = {
        manifest: { constraints: [{ id: 'c3' }] },
        constraints: {
          c3: {
            type: 'AllowedValues',
            description: 'status values',
            refs: { table_id: 's1', column_id: 'col1' },
            params: { allowed_values: ['active', 'inactive'] },
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'status' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('allowedValuesConstraint')
      expect((result.nodes[0].data as any).allowedValues).toBeInstanceOf(Set)
      expect((result.nodes[0].data as any).allowedValues.has('active')).toBe(true)
    })
  })

  describe('ForeignKey', () => {
    it('创建 FK 节点和两条边', () => {
      const config = {
        manifest: { constraints: [{ id: 'c4' }] },
        constraints: {
          c4: {
            type: 'ForeignKey',
            description: 'user FK',
            refs: {
              from_table_id: 's1',
              from_column_id: 'col1',
              to_table_id: 's2',
              to_column_id: 'col2',
            },
            params: {},
          },
        },
      }
      const existingNodes = [
        makeSchemaNode('s1', 'orders', [{ id: 'col1', columnName: 'user_id' }]),
        makeSchemaNode('s2', 'users', [{ id: 'col2', columnName: 'id' }]),
      ]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('foreignKeyConstraint')
      expect((result.nodes[0].data as any).sourceColumn).toBe('user_id')
      expect((result.nodes[0].data as any).targetColumn).toBe('id')
      expect(result.edges.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Conditional', () => {
    it('创建 Conditional 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c5' }] },
        constraints: {
          c5: {
            type: 'Conditional',
            description: 'if active then amount',
            refs: {
              table_id: 's1',
              then_column_id: 'col2',
              if_logic: 'and',
              if_conditions: [{ if_column_id: 'col1', operator: 'eq', value: 'active' }],
            },
            params: {},
          },
        },
      }
      const existingNodes = [
        makeSchemaNode('s1', 'orders', [
          { id: 'col1', columnName: 'status' },
          { id: 'col2', columnName: 'amount' },
        ]),
      ]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('conditionalConstraint')
      expect((result.nodes[0].data as any).ifLogic).toBe('and')
    })
  })

  describe('Range', () => {
    it('创建 Range 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c6' }] },
        constraints: {
          c6: {
            type: 'Range',
            description: 'age range',
            refs: { table_id: 's1', column_id: 'col1' },
            params: { min: 0, max: 150, boundary_mode: 'inclusive' },
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'age' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('rangeConstraint')
      expect((result.nodes[0].data as any).minValue).toBe(0)
      expect((result.nodes[0].data as any).maxValue).toBe(150)
    })
  })

  describe('Charset', () => {
    it('创建 Charset 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c7' }] },
        constraints: {
          c7: {
            type: 'Charset',
            description: 'ascii only',
            refs: { table_id: 's1', column_id: 'col1' },
            params: { charset_mode: 'ascii' },
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'name' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('charsetConstraint')
      expect((result.nodes[0].data as any).charsetMode).toBe('ascii')
    })
  })

  describe('DateLogic', () => {
    it('创建 DateLogic 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c8' }] },
        constraints: {
          c8: {
            type: 'DateLogic',
            description: 'date check',
            refs: { table_id: 's1', column_id: 'col1' },
            params: { logic_mode: 'compare', compare_op: 'gt', reference_date: '2025-01-01' },
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'created_at' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('dateLogicConstraint')
      expect((result.nodes[0].data as any).logicMode).toBe('compare')
    })
  })

  describe('Scripted', () => {
    it('创建 Scripted 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c9' }] },
        constraints: {
          c9: {
            type: 'Scripted',
            description: 'custom script',
            refs: { table_id: 's1', column_id: 'col1' },
            params: { expression: 'x > 0', name: 'positive_check' },
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'amount' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('scriptedConstraint')
      expect((result.nodes[0].data as any).script).toBe('x > 0')
    })
  })

  describe('Composite', () => {
    it('创建 Composite 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'c10' }] },
        constraints: {
          c10: {
            type: 'Composite',
            description: 'composite rule',
            refs: { table_id: 's1' },
            params: { logic: 'all', sub_graph: [] },
          },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('compositeConstraint')
      expect((result.nodes[0].data as any).logic).toBe('all')
    })
  })

  describe('未知约束类型', () => {
    it('降级为通用 constraint 节点', () => {
      const config = {
        manifest: { constraints: [{ id: 'cx' }] },
        constraints: {
          cx: {
            type: 'UnknownType',
            description: 'unknown',
            refs: {},
            params: {},
          },
        },
      }

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes: [] })

      expect(result.nodes).toHaveLength(1)
      expect(result.nodes[0].type).toBe('constraint')
    })
  })

  describe('saveState', () => {
    it('所有节点 saveState 为 saved', () => {
      const config = {
        manifest: { constraints: [{ id: 'c1' }] },
        constraints: {
          c1: { type: 'NotNull', refs: { table_id: 's1', column_id: 'col1' }, params: {} },
        },
      }
      const existingNodes = [makeSchemaNode('s1', 'users', [{ id: 'col1', columnName: 'email' }])]

      const result = hydrateManifestConstraintsFromV2Config({ config, existingNodes })

      expect((result.nodes[0].data as any).saveState).toBe('saved')
    })
  })
})
