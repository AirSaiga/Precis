/**
 * @file constraintMeta.ts
 * @description 约束类型元数据表 + 三向映射查询（nodeType ↔ kind ↔ v2Type）
 *
 * 本模块是约束类型系统的"是什么"层：定义所有约束类型的元数据，
 * 并提供三向映射查询接口。不含校验逻辑或副作用。
 *
 * 单一事实源：CONSTRAINT_TYPES 驱动所有派生查询，
 * 新增约束类型只需在 CONSTRAINT_TYPES 加一行。
 */

import type { ConstraintKind, ConstraintNodeType, ConstraintTypeMeta } from './types'

// ============================================================================
// 元数据表（单一事实源）
// ============================================================================

export const CONSTRAINT_TYPES: ConstraintTypeMeta[] = [
  { nodeType: 'notNullConstraint', kind: 'notNull', v2Type: 'NotNull', requireInputHandle: false },
  { nodeType: 'uniqueConstraint', kind: 'unique', v2Type: 'Unique', requireInputHandle: false },
  {
    nodeType: 'foreignKeyConstraint',
    kind: 'foreignKey',
    v2Type: 'ForeignKey',
    requireInputHandle: true,
  },
  {
    nodeType: 'allowedValuesConstraint',
    kind: 'allowedValues',
    v2Type: 'AllowedValues',
    requireInputHandle: true,
  },
  { nodeType: 'rangeConstraint', kind: 'range', v2Type: 'Range', requireInputHandle: true },
  {
    nodeType: 'conditionalConstraint',
    kind: 'conditional',
    v2Type: 'Conditional',
    requireInputHandle: false,
  },
  {
    nodeType: 'scriptedConstraint',
    kind: 'scripted',
    v2Type: 'Scripted',
    requireInputHandle: true,
  },
  { nodeType: 'charsetConstraint', kind: 'charset', v2Type: 'Charset', requireInputHandle: true },
  {
    nodeType: 'dateLogicConstraint',
    kind: 'dateLogic',
    v2Type: 'DateLogic',
    requireInputHandle: true,
  },
  {
    nodeType: 'compositeConstraint',
    kind: 'composite',
    v2Type: 'Composite',
    requireInputHandle: true,
  },
]

// 预构建查找 Map
export const typeToMeta = new Map(CONSTRAINT_TYPES.map((x) => [x.nodeType, x]))
export const kindToMeta = new Map(CONSTRAINT_TYPES.map((x) => [x.kind, x]))

// ============================================================================
// 三向映射查询函数
// ============================================================================

/** V2 类型 → ConstraintKind */
export function getConstraintKindByV2Type(v2Type: string): ConstraintKind | undefined {
  return CONSTRAINT_TYPES.find((x) => x.v2Type === v2Type)?.kind
}

/** V2 类型 → ConstraintNodeType */
export function getConstraintNodeTypeByV2Type(v2Type: string): ConstraintNodeType | undefined {
  return CONSTRAINT_TYPES.find((x) => x.v2Type === v2Type)?.nodeType
}

/** ConstraintKind → V2 类型字符串 */
export function getV2TypeByConstraintKind(kind: ConstraintKind): string | undefined {
  return CONSTRAINT_TYPES.find((x) => x.kind === kind)?.v2Type
}

/** ConstraintKind → 元数据 */
export function getConstraintMetaByKind(kind: ConstraintKind): ConstraintTypeMeta | null {
  return kindToMeta.get(kind) || null
}

/** ConstraintKind → V2 类型字符串（通过 kindToMeta 查询） */
export function getV2ConstraintTypeByKind(kind: ConstraintKind): ConstraintTypeMeta['v2Type'] | '' {
  return kindToMeta.get(kind)?.v2Type || ''
}

/** ConstraintNodeType → V2 类型字符串 */
export function getV2ConstraintTypeByNodeType(
  nodeType: string | undefined
): ConstraintTypeMeta['v2Type'] | '' {
  if (!nodeType) return ''
  return typeToMeta.get(nodeType as ConstraintNodeType)?.v2Type || ''
}

// ============================================================================
// 列表查询
// ============================================================================

/** 获取所有约束节点类型（用于连接规则等需要枚举全部类型的场景） */
export function getConstraintNodeTypes(): ConstraintNodeType[] {
  return CONSTRAINT_TYPES.map((x) => x.nodeType)
}

/** 获取所有约束 Kind（用于 UI 枚举可选约束类型） */
export function getConstraintKinds(): ConstraintKind[] {
  return CONSTRAINT_TYPES.map((x) => x.kind)
}

// ============================================================================
// 类型守卫与单节点查询
// ============================================================================

/** 类型守卫：判断字符串是否为合法的约束节点类型 */
export function isConstraintNodeType(type: string | undefined): type is ConstraintNodeType {
  if (!type) return false
  return typeToMeta.has(type as ConstraintNodeType)
}

/** ConstraintNodeType → ConstraintKind（空字符串表示非约束类型） */
export function getConstraintKindByNodeType(type: string | undefined): ConstraintKind | '' {
  if (!type) return ''
  return typeToMeta.get(type as ConstraintNodeType)?.kind || ''
}

/** 判断该约束类型是否需要输入连接（input handle） */
export function requiresInputHandle(nodeType: string | undefined): boolean {
  if (!nodeType) return false
  return typeToMeta.get(nodeType as ConstraintNodeType)?.requireInputHandle || false
}
