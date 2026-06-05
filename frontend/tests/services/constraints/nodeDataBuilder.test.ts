/**
 * @fileoverview NodeDataBuilder 单元测试
 *
 * 测试各约束类型的 nodeDataBuilder，验证：
 * - 基础字段正确生成（configName, table, column, saveState 等）
 * - 类型特有字段正确生成（allowedValues, range min/max 等）
 * - 边描述符正确生成
 * - 不同 mode 下的 saveState 默认值
 * - 无 columnRef 时边描述符为空
 */

import { describe, it, expect } from 'vitest'
import '@/services/constraints/nodeDataBuilder'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder/registry'
import type { BuildInput } from '@/services/constraints/nodeDataBuilder/types'

function makeInput(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    mode: 'import',
    configName: 'test-constraint',
    schemaNodeId: 'schema-1',
    tableName: 'users',
    nodeId: 'node-1',
    nodeType: 'notNullConstraint',
    columnRef: { nodeId: 'schema-1', columnId: 'col-1', columnName: 'email' },
    ...overrides,
  }
}

describe('nodeDataBuilder - simpleConstraint', () => {
  describe('notNull', () => {
    it('生成基础字段', () => {
      const result = buildNodeData('notNull', makeInput())
      expect(result.nodeData.configName).toBe('test-constraint')
      expect(result.nodeData.table).toBe('users')
      expect(result.nodeData.column).toBe('email')
      expect(result.nodeData.validationStatus).toBe('idle')
      expect(result.nodeData.validationErrors).toEqual([])
    })

    it('import mode 默认 saveState=saved', () => {
      const result = buildNodeData('notNull', makeInput({ mode: 'import' }))
      expect(result.nodeData.saveState).toBe('saved')
    })

    it('connect mode 默认 saveState=draft', () => {
      const result = buildNodeData('notNull', makeInput({ mode: 'connect' }))
      expect(result.nodeData.saveState).toBe('draft')
    })

    it('embedded mode 默认 saveState=saved', () => {
      const result = buildNodeData('notNull', makeInput({ mode: 'embedded' }))
      expect(result.nodeData.saveState).toBe('saved')
    })

    it('显式 saveState 覆盖默认值', () => {
      const result = buildNodeData('notNull', makeInput({ mode: 'import', saveState: 'draft' }))
      expect(result.nodeData.saveState).toBe('draft')
    })

    it('有 columnRef 时生成约束边', () => {
      const result = buildNodeData('notNull', makeInput())
      expect(result.edgeDescriptors).toHaveLength(1)
      expect(result.edgeDescriptors[0]).toEqual({
        kind: 'constraint',
        sourceNodeId: 'schema-1',
        targetNodeId: 'node-1',
        columnId: 'col-1',
      })
    })

    it('无 columnRef 时无边', () => {
      const result = buildNodeData('notNull', makeInput({ columnRef: undefined }))
      expect(result.edgeDescriptors).toHaveLength(0)
    })

    it('embedded=true 时标记', () => {
      const result = buildNodeData('notNull', makeInput({ embedded: true }))
      expect(result.nodeData.embedded).toBe(true)
    })
  })

  describe('unique', () => {
    it('生成基础字段', () => {
      const result = buildNodeData('unique', makeInput())
      expect(result.nodeData.configName).toBe('test-constraint')
      expect(result.nodeData.column).toBe('email')
    })
  })

  describe('allowedValues', () => {
    it('透传 allowed_values 参数', () => {
      const result = buildNodeData(
        'allowedValues',
        makeInput({ params: { allowed_values: ['a', 'b', 'c'] } })
      )
      expect(result.nodeData.allowedValues).toEqual(['a', 'b', 'c'])
    })

    it('无参数时默认空数组', () => {
      const result = buildNodeData('allowedValues', makeInput())
      expect(result.nodeData.allowedValues).toEqual([])
    })
  })

  describe('range', () => {
    it('透传 min/max', () => {
      const result = buildNodeData(
        'range',
        makeInput({ params: { min: 0, max: 100 } })
      )
      expect(result.nodeData.minValue).toBe(0)
      expect(result.nodeData.maxValue).toBe(100)
    })

    it('无参数时 min/max 为 undefined', () => {
      const result = buildNodeData('range', makeInput())
      expect(result.nodeData.minValue).toBeUndefined()
      expect(result.nodeData.maxValue).toBeUndefined()
    })
  })

  describe('scripted', () => {
    it('透传 expression 和 name', () => {
      const result = buildNodeData(
        'scripted',
        makeInput({ params: { expression: 'x > 0', name: 'my-script' } })
      )
      expect(result.nodeData.script).toBe('x > 0')
      expect(result.nodeData.constraintName).toBe('my-script')
    })

    it('无参数时 name 回退到 nodeId', () => {
      const result = buildNodeData('scripted', makeInput())
      expect(result.nodeData.script).toBe('')
      expect(result.nodeData.constraintName).toBe('node-1')
    })
  })

  describe('charset', () => {
    it('透传 charset 参数', () => {
      const result = buildNodeData(
        'charset',
        makeInput({
          params: {
            charset_mode: 'custom',
            allowed_chars: 'abc',
            disallowed_chars: 'xyz',
          },
        })
      )
      expect(result.nodeData.charsetMode).toBe('custom')
      expect(result.nodeData.allowedChars).toBe('abc')
      expect(result.nodeData.disallowedChars).toBe('xyz')
    })

    it('无参数时使用默认值', () => {
      const result = buildNodeData('charset', makeInput())
      expect(result.nodeData.charsetMode).toBe('custom')
      expect(result.nodeData.allowedChars).toBe('')
      expect(result.nodeData.disallowedChars).toBe('')
    })
  })

  describe('dateLogic', () => {
    it('透传所有日期逻辑参数', () => {
      const result = buildNodeData(
        'dateLogic',
        makeInput({
          params: {
            logic_mode: 'compare',
            compare_op: 'gt',
            reference_date: '2025-01-01',
            reference_column: 'col2',
            calculation_type: 'age',
            target_type: 'value',
            target_value: '18',
            target_column: 'dob',
          },
        })
      )
      expect(result.nodeData.logicMode).toBe('compare')
      expect(result.nodeData.compareOp).toBe('gt')
      expect(result.nodeData.referenceDate).toBe('2025-01-01')
      expect(result.nodeData.referenceColumn).toBe('col2')
      expect(result.nodeData.calculationType).toBe('age')
      expect(result.nodeData.targetType).toBe('value')
      expect(result.nodeData.targetValue).toBe('18')
      expect(result.nodeData.targetColumn).toBe('dob')
    })

    it('无参数时使用默认值', () => {
      const result = buildNodeData('dateLogic', makeInput())
      expect(result.nodeData.logicMode).toBe('compare')
      expect(result.nodeData.compareOp).toBe('gt')
      expect(result.nodeData.referenceDate).toBe('')
    })
  })

  describe('composite', () => {
    it('生成 logic 和 includedNodeIds', () => {
      const result = buildNodeData(
        'composite',
        makeInput({ params: { logic: 'or' } })
      )
      expect(result.nodeData.logic).toBe('or')
      expect(result.nodeData.includedNodeIds).toEqual([])
      expect(result.nodeData.enabled).toBe(true)
    })

    it('默认 logic 为 and', () => {
      const result = buildNodeData('composite', makeInput())
      expect(result.nodeData.logic).toBe('and')
    })
  })
})

