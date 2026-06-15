/**
 * @fileoverview Transform 类型常量与分类集合
 *
 * 将散落在 TransformNode.vue 中的类型分类常量集中管理，
 * 供计算逻辑、显示层、保存编排等模块统一引用。
 */

import type { TransformTypeV2 } from '@/types/projectV2'

/**
 * 会产生多列输出的 transform 类型。
 * 注意：仅包含在 save 路径（useTransformSave）中实际可能产生 >1 列的类型：
 * - StringSplit：按分隔符拆分，列数由数据决定（始终可能多列）
 * - RegexExtract：按捕获组数，用户可设置多个输出列名（条件性多列）
 * 其余类型（MathExpr/DateFormat/CastType/Concat/Substring/ConditionalAssign）
 * 在 save 时均走单列分支，不应列入此集合。
 */
export const MULTI_COLUMN_TRANSFORMS = new Set<TransformTypeV2>(['StringSplit', 'RegexExtract'])

/** 会改变行数的 transform 类型 */
export const ROW_CHANGING_TRANSFORMS = new Set([
  'FilterRows',
  'DropDuplicates',
  'Aggregate',
  'SortRows',
])

/** 单列变换类型：输入一列，输出一列 */
export const SINGLE_COLUMN_TRANSFORMS = new Set([
  'Strip',
  'UpperCase',
  'LowerCase',
  'Replace',
  'FillNA',
  'Lookup',
  'Modulo',
  'MapValue',
])

/** 行数改变的原子变换类型 */
export const ATOMIC_ROW_CHANGING_TRANSFORMS = new Set(['Digits'])

/** 行数改变型的标签映射 */
export const ROW_CHANGING_TYPE_LABELS: Record<string, string> = {
  FilterRows: '过滤结果',
  DropDuplicates: '去重结果',
  Aggregate: '聚合结果',
  SortRows: '排序结果',
}

/**
 * 判断给定的 transformType 是否需要独立的生成逻辑
 * （即不在 generateColumnOutput 的统一分支中处理）
 */
export function hasDedicatedGenerator(type: string): boolean {
  return (
    type === 'StringSplit' ||
    type === 'RegexExtract' ||
    type === 'Digits' ||
    type === 'WeightedSum' ||
    type === 'Modulo' ||
    type === 'MapValue' ||
    type === 'Substring' ||
    ROW_CHANGING_TRANSFORMS.has(type)
  )
}
