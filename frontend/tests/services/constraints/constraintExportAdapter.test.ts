/**
 * @fileoverview constraintExportAdapter 单元测试
 *
 * 测试约束节点数据 → V2 配置格式的转换：
 * - 各约束类型的 refs 和 params 生成
 * - sourceRef 存在时优先使用 vs 回退到 tableName 查找
 * - normalizeSchemaId 映射
 */

import { describe, it, expect } from 'vitest'
import { buildConstraintExportPayload } from '@/services/constraints/constraintExportAdapter'
import type { CustomNode } from '@/types/graph'

function makeNodes(): CustomNode[] {
  return [
    {
      id: 'schema-1',
      type: 'schema',
      data: {
        tableName: 'users',
        columns: [
          { id: 'col-email', columnName: 'email' },
          { id: 'col-age', columnName: 'age' },
          { id: 'col-status', columnName: 'status' },
        ],
        sourceFilePath: '/data/users.csv',
        sheetName: undefined,
      } as any,
      position: { x: 0, y: 0 },
    },
    {
      id: 'schema-2',
      type: 'schema',
      data: {
        tableName: 'roles',
        columns: [
          { id: 'col-role-id', columnName: 'id' },
          { id: 'col-role-name', columnName: 'name' },
        ],
        sourceFilePath: '/data/roles.csv',
        sheetName: undefined,
      } as any,
      position: { x: 0, y: 0 },
    },
  ] as CustomNode[]
}

const schemaIdMap: Record<string, string> = {
  'schema-1': 'sc_users',
  'schema-2': 'sc_roles',
}

describe('constraintExportAdapter - NotNull', () => {
  it('使用 sourceRef 构建 refs', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'NotNull',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.table_id).toBe('sc_users')
    expect(result.refs.column_id).toBe('col-email')
    expect(result.params).toEqual({})
  })
})

describe('constraintExportAdapter - Unique', () => {
  it('使用 sourceRef 构建 refs，column_ids 为数组', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Unique',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.table_id).toBe('sc_users')
    expect(result.refs.column_ids).toEqual(['col-email'])
  })
})

describe('constraintExportAdapter - AllowedValues', () => {
  it('生成 refs 和 allowed_values params', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'AllowedValues',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-status' },
        allowedValues: ['active', 'inactive'],
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.table_id).toBe('sc_users')
    expect(result.refs.column_id).toBe('col-status')
    expect(result.params.allowed_values).toEqual(['active', 'inactive'])
  })

  it('allowedValues 为非字符串时转为字符串', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'AllowedValues',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-age' },
        allowedValues: [1, 2, 3],
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.allowed_values).toEqual(['1', '2', '3'])
  })
})

describe('constraintExportAdapter - Range', () => {
  it('生成 refs 和 min/max params', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Range',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-age' },
        minValue: 0,
        maxValue: 150,
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.table_id).toBe('sc_users')
    expect(result.params.min).toBe(0)
    expect(result.params.max).toBe(150)
  })

  it('min/max 缺失时不包含在 params 中', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Range',
      data: { sourceRef: { nodeId: 'schema-1', columnId: 'col-age' } },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.min).toBeUndefined()
    expect(result.params.max).toBeUndefined()
  })
})

describe('constraintExportAdapter - ForeignKey', () => {
  it('生成双引用 refs', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'ForeignKey',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
        targetRef: { nodeId: 'schema-2', columnId: 'col-role-name' },
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.from_table_id).toBe('sc_users')
    expect(result.refs.from_column_id).toBe('col-email')
    expect(result.refs.to_table_id).toBe('sc_roles')
    expect(result.refs.to_column_id).toBe('col-role-name')
  })

  it('缺少 sourceRef 时 refs 为空', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'ForeignKey',
      data: {},
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs).toEqual({})
  })
})

describe('constraintExportAdapter - Scripted', () => {
  it('生成 expression 和 name', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Scripted',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
        script: 'value > 0',
        constraintName: 'positive-check',
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.table_id).toBe('sc_users')
    expect(result.refs.column_id).toBe('col-email')
    expect(result.params.expression).toBe('value > 0')
    expect(result.params.name).toBe('positive-check')
  })

  it('name 回退到 configName 再到 constraintNodeId', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Scripted',
      data: { configName: 'my-script' },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.name).toBe('my-script')
  })
})