describe('nodeDataBuilder - foreignKey', () => {
  const fkRefs = {
    source: { nodeId: 'schema-1', columnId: 'col-1', columnName: 'user_id' },
    target: { nodeId: 'schema-2', columnId: 'col-2', columnName: 'id' },
  }

  it('生成 sourceRef 和 targetRef', () => {
    const result = buildNodeData('foreignKey', makeInput({ fkRefs }))
    expect(result.nodeData.sourceColumn).toBe('user_id')
    expect(result.nodeData.targetColumn).toBe('id')
    expect(result.nodeData.sourceRef).toEqual({ nodeId: 'schema-1', columnId: 'col-1' })
    expect(result.nodeData.targetRef).toEqual({ nodeId: 'schema-2', columnId: 'col-2' })
  })

  it('生成 config 规则', () => {
    const result = buildNodeData('foreignKey', makeInput({ fkRefs }))
    expect(result.nodeData.config.ruleType).toBe('EXIST_IN')
    expect(result.nodeData.config.targetNodeId).toBe('schema-2')
    expect(result.nodeData.config.targetColumn).toBe('id')
  })

  it('生成两条边：约束输入边 + FK 展示边', () => {
    const result = buildNodeData('foreignKey', makeInput({ fkRefs }))
    expect(result.edgeDescriptors).toHaveLength(2)
    expect(result.edgeDescriptors[0].kind).toBe('constraint')
    expect(result.edgeDescriptors[1].kind).toBe('fkDisplay')
    expect(result.edgeDescriptors[1].extra.label).toContain('→')
  })

  it('无 fkRefs 时降级为空数据', () => {
    const result = buildNodeData('foreignKey', makeInput({ fkRefs: undefined }))
    expect(result.nodeData.configName).toBe('test-constraint')
    expect(result.edgeDescriptors).toHaveLength(0)
  })

  it('FK 展示边包含完整 extra 信息', () => {
    const result = buildNodeData('foreignKey', makeInput({ fkRefs }))
    const fkEdge = result.edgeDescriptors[1]
    expect(fkEdge.extra.fromTableId).toBe('schema-1')
    expect(fkEdge.extra.toTableId).toBe('schema-2')
    expect(fkEdge.extra.constraintId).toBe('node-1')
  })
})

