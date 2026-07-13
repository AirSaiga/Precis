/**
 * @fileoverview 边样式解析器 + 目标端口校验 单元测试（纯函数）
 *
 * 覆盖从 useConnections 抽出的两个纯函数：
 * - resolveEdgeStyle（C1 边样式 if-else 链）：锁定每种源/目标类型组合的样式 + 隐式优先级
 * - isValidConstraintTargetHandle（B1 端口校验）：锁定各约束类型的端口规则
 *
 * 这些测试是 useConnections 拆分（批次5）的安全网——确保抽出的纯函数行为
 * 与原内联逻辑完全一致。
 */

import { describe, it, expect } from 'vitest'
import { resolveEdgeStyle } from '@/composables/nodes/connectionHandlers/edgeStyleResolver'
import { isValidConstraintTargetHandle } from '@/composables/nodes/connectionHandlers/targetHandleValidator'

// ============================================================================
// resolveEdgeStyle：锁定每种类型组合的样式 + 隐式优先级
// ============================================================================

describe('resolveEdgeStyle - 基础属性', () => {
  it('未匹配任何分支时返回基础 smoothstep 动画边', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'unknownType',
      targetType: 'anotherUnknown',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.type).toBe('smoothstep')
    expect(result.animated).toBe(true)
    expect(result.style).toEqual({ strokeWidth: 1.5 })
  })
})

describe('resolveEdgeStyle - 数据源连接（绿）', () => {
  it('sourcePreview → schema：翡翠绿 + Data Source 标签', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'sourcePreview',
      targetType: 'schema',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-data-source)', strokeWidth: 1.5 })
    expect(result.label).toBe('Data Source')
  })

  it('manualData → schema：绿 + Manual Data 标签', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'manualData',
      targetType: 'schema',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-data-source)', strokeWidth: 1.5 })
    expect(result.label).toBe('Manual Data')
  })

  it('schema → manualData：数据流青 + Column Data 标签', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'manualData',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-data-flow)', strokeWidth: 2 })
    expect(result.label).toBe('Column Data')
  })
})

describe('resolveEdgeStyle - FK 展示边（虚线 + class）', () => {
  it('foreignKeyConstraint → schema(target-left)：虚线 + fk-display-edge class', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 'fk-1',
      sourceType: 'foreignKeyConstraint',
      targetType: 'schema',
      targetNodeId: 'schema-1',
      targetHandle: 'target-left',
    })
    expect(result.animated).toBe(false)
    expect(result.class).toBe('fk-display-edge')
    expect(result.style).toEqual({
      stroke: 'var(--edge-fk-display)',
      strokeWidth: 1.4,
      strokeDasharray: '2 8',
    })
    expect(result.data).toEqual({ kind: 'fkDisplay', fkNodeId: 'fk-1' })
  })

  it('FK→schema 但 handle 非 target-left 时不匹配此分支', () => {
    // targetHandle 为 source-right-xxx（FK→Schema 列场景），不走展示边分支
    const result = resolveEdgeStyle({
      sourceNodeId: 'fk-1',
      sourceType: 'foreignKeyConstraint',
      targetType: 'schema',
      targetNodeId: 'schema-1',
      targetHandle: 'source-right-col-1',
    })
    expect(result.class).toBeUndefined()
    expect(result.data).toBeUndefined()
  })
})

describe('resolveEdgeStyle - 约束连接', () => {
  it('manualData → constraint：默认边', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'manualData',
      targetType: 'notNullConstraint',
      targetNodeId: 't1',
      targetHandle: 'target-left',
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-default)', strokeWidth: 1.5 })
  })

  it('schema → notNullConstraint：默认边', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'notNullConstraint',
      targetNodeId: 't1',
      targetHandle: 'target-left',
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-default)', strokeWidth: 1.5 })
  })

  it('schema → conditionalConstraint(THEN handle)：默认边（分支7为死代码）', () => {
    // 重要：原 C1 if-else 链中，分支6 (schema|jsonSchema|manualData → constraint: 默认边)
    // 排在分支7 (schema|jsonSchema → constraint: conditional IF/THEN 配色) 之前。
    // 分支7 的条件是分支6 的子集，故分支7 永不执行——conditional 的 IF/THEN 配色
    // 实际上从未通过本 resolver 应用（由其他路径处理）。此测试锁定现状。
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'conditionalConstraint',
      targetNodeId: 'cond-1',
      targetHandle: 'target-then-cond-1',
    })
    // 分支6 命中 → 默认边，THEN 配色未应用
    expect(result.style).toEqual({ stroke: 'var(--edge-default)', strokeWidth: 1.5 })
    expect(result.label).toBeUndefined()
  })

  it('schema → conditionalConstraint(IF handle)：默认边（同上，分支7 死代码）', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'conditionalConstraint',
      targetNodeId: 'cond-1',
      targetHandle: 'target-if-cond-1',
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-default)', strokeWidth: 1.5 })
    expect(result.label).toBeUndefined()
  })

  it('manualData → conditionalConstraint：默认边（分支4 命中）', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'manualData',
      targetType: 'conditionalConstraint',
      targetNodeId: 'cond-1',
      targetHandle: 'target-left',
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-default)', strokeWidth: 1.5 })
  })
})

describe('resolveEdgeStyle - 正则连接（紫）', () => {
  it('schema → regex：正则紫', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'regex',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 })
  })

  it('manualData → regexExtract：正则紫', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'manualData',
      targetType: 'regexExtract',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 })
  })

  it('transformOutput → regex：正则紫', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'transformOutput',
      targetType: 'regex',
      targetNodeId: 't1',
      targetHandle: null,
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 })
  })
})

