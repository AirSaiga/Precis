/**
 * @file index.ts
 * @description 连接规则服务统一导出入口
 */

export type {
  NodeType,
  ConstraintNodeType,
  SourceEndpoint,
  TargetEndpoint,
  ConnectionRuleConfig,
  ConnectionRule,
  ValidationResult,
  ValidationErrorCode,
  AllowedConnection,
  ConnectionValidationContext,
} from './connectionRuleTypes'

export { isConstraintNodeType } from './connectionRuleTypes'

export {
  connectionRules,
  getRuleById,
  getRulesForSourceNodeType,
  getRulesForTargetNodeType,
  isConstraintNodeConnection,
  getConstraintNodeTypes,
} from './connectionRules'