describe('nodeDataBuilder - conditional', () => {
  it('生成基础 IF/THEN 字段', () => {
    const result = buildNodeData(
      'conditional',
      makeInput({
        ifConditions: [
          { operator: 'eq', value: 'active', columnId: 'col-1', columnName: 'status' },
        ],
        ifLogic: 'and',
        thenRef: { nodeId: 'schema-1', columnId: 'col-2', columnName: 'amount' },
      })
    )
    expect(result.nodeData.ifLogic).toBe('and')
    expect(result.nodeData.ifConditions).toHaveLength(1)
    expect(result.nodeData.thenColumn).toBe('amount')
  })

  it('生成 THEN 边 + IF 边', () => {
    const result = buildNodeData(
      'conditional',
      makeInput({
        ifConditions: [
          { operator: 'eq', value: 'active', columnId: 'col-1', columnName: 'status' },
        ],
        thenRef: { nodeId: 'schema-1', columnId: 'col-2', columnName: 'amount' },
      })
    )
    const thenEdges = result.edgeDescriptors.filter((e) => e.kind === 'constraint')
    const ifEdges = result.edgeDescriptors.filter((e) => e.kind === 'if')
    expect(thenEdges).toHaveLength(1)
    expect(ifEdges).toHaveLength(1)
    expect(thenEdges[0].columnId).toBe('col-2')
    expect(ifEdges[0].columnId).toBe('col-1')
  })

  it('多个 IF 条件生成多条 IF 边', () => {
    const result = buildNodeData(
      'conditional',
      makeInput({
        ifConditions: [
          { operator: 'eq', value: 'a', columnId: 'c1', columnName: 'x' },
          { operator: 'gt', value: 10, columnId: 'c2', columnName: 'y' },
        ],
        thenRef: { nodeId: 'schema-1', columnId: 'c3', columnName: 'z' },
      })
    )
    const ifEdges = result.edgeDescriptors.filter((e) => e.kind === 'if')
    expect(ifEdges).toHaveLength(2)
  })

  it('IF 条件无 columnId 时不生成 IF 边', () => {
    const result = buildNodeData(
      'conditional',
      makeInput({
        ifConditions: [
          { operator: 'eq', value: 'x', columnId: '', columnName: '' },
        ],
        thenRef: { nodeId: 'schema-1', columnId: 'c1', columnName: 'col' },
      })
    )
    const ifEdges = result.edgeDescriptors.filter((e) => e.kind === 'if')
    expect(ifEdges).toHaveLength(0)
  })

  it('默认 ifLogic 为 and', () => {
    const result = buildNodeData('conditional', makeInput())
    expect(result.nodeData.ifLogic).toBe('and')
  })
})

describe('nodeDataBuilder - regex', () => {
  it('生成正则基础字段', () => {
    const result = buildNodeData(
      'regex' as any,
      makeInput({
        params: {
          pattern: '^[a-z]+$',
          description: 'lowercase only',
          match_mode: 'partial',
          case_sensitive: true,
          flags: 'gm',
        },
      })
    )
    expect(result.nodeData.pattern).toBe('^[a-z]+$')
    expect(result.nodeData.description).toBe('lowercase only')
    expect(result.nodeData.matchMode).toBe('partial')
    expect(result.nodeData.caseSensitive).toBe(true)
    expect(result.nodeData.flags).toBe('gm')
  })

  it('无参数时使用默认值', () => {
    const result = buildNodeData('regex' as any, makeInput())
    expect(result.nodeData.pattern).toBe('')
    expect(result.nodeData.matchMode).toBe('full')
    expect(result.nodeData.caseSensitive).toBe(false)
    expect(result.nodeData.enabled).toBe(true)
  })
})

describe('nodeDataBuilder - registry fallback', () => {
  it('未注册的 kind 走降级逻辑', () => {
    const result = buildNodeData('unknownKind' as any, makeInput())
    expect(result.nodeData.configName).toBe('test-constraint')
    expect(result.nodeData.validationStatus).toBe('idle')
    expect(result.edgeDescriptors).toHaveLength(1)
  })
})
