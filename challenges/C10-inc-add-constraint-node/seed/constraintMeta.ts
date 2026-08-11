/**
 * 约束类型元信息注册表（C10 精简版）。
 * 每种约束需登记 nodeType / kind / v2Type / requireInputHandle 四字段，
 * 三者必须对齐（constraintMeta 是三层命名的单一事实源）。
 */
export interface ConstraintTypeMeta {
  nodeType: string
  kind: string
  v2Type: string
  requireInputHandle: boolean
}

export const CONSTRAINT_TYPES: ConstraintTypeMeta[] = [
  { nodeType: 'notNullConstraint', kind: 'notNull', v2Type: 'NotNull', requireInputHandle: false },
]
