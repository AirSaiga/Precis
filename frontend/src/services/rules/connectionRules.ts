/**
 * @file connectionRules.ts
 * @description 连接规则配置
 *
 * 核心功能：
 * - 定义节点之间连接的规则
 * - 指定源节点类型和目标节点类型的兼容性
 * - 配置连接的多重性和验证模式
 *
 * 预定义规则：
 * - source-to-schema: SourcePreview → Schema 连接
 * - schema-to-regex: Schema → Regex 连接
 * - schema-to-constraint: Schema → 约束节点 连接
 * - pattern-to-regex: Pattern → Regex 连接
 * - schema-to-schema-set: Schema → SchemaSet 连接
 *
 * 配置说明：
 * - allowMultiple: 是否允许多重连接
 * - validationMode: 验证模式（strict/lenient）
 */
import type { ConnectionRule } from './connectionRuleTypes'
import { isConstraintNodeType } from './connectionRuleTypes'
import { getConstraintNodeTypes as getConstraintNodeTypesFromRegistry } from '@/services/constraints/validationRegistry'

export const connectionRules: ConnectionRule[] = [
  {
    id: 'source-to-schema',
    name: 'SourcePreview to Schema',
    source: {
      nodeTypes: ['sourcePreview'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['schema'],
      handles: ['target-left'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'json-source-to-schema',
    name: 'JsonSourcePreview to JsonSchema',
    source: {
      nodeTypes: ['jsonSourcePreview'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['jsonSchema'],
      handles: ['target-left'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'schema-to-regex',
    name: 'Schema to Regex',
    source: {
      nodeTypes: ['schema', 'jsonSchema'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['regex'],
      handles: ['regex-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'pattern-to-regex',
    name: 'Pattern to Regex',
    source: {
      nodeTypes: ['pattern'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['regex'],
      handles: ['regex-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'schema-to-constraint',
    name: 'Schema to Constraint',
    source: {
      nodeTypes: ['schema', 'jsonSchema'],
      handles: undefined,
    },
    target: {
      nodeTypes: [
        'notNullConstraint',
        'uniqueConstraint',
        'foreignKeyConstraint',
        'allowedValuesConstraint',
        'rangeConstraint',
        'conditionalConstraint',
        'scriptedConstraint',
        'charsetConstraint',
        'dateLogicConstraint',
        'compositeConstraint',
      ],
      handles: undefined,
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'foreign-key-display',
    name: 'ForeignKey to Schema (Display)',
    source: {
      nodeTypes: ['foreignKeyConstraint'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['schema', 'jsonSchema'],
      handles: undefined,
    },
    config: {
      allowMultiple: true,
      validationMode: 'loose',
    },
  },
  // ========== Manual Data 节点连接规则 ==========
  {
    id: 'schema-column-to-manual-data',
    name: 'Schema Column to ManualData',
    source: {
      nodeTypes: ['schema'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['manualData'],
      handles: ['target-left'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'manual-data-to-schema',
    name: 'ManualData to Schema',
    source: {
      nodeTypes: ['manualData'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['schema'],
      handles: ['target-left'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'manual-data-to-regex',
    name: 'ManualData to Regex',
    source: {
      nodeTypes: ['manualData'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['regex'],
      handles: ['regex-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'manual-data-to-constraint',
    name: 'ManualData to Constraint',
    source: {
      nodeTypes: ['manualData'],
      handles: undefined,
    },
    target: {
      nodeTypes: [
        'notNullConstraint',
        'uniqueConstraint',
        'foreignKeyConstraint',
        'allowedValuesConstraint',
        'rangeConstraint',
        'conditionalConstraint',
        'scriptedConstraint',
        'charsetConstraint',
        'dateLogicConstraint',
        'compositeConstraint',
      ],
      handles: undefined,
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  // ========== Manual Data → Transform 连接规则 ==========
  {
    id: 'manual-data-to-transform',
    name: 'ManualData to Transform',
    source: {
      nodeTypes: ['manualData'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['transform'],
      handles: ['transform-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  // ========== Transform Output 下游连接规则 ==========
  {
    id: 'transform-output-to-transform',
    name: 'TransformOutput to Transform',
    source: {
      nodeTypes: ['transformOutput'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['transform'],
      handles: ['transform-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'transform-output-to-regex',
    name: 'TransformOutput to Regex',
    source: {
      nodeTypes: ['transformOutput'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['regex'],
      handles: ['regex-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'transform-output-to-constraint',
    name: 'TransformOutput to Constraint',
    source: {
      nodeTypes: ['transformOutput'],
      handles: undefined,
    },
    target: {
      nodeTypes: [
        'notNullConstraint',
        'uniqueConstraint',
        'foreignKeyConstraint',
        'allowedValuesConstraint',
        'rangeConstraint',
        'conditionalConstraint',
        'scriptedConstraint',
        'charsetConstraint',
        'dateLogicConstraint',
        'compositeConstraint',
      ],
      handles: undefined,
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  // ========== Transform 功能节点连接规则 ==========
  {
    id: 'source-to-transform',
    name: 'SourcePreview to Transform',
    source: {
      nodeTypes: ['sourcePreview'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['transform'],
      handles: ['transform-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'schema-to-transform',
    name: 'Schema to Transform',
    source: {
      nodeTypes: ['schema', 'jsonSchema'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['transform'],
      handles: ['transform-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'transform-to-transform',
    name: 'Transform to Transform',
    source: {
      nodeTypes: ['transform'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['transform'],
      handles: ['transform-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'transform-to-transform-output',
    name: 'Transform to TransformOutput',
    source: {
      nodeTypes: ['transform'],
      handles: ['transform-output'],
    },
    target: {
      nodeTypes: ['transformOutput'],
      handles: ['target-left'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'transform-to-regex',
    name: 'Transform to Regex',
    source: {
      nodeTypes: ['transform'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['regex'],
      handles: ['regex-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'regex-to-transform',
    name: 'Regex to Transform',
    source: {
      nodeTypes: ['regex'],
      handles: undefined,
    },
    target: {
      nodeTypes: ['transform'],
      handles: ['transform-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
  {
    id: 'transform-to-constraint',
    name: 'Transform to Constraint',
    source: {
      nodeTypes: ['transform'],
      handles: undefined,
    },
    target: {
      nodeTypes: [
        'notNullConstraint',
        'uniqueConstraint',
        'foreignKeyConstraint',
        'allowedValuesConstraint',
        'rangeConstraint',
        'conditionalConstraint',
        'scriptedConstraint',
        'charsetConstraint',
        'dateLogicConstraint',
      ],
      handles: undefined,
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },

  // ========== 模板实例节点连接规则（仅输入端口） ==========

  // Schema → 模板实例（输入端口）
  {
    id: 'schema-to-template-instance',
    name: 'Schema → 模板实例',
    source: {
      nodeTypes: ['schema', 'jsonSchema'],
    },
    target: {
      nodeTypes: ['templateInstance'],
      handles: ['template-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },

  // TransformOutput → 模板实例（输入端口）
  {
    id: 'transform-output-to-template-instance',
    name: 'TransformOutput → 模板实例',
    source: {
      nodeTypes: ['transformOutput'],
    },
    target: {
      nodeTypes: ['templateInstance'],
      handles: ['template-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },

  // ManualData → 模板实例（输入端口）
  {
    id: 'manual-data-to-template-instance',
    name: 'ManualData → 模板实例',
    source: {
      nodeTypes: ['manualData'],
    },
    target: {
      nodeTypes: ['templateInstance'],
      handles: ['template-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },

  // Transform → 模板实例（输入端口）
  {
    id: 'transform-to-template-instance',
    name: 'Transform → 模板实例',
    source: {
      nodeTypes: ['transform'],
    },
    target: {
      nodeTypes: ['templateInstance'],
      handles: ['template-input'],
    },
    config: {
      allowMultiple: false,
      validationMode: 'strict',
    },
  },
]

export function getRuleById(id: string): ConnectionRule | undefined {
  // 使用 Array.find 进行精确查找
  // 时间复杂度: O(n)，但规则数量少（< 20），性能可接受
  return connectionRules.find((rule) => rule.id === id)
}

/**
 * 根据源节点类型获取所有可用的连接规则
 *
 * 业务场景：
 * 当用户开始拖拽连接线时，需要查找从当前节点可以连接到哪些目标节点。
 *
 * 实现逻辑：
 * 使用 filter 过滤出所有源节点类型匹配的规则
 *
 * 架构决策：
 * - 使用 filter 而非 find，因为一个源节点可能有多个可连接的目标
 * - 返回数组而非单个规则，支持一个源节点连接到多种类型的目标
 *
 * @param nodeType - 源节点类型
 * @returns 可用的连接规则数组
 */
export function getRulesForSourceNodeType(nodeType: string): ConnectionRule[] {
  // 过滤规则：筛选出源节点类型包含指定类型的规则
  return connectionRules.filter((rule) => rule.source.nodeTypes.some((t) => t === nodeType))
}

/**
 * 根据目标节点类型获取所有可用的连接规则
 *
 * 业务场景：
 * 当用户在目标节点上释放连接线时，需要查找哪些源节点可以连接到当前目标。
 *
 * @param nodeType - 目标节点类型
 * @returns 可用的连接规则数组
 */
export function getRulesForTargetNodeType(nodeType: string): ConnectionRule[] {
  // 过滤规则：筛选出目标节点类型包含指定类型的规则
  return connectionRules.filter((rule) => rule.target.nodeTypes.some((t) => t === nodeType))
}

/**
 * 判断连接是否为 Schema 到约束节点的连接
 *
 * 业务场景：
 * 需要区分普通数据流连接和约束连接，以便应用不同的边样式和处理逻辑。
 *
 * 约束连接特点：
 * - 源节点必须是 schema
 * - 目标节点必须是约束类型节点
 *
 * @param sourceNodeType - 源节点类型
 * @param targetNodeType - 目标节点类型
 * @returns 是否为约束连接
 */
export function isConstraintNodeConnection(
  sourceNodeType: string,
  targetNodeType: string
): boolean {
  // Schema/JsonSchema/TransformOutput/ManualData → 约束节点的连接
  return (
    (sourceNodeType === 'schema' ||
      sourceNodeType === 'jsonSchema' ||
      sourceNodeType === 'transformOutput' ||
      sourceNodeType === 'manualData') &&
    isConstraintNodeType(targetNodeType)
  )
}

/**
 * 获取所有约束节点类型
 *
 * 用途：
 * - 验证节点类型是否为约束节点
 * - 动态生成约束节点菜单
 * - 过滤约束相关功能
 *
 * @returns 约束节点类型字符串数组
 */
export function getConstraintNodeTypes(): string[] {
  return getConstraintNodeTypesFromRegistry()
}
