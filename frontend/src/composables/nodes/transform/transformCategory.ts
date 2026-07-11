/**
 * @fileoverview Transform 类型分类与语义数据源
 *
 * 单一数据源，集中管理 22 种 transformType 的：
 * - 分类归属（5 个分类，与右键菜单一致）
 * - 分类图标
 * - 输入/输出语义（单列变换 / 单列→多列 / 会改变行数等）
 *
 * 供以下消费方共用，避免分类定义重复维护：
 * - 检查器类型说明卡（DescriptionCardRenderer）
 * - 检查器类型切换下拉（TransformTypeSelectRenderer）
 * - 画布右键节点菜单（TransformContextMenu）
 */

import type { TransformTypeV2 } from '@/types/projectV2'
import {
  TRANSFORM_CATEGORY_ICON_NAMES,
  TRANSFORM_TYPE_ICON_NAMES,
} from '@/components/icons/iconRegistry'

/**
 * Transform 分类标识。
 * 顺序即展示顺序。
 */
export type TransformCategoryId = 'text' | 'numeric' | 'cleaning' | 'structure' | 'date'

/**
 * Transform 输入/输出语义标签。
 * 用于在说明卡上提示用户该类型对数据形态的影响。
 * - `singleColumn`：单列变换，输入一列输出一列
 * - `multiColumn`：单列展开为多列
 * - `rowChanging`：会改变行数
 * - `rowAtomic`：行级原子拆分（如逐位分解）
 */
export type TransformSemantic = 'singleColumn' | 'multiColumn' | 'rowChanging' | 'rowAtomic'

export interface TransformCategory {
  /** 分类唯一标识 */
  id: TransformCategoryId
  /** 分类图标名（对应 iconRegistry） */
  icon: string
  /** 分类名称 i18n key */
  labelKey: string
  /** 该分类下的所有 transformType */
  types: TransformTypeV2[]
}

/**
 * Transform 分类定义（5 个分类，顺序即展示顺序）。
 *
 * 注意：必须与 `transformTypeRegistry.ts` 的语义分类集合保持一致：
 * - text/numeric/date 多为单列或单列→多列
 * - cleaning 含部分行变化类型（FilterRows/DropDuplicates/SortRows）
 * - structure 含行变化类型（Aggregate）
 */
export const TRANSFORM_CATEGORIES: TransformCategory[] = [
  {
    id: 'text',
    icon: TRANSFORM_CATEGORY_ICON_NAMES.text,
    labelKey: 'inspector.transformNode.categories.text',
    types: [
      'StringSplit',
      'RegexExtract',
      'Strip',
      'UpperCase',
      'LowerCase',
      'Replace',
      'Concat',
      'Substring',
      'Lookup',
    ],
  },
  {
    id: 'numeric',
    icon: TRANSFORM_CATEGORY_ICON_NAMES.numeric,
    labelKey: 'inspector.transformNode.categories.numeric',
    types: ['MathExpr', 'WeightedSum', 'Modulo', 'Digits'],
  },
  {
    id: 'cleaning',
    icon: TRANSFORM_CATEGORY_ICON_NAMES.cleaning,
    labelKey: 'inspector.transformNode.categories.cleaning',
    types: ['FilterRows', 'FillNA', 'DropDuplicates', 'CastType', 'SortRows'],
  },
  {
    id: 'structure',
    icon: TRANSFORM_CATEGORY_ICON_NAMES.structure,
    labelKey: 'inspector.transformNode.categories.structure',
    types: ['Aggregate', 'ConditionalAssign', 'MapValue'],
  },
  {
    id: 'date',
    icon: TRANSFORM_CATEGORY_ICON_NAMES.date,
    labelKey: 'inspector.transformNode.categories.date',
    types: ['DateFormat'],
  },
]

/**
 * 各 transformType 的输入/输出语义。
 *
 * 与 `transformTypeRegistry.ts` 的集合分类对齐：
 * - `MULTI_COLUMN_TRANSFORMS` → `multiColumn`
 * - `ROW_CHANGING_TRANSFORMS` / `ATOMIC_ROW_CHANGING_TRANSFORMS` → `rowChanging` / `rowAtomic`
 * - 其余单列变换 → `singleColumn`
 */
export const TRANSFORM_SEMANTICS: Record<TransformTypeV2, TransformSemantic> = {
  // 单列变换
  Strip: 'singleColumn',
  UpperCase: 'singleColumn',
  LowerCase: 'singleColumn',
  Replace: 'singleColumn',
  FillNA: 'singleColumn',
  Lookup: 'singleColumn',
  Modulo: 'singleColumn',
  MapValue: 'singleColumn',
  MathExpr: 'singleColumn',
  DateFormat: 'singleColumn',
  CastType: 'singleColumn',
  Substring: 'singleColumn',
  // 单列 → 多列
  StringSplit: 'multiColumn',
  RegexExtract: 'multiColumn',
  // Concat 实际只输出单个拼接列（useTransformSave 走单列分支），非多列
  // 会改变行数
  FilterRows: 'rowChanging',
  DropDuplicates: 'rowChanging',
  SortRows: 'rowChanging',
  Aggregate: 'rowChanging',
  ConditionalAssign: 'singleColumn',
  Concat: 'singleColumn',
  // 行级原子拆分
  Digits: 'rowAtomic',
  WeightedSum: 'rowAtomic',
}

/**
 * 根据transformType 查找其所属分类。
 * 找不到时返回 undefined（理论上不应发生，用于防御性编程）。
 */
export function getCategoryForType(type: TransformTypeV2): TransformCategory | undefined {
  return TRANSFORM_CATEGORIES.find((c) => c.types.includes(type))
}

/**
 * 获取 transformType 所属分类的图标。
 */
export function getCategoryIcon(type: TransformTypeV2): string {
  return getCategoryForType(type)?.icon ?? 'gear'
}

/**
 * 获取 transformType 所属分类 id。
 */
export function getCategoryId(type: TransformTypeV2): TransformCategoryId | undefined {
  return getCategoryForType(type)?.id
}

/**
 * 获取 transformType 的输入/输出语义。
 */
export function getSemanticForType(type: TransformTypeV2): TransformSemantic {
  return TRANSFORM_SEMANTICS[type] ?? 'singleColumn'
}

/**
 * 获取 transformType 的专属类型图标名。
 *
 * 查找顺序：
 *   1. TRANSFORM_TYPE_ICON_NAMES 命中 → 返回类型级图标
 *   2. 否则回退到分类图标（getCategoryIcon）
 *   3. 分类也找不到 → getCategoryIcon 自身返回 'gear'
 *
 * 保证任何输入都不抛错、不返回空串。
 */
export function getTransformTypeIcon(type: TransformTypeV2): string {
  const typeIcon = TRANSFORM_TYPE_ICON_NAMES[type]
  if (typeIcon) return typeIcon
  return getCategoryIcon(type)
}
