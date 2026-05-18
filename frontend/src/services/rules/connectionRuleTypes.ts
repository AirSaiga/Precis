/**
 * @file connectionRuleTypes.ts
 * @description 连接规则类型定义
 *
 * 核心类型：
 * - NodeType: 所有节点类型的联合类型
 * - ConstraintNodeType: 约束节点类型的联合类型
 * - ConnectionRule: 连接规则接口
 * - ValidationResult: 验证结果接口
 * - ValidationErrorCode: 验证错误代码枚举
 *
 * 节点类型说明：
 * - projectRoot: 项目根节点
 * - patternToolbox: 模式工具箱
 * - pattern: 模式节点
 * - constraintDashboard: 约束仪表板
 * - schema: Schema节点
 * - sourcePreview: 数据源预览节点
 * - regex: 正则表达式节点
 * - constraint: 约束节点基类
 * - notNullConstraint: 非空约束
 * - uniqueConstraint: 唯一性约束
 * - foreignKeyConstraint: 外键约束
 * - allowedValuesConstraint: 允许值约束
 * - conditionalConstraint: 条件约束
 * - scriptedConstraint: 脚本约束
 */
import type { Connection, Node } from '@vue-flow/core'
import { getConstraintNodeTypes as getConstraintNodeTypesFromRegistry } from '@/services/constraints/validationRegistry'

export type NodeType =
  | 'projectRoot'
  | 'patternToolbox'
  | 'pattern'
  | 'constraintDashboard'
  | 'schema'
  | 'sourcePreview'
  | 'jsonSourcePreview'
  | 'jsonSchema'
  | 'regex'
  | 'transform'
  | 'transformOutput'
  | 'manualData'
  | 'constraint'
  | 'notNullConstraint'
  | 'uniqueConstraint'
  | 'foreignKeyConstraint'
  | 'allowedValuesConstraint'
  | 'rangeConstraint'
  | 'conditionalConstraint'
  | 'scriptedConstraint'
  | 'charsetConstraint'
  | 'dateLogicConstraint'
  | 'compositeConstraint'

export type ConstraintNodeType =
  | 'notNullConstraint'
  | 'uniqueConstraint'
  | 'foreignKeyConstraint'
  | 'allowedValuesConstraint'
  | 'rangeConstraint'
  | 'conditionalConstraint'
  | 'scriptedConstraint'
  | 'charsetConstraint'
  | 'dateLogicConstraint'
  | 'compositeConstraint'

export function isConstraintNodeType(type: string): type is ConstraintNodeType {
  return getConstraintNodeTypesFromRegistry().includes(type as ConstraintNodeType)
}

export interface SourceEndpoint {
  nodeTypes: NodeType[]
  handles?: string[]
}

export interface TargetEndpoint {
  nodeTypes: NodeType[]
  handles?: string[]
}

export interface ConnectionRuleConfig {
  allowMultiple?: boolean
  validationMode?: 'strict' | 'loose'
}

export interface ConnectionRule {
  id: string
  name: string
  source: SourceEndpoint
  target: TargetEndpoint
  config?: ConnectionRuleConfig
}

export interface ValidationResult {
  isValid: boolean
  rule?: ConnectionRule
  errorCode?: ValidationErrorCode
  message?: string
}

export type ValidationErrorCode =
  | 'INCOMPATIBLE_SOURCE_TYPE'
  | 'INCOMPATIBLE_TARGET_TYPE'
  | 'SOURCE_HANDLE_NOT_ALLOWED'
  | 'TARGET_HANDLE_NOT_ALLOWED'
  | 'HANDLE_MISMATCH'
  | 'MULTIPLE_CONNECTIONS_NOT_ALLOWED'
  | 'NO_MATCHING_RULE'

export interface AllowedConnection {
  sourceNodeType: NodeType
  sourceHandle?: string
  targetNodeType: NodeType
  targetHandle?: string
  rule: ConnectionRule
}

export interface ConnectionValidationContext {
  sourceNode: Node
  sourceHandle?: string
  targetNode: Node
  targetHandle?: string
  existingConnections: Connection[]
}