describe('resolveEdgeStyle - 其他', () => {
  it('transformOutput → constraint：默认边', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'transformOutput',
      targetType: 'notNullConstraint',
      targetNodeId: 't1',
      targetHandle: 'target-left',
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-default)', strokeWidth: 1.5 })
  })

  it('→ transform(transform-input)：数据流青', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'transform',
      targetNodeId: 't1',
      targetHandle: 'transform-input',
    })
    expect(result.style).toEqual({ stroke: 'var(--edge-data-flow)', strokeWidth: 2 })
  })

  it('→ transform 非 transform-input handle：保持基础样式', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'schema',
      targetType: 'transform',
      targetNodeId: 't1',
      targetHandle: 'target-left',
    })
    expect(result.style).toEqual({ strokeWidth: 1.5 })
  })
})

describe('resolveEdgeStyle - 隐式优先级（if-else 顺序）', () => {
  // 锁定关键优先级：更具体的分支必须排在更宽泛的分支前
  it('manualData→schema 命中分支2，不落入更靠后的 manualData→constraint 分支', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'manualData',
      targetType: 'schema',
      targetNodeId: 't1',
      targetHandle: null,
    })
    // 若优先级错乱会得到默认边，而非绿+Manual Data 标签
    expect(result.label).toBe('Manual Data')
  })

  it('manualData→constraint 命中分支4（默认边），label 无值', () => {
    const result = resolveEdgeStyle({
      sourceNodeId: 's1',
      sourceType: 'manualData',
      targetType: 'notNullConstraint',
      targetNodeId: 't1',
      targetHandle: 'target-left',
    })
    expect(result.label).toBeUndefined()
  })
})

// ============================================================================
// isValidConstraintTargetHandle：锁定各约束类型的端口规则
// ============================================================================

describe('isValidConstraintTargetHandle - 非约束类型', () => {
  it('目标是非约束类型（如 schema）直接放行', () => {
    expect(isValidConstraintTargetHandle('t1', 'schema', 'target-left')).toBe(true)
  })

  it('目标类型 undefined 放行', () => {
    expect(isValidConstraintTargetHandle('t1', undefined, null)).toBe(true)
  })
})

describe('isValidConstraintTargetHandle - 需要 input handle 的约束', () => {
  // requireInputHandle: true 的类型：foreignKeyConstraint / allowedValuesConstraint /
  // rangeConstraint / scriptedConstraint / charsetConstraint / dateLogicConstraint
  it('foreignKeyConstraint + target-input handle：合法', () => {
    expect(isValidConstraintTargetHandle('fk-1', 'foreignKeyConstraint', 'target-input-fk-1')).toBe(
      true
    )
  })

  it('rangeConstraint + target-input handle：合法', () => {
    expect(isValidConstraintTargetHandle('r-1', 'rangeConstraint', 'target-input-r-1')).toBe(true)
  })

  it('scriptedConstraint + 非 target-input handle：非法', () => {
    expect(isValidConstraintTargetHandle('s-1', 'scriptedConstraint', 'target-left')).toBe(false)
  })

  it('allowedValuesConstraint + null handle：非法', () => {
    expect(isValidConstraintTargetHandle('a-1', 'allowedValuesConstraint', null)).toBe(false)
  })
})

describe('isValidConstraintTargetHandle - conditional 约束', () => {
  const condId = 'cond-1'

  it('IF handle（精确匹配）：合法', () => {
    expect(
      isValidConstraintTargetHandle(condId, 'conditionalConstraint', `target-if-${condId}`)
    ).toBe(true)
  })

  it('IF handle（带冒号后缀的复合 handle）：合法', () => {
    expect(
      isValidConstraintTargetHandle(condId, 'conditionalConstraint', `target-if-${condId}:col-x`)
    ).toBe(true)
  })

  it('THEN handle：合法', () => {
    expect(
      isValidConstraintTargetHandle(condId, 'conditionalConstraint', `target-then-${condId}`)
    ).toBe(true)
  })

  it('legacy THEN handle（target-input-）：合法', () => {
    expect(
      isValidConstraintTargetHandle(condId, 'conditionalConstraint', `target-input-${condId}`)
    ).toBe(true)
  })

  it('null handle：非法', () => {
    expect(isValidConstraintTargetHandle(condId, 'conditionalConstraint', null)).toBe(false)
  })

  it('非 IF/THEN 的其他 handle：非法', () => {
    expect(isValidConstraintTargetHandle(condId, 'conditionalConstraint', 'target-left')).toBe(
      false
    )
  })

  it('指向其他 conditional 节点的 handle：非法（节点 ID 不匹配）', () => {
    expect(
      isValidConstraintTargetHandle(condId, 'conditionalConstraint', 'target-if-other-node')
    ).toBe(false)
  })
})

describe('isValidConstraintTargetHandle - 其他约束（默认放行）', () => {
  // notNull / unique / composite 不 requireInputHandle，非 conditional → return true
  it('notNullConstraint 任意 handle 放行', () => {
    expect(isValidConstraintTargetHandle('n-1', 'notNullConstraint', 'target-left')).toBe(true)
  })

  it('uniqueConstraint null handle 放行', () => {
    expect(isValidConstraintTargetHandle('u-1', 'uniqueConstraint', null)).toBe(true)
  })
})
