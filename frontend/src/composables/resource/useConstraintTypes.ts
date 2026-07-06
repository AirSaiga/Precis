/**
 * @file useConstraintTypes.ts
 * @description 约束类型元数据与分类组合式函数
 *
 * 功能职责：
 * - 提供约束类型图标、名称、分类等元数据
 * - 根据设置判断约束是否可用
 * - 按 attribute/relation/logic 分类约束类型
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { CONSTRAINT_ICON_NAMES } from '@/components/icons/iconRegistry'

/** 约束类型项 */
export interface ConstraintTypeItem {
  id: string
  name: string
  constraintType:
    | 'foreignKey'
    | 'unique'
    | 'notNull'
    | 'allowedValues'
    | 'conditional'
    | 'scripted'
    | 'range'
    | 'charset'
    | 'dateLogic'
    | 'composite'
  category: 'attribute' | 'relation' | 'logic'
  requireScriptEnabled?: boolean
  icon: string
}

/** 约束类型图标映射 */
export const CONSTRAINT_ICONS = {
  notNull: CONSTRAINT_ICON_NAMES.notNull,
  unique: CONSTRAINT_ICON_NAMES.unique,
  range: CONSTRAINT_ICON_NAMES.range,
  charset: CONSTRAINT_ICON_NAMES.charset,
  allowedValues: CONSTRAINT_ICON_NAMES.allowedValues,
  foreignKey: CONSTRAINT_ICON_NAMES.foreignKey,
  conditional: CONSTRAINT_ICON_NAMES.conditional,
  scripted: CONSTRAINT_ICON_NAMES.scripted,
  dateLogic: CONSTRAINT_ICON_NAMES.dateLogic,
  composite: CONSTRAINT_ICON_NAMES.composite,
} as const satisfies Record<string, string>

/** 约束类型完整列表 */
export const CONSTRAINT_TYPES: ConstraintTypeItem[] = [
  {
    id: 'not-null',
    name: '非空约束',
    constraintType: 'notNull',
    category: 'attribute',
    icon: CONSTRAINT_ICONS.notNull,
  },
  {
    id: 'unique',
    name: '唯一约束',
    constraintType: 'unique',
    category: 'attribute',
    icon: CONSTRAINT_ICONS.unique,
  },
  {
    id: 'range',
    name: '区间约束',
    constraintType: 'range',
    category: 'attribute',
    icon: CONSTRAINT_ICONS.range,
  },
  {
    id: 'charset',
    name: '字符集约束',
    constraintType: 'charset',
    category: 'attribute',
    icon: CONSTRAINT_ICONS.charset,
  },
  {
    id: 'allowed-values',
    name: '允许值约束',
    constraintType: 'allowedValues',
    category: 'relation',
    icon: CONSTRAINT_ICONS.allowedValues,
  },
  {
    id: 'foreign-key',
    name: '外键约束',
    constraintType: 'foreignKey',
    category: 'relation',
    icon: CONSTRAINT_ICONS.foreignKey,
  },
  {
    id: 'conditional',
    name: '条件约束',
    constraintType: 'conditional',
    category: 'logic',
    icon: CONSTRAINT_ICONS.conditional,
  },
  {
    id: 'scripted',
    name: '脚本约束',
    constraintType: 'scripted',
    category: 'logic',
    requireScriptEnabled: true,
    icon: CONSTRAINT_ICONS.scripted,
  },
  {
    id: 'date-logic',
    name: '日期逻辑约束',
    constraintType: 'dateLogic',
    category: 'logic',
    icon: CONSTRAINT_ICONS.dateLogic,
  },
  {
    id: 'composite',
    name: '复合约束',
    constraintType: 'composite',
    category: 'logic',
    icon: CONSTRAINT_ICONS.composite,
  },
]

/**
 * 约束类型组合式函数
 *
 * 返回：
 * - 按分类筛选的约束列表
 * - 约束可用性判断函数
 */
export function useConstraintTypes() {
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const constraintNameMap: Record<string, string> = {
    notNull: 'customNodes.constraintRules.notNullConstraintNode.title',
    unique: 'customNodes.constraintRules.uniqueConstraintNode.title',
    range: 'customNodes.constraintRules.rangeConstraintNode.title',
    charset: 'customNodes.constraintRules.charsetConstraintNode.title',
    allowedValues: 'customNodes.constraintRules.allowedValuesConstraintNode.title',
    foreignKey: 'customNodes.constraintRules.foreignKeyConstraintNode.title',
    conditional: 'customNodes.constraintRules.conditionalConstraintNode.title',
    scripted: 'customNodes.constraintRules.scriptedConstraintNode.title',
    dateLogic: 'customNodes.constraintRules.dateLogicConstraintNode.title',
    composite: 'customNodes.constraintRules.compositeConstraintNode.title',
  }

  function localizeConstraint(c: ConstraintTypeItem): ConstraintTypeItem {
    const key = constraintNameMap[c.constraintType]
    return key ? { ...c, name: t(key) } : c
  }

  // 按分类计算的约束列表
  const attributeConstraints = computed(() =>
    CONSTRAINT_TYPES.filter((c) => c.category === 'attribute').map(localizeConstraint)
  )
  const relationConstraints = computed(() =>
    CONSTRAINT_TYPES.filter((c) => c.category === 'relation').map(localizeConstraint)
  )
  const logicConstraints = computed(() =>
    CONSTRAINT_TYPES.filter((c) => c.category === 'logic').map(localizeConstraint)
  )

  /**
   * 判断约束类型是否被禁用
   */
  const isConstraintDisabled = (constraint: ConstraintTypeItem): boolean => {
    return Boolean(constraint.requireScriptEnabled) && !settingsStore.isScriptEnabled
  }

  return {
    attributeConstraints,
    relationConstraints,
    logicConstraints,
    isConstraintDisabled,
  }
}
