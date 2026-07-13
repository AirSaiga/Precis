/**
 * @file edgeStyleResolver.ts
 * @description 边样式解析器（纯函数，从 useConnections C1 分支抽出）
 *
 * 根据源节点类型 + 目标节点类型（+ 目标 handle）的组合，解析出边的样式、
 * 标签、动画、class、data 等渲染属性。
 *
 * 特征：纯函数，无副作用，不依赖 Vue 响应式 / Pinia store / Vue Flow API。
 * 输入为节点类型组合与 handle，输出为样式对象。便于单元测试锁定每种组合的样式
 * 与隐式优先级（if-else 顺序即优先级）。
 *
 * 依赖方向：→ constraintMeta（类型判断）。无其他依赖。
 */

import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

/** 边样式解析输入 */
export interface ResolveEdgeStyleInput {
  /** 源节点 ID（FK 展示边 data.fkNodeId 用） */
  sourceNodeId: string
  /** 源节点类型 */
  sourceType: string | undefined
  /** 目标节点类型 */
  targetType: string | undefined
  /** 目标节点 ID（用于构造 conditional 的 if/then handle 名） */
  targetNodeId: string
  /** 目标 handle ID（部分样式依赖 handle，如 FK→target-left、conditional 的 if/then） */
  targetHandle: string | null | undefined
}

/** 边样式解析结果（与原 createEdgeStyle + if-else 赋值的字段对齐） */
export interface ResolvedEdgeStyle {
  type: string
  animated: boolean
  style: Record<string, unknown>
  label?: string
  class?: string
  data?: Record<string, unknown>
}

/**
 * 基础边样式（对应原 createEdgeStyle 工厂）
 *
 * 所有边都以 smoothstep + 默认动画起步，后续分支按需覆盖 style/label/class 等。
 */
function createBaseEdgeStyle(): ResolvedEdgeStyle {
  return {
    type: 'smoothstep',
    animated: true,
    style: { strokeWidth: 1.5 },
  }
}

/**
 * 解析连接的边样式
 *
 * 迁移自 useConnections.ts handleConnectionCompleted 的 C1 if-else 链。
 * **判断顺序即隐式优先级**——保持原顺序不变，由单元测试锁定。
 *
 * 分支概览（按判断顺序）：
 * 1. sourcePreview → schema：数据源连接（翡翠绿 + Data Source 标签）
 * 2. manualData → schema：手动数据源（绿 + Manual Data 标签）
 * 3. schema → manualData：列数据流（青 + Column Data 标签）
 * 4. manualData → constraint：默认边
 * 5. foreignKeyConstraint → schema(target-left)：FK 展示边（虚线 + class）
 * 6. (schema|jsonSchema|manualData) → constraint：默认边（conditional 分支特殊）
 * 7. (schema|jsonSchema) → constraint（conditional）：IF/THEN 分支配色
 * 8. (schema|jsonSchema) → (regex|regexExtract)：正则紫
 * 9. manualData → (regex|regexExtract)：正则紫
 * 10. transformOutput → (regex|regexExtract)：正则紫
 * 11. transformOutput → constraint：默认边
 * 12. → transform(transform-input)：数据流青
 * 未匹配：保持基础样式
 */
export function resolveEdgeStyle(input: ResolveEdgeStyleInput): ResolvedEdgeStyle {
  const { sourceNodeId, sourceType, targetType, targetNodeId, targetHandle } = input
  const edgeStyle = createBaseEdgeStyle()

  if (sourceType === 'sourcePreview' && targetType === 'schema') {
    edgeStyle.style = { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 }
    edgeStyle.label = 'Data Source'
  } else if (sourceType === 'manualData' && targetType === 'schema') {
    edgeStyle.style = { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 }
    edgeStyle.label = 'Manual Data'
  } else if (sourceType === 'schema' && targetType === 'manualData') {
    edgeStyle.style = { stroke: 'var(--edge-data-flow)', strokeWidth: 2 }
    edgeStyle.label = 'Column Data'
  } else if (sourceType === 'manualData' && isConstraintNodeType(targetType)) {
    edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
  } else if (
    sourceType === 'foreignKeyConstraint' &&
    targetType === 'schema' &&
    targetHandle === 'target-left'
  ) {
    // [展示边样式（FK→Schema）]
    // FK→Schema 的连线统一视为"展示边"，用于帮助用户理解参照关系，但不参与数据/校验语义。
    // - animated=false：避免与真实数据流边混淆
    // - class='fk-display-edge'：交由画布 CSS 控制"若隐若现"的动态效果
    // - strokeDasharray：虚线强化"提示/引用"的语义
    edgeStyle.animated = false
    edgeStyle.class = 'fk-display-edge'
    edgeStyle.style = {
      stroke: 'var(--edge-fk-display)',
      strokeWidth: 1.4,
      strokeDasharray: '2 8',
    }
    edgeStyle.data = { kind: 'fkDisplay', fkNodeId: sourceNodeId }
  } else if (
    (sourceType === 'schema' || sourceType === 'jsonSchema' || sourceType === 'manualData') &&
    isConstraintNodeType(targetType)
  ) {
    edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
  } else if (
    (sourceType === 'schema' || sourceType === 'jsonSchema') &&
    isConstraintNodeType(targetType)
  ) {
    if (targetType === 'conditionalConstraint') {
      const ifHandle = `target-if-${targetNodeId}`
      const thenHandle = `target-then-${targetNodeId}`
      const legacyThenHandle = `target-input-${targetNodeId}`
      if (targetHandle === thenHandle || targetHandle === legacyThenHandle) {
        edgeStyle.style = {
          stroke: 'var(--edge-conditional-then)',
          strokeWidth: 2.2,
          strokeDasharray: '4 6',
        }
        edgeStyle.label = 'THEN'
      } else if (targetHandle === ifHandle) {
        edgeStyle.style = { stroke: 'var(--edge-conditional-if)', strokeWidth: 2 }
        edgeStyle.label = 'IF'
      } else {
        edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
      }
    } else {
      edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
    }
  } else if (
    (sourceType === 'schema' || sourceType === 'jsonSchema') &&
    (targetType === 'regex' || targetType === 'regexExtract')
  ) {
    edgeStyle.style = { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 }
  } else if (
    sourceType === 'manualData' &&
    (targetType === 'regex' || targetType === 'regexExtract')
  ) {
    edgeStyle.style = { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 }
  } else if (
    sourceType === 'transformOutput' &&
    (targetType === 'regex' || targetType === 'regexExtract')
  ) {
    edgeStyle.style = { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 }
  } else if (sourceType === 'transformOutput' && isConstraintNodeType(targetType)) {
    edgeStyle.style = { stroke: 'var(--edge-default)', strokeWidth: 1.5 }
  } else if (targetType === 'transform' && targetHandle === 'transform-input') {
    edgeStyle.style = { stroke: 'var(--edge-data-flow)', strokeWidth: 2 }
  }

  return edgeStyle
}