describe('constraintExportAdapter - Charset', () => {
  it('生成 charset_mode params', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Charset',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
        charsetMode: 'alphanumeric',
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.charset_mode).toBe('alphanumeric')
  })
})

describe('constraintExportAdapter - DateLogic', () => {
  it('生成所有日期逻辑参数', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'DateLogic',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-age' },
        logicMode: 'compare',
        compareOp: 'gt',
        referenceDate: '2025-01-01',
        referenceColumn: 'dob',
        calculationType: 'age',
        targetValue: '18',
        targetColumn: 'dob',
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.logic_mode).toBe('compare')
    expect(result.params.compare_op).toBe('gt')
    expect(result.params.reference_date).toBe('2025-01-01')
    expect(result.params.reference_column).toBe('dob')
    expect(result.params.calculation_type).toBe('age')
    expect(result.params.target_value).toBe('18')
    expect(result.params.target_column).toBe('dob')
  })
})

describe('constraintExportAdapter - Composite', () => {
  it('生成 logic 和 sub_constraints from includedNodeIds', () => {
    const nodes = [
      ...makeNodes(),
      {
        id: 'sub-1',
        type: 'notNullConstraint',
        data: {
          table: 'users',
          column: 'email',
          sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
          configName: 'email not null',
        },
        position: { x: 0, y: 0 },
      } as any,
    ]
    const result = buildConstraintExportPayload({
      nodes,
      constraintNodeId: 'comp-1',
      v2Type: 'Composite',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
        logic: 'and',
        includedNodeIds: ['sub-1'],
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.logic).toBe('and')
    expect(result.params.sub_constraints).toHaveLength(1)
    expect(result.params.sub_constraints[0].id).toBe('sub-1')
    expect(result.params.sub_constraints[0].type).toBe('NotNull')
  })

  it('无 includedNodeIds 时从 subGraph.nodes 导出', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'comp-1',
      v2Type: 'Composite',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
        logic: 'or',
        subGraph: {
          nodes: [
            {
              id: 'sub-1',
              type: 'uniqueConstraint',
              data: {
                table: 'users',
                column: 'email',
                sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
                configName: 'email unique',
              },
            },
          ],
        },
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.logic).toBe('or')
    expect(result.params.sub_constraints).toHaveLength(1)
    expect(result.params.sub_constraints[0].type).toBe('Unique')
  })

  it('默认 logic 为 all', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'comp-1',
      v2Type: 'Composite',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-email' },
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.params.logic).toBe('all')
  })
})

describe('constraintExportAdapter - Conditional', () => {
  it('生成 then_column_id 和 if_conditions', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'Conditional',
      data: {
        thenRef: { nodeId: 'schema-1', columnId: 'col-age' },
        ifRef: { nodeId: 'schema-1', columnId: 'col-status' },
        ifLogic: 'and',
        ifConditions: [
          { operator: 'eq', value: 'active', ref: { nodeId: 'schema-1', columnId: 'col-status' } },
        ],
        thenConditionConfig: { type: 'range', min: 18 },
      },
      schemaIdByNodeId: schemaIdMap,
    })
    expect(result.refs.table_id).toBe('sc_users')
    expect(result.refs.then_column_id).toBe('col-age')
    expect(result.refs.if_logic).toBe('and')
    expect(result.refs.if_conditions).toHaveLength(1)
    expect(result.refs.if_conditions[0].operator).toBe('eq')
    expect(result.params.then_condition).toEqual({ type: 'range', min: 18 })
  })
})

describe('constraintExportAdapter - normalizeSchemaId', () => {
  it('schemaIdByNodeId 中的映射生效', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'NotNull',
      data: { sourceRef: { nodeId: 'schema-1', columnId: 'col-email' } },
      schemaIdByNodeId: { 'schema-1': 'mapped-id-123' },
    })
    expect(result.refs.table_id).toBe('mapped-id-123')
  })

  it('schemaIdByNodeId 中无映射时使用原始值', () => {
    const result = buildConstraintExportPayload({
      nodes: makeNodes(),
      constraintNodeId: 'c-1',
      v2Type: 'NotNull',
      data: { sourceRef: { nodeId: 'schema-1', columnId: 'col-email' } },
      schemaIdByNodeId: {},
    })
    expect(result.refs.table_id).toBe('schema-1')
  })
})
