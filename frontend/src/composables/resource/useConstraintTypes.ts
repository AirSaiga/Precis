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
  category: 'attribute' | 'relation' | 'logic'
  requireScriptEnabled?: boolean
  icon: string
}

/** 约束类型图标映射 */
export const CONSTRAINT_ICONS: Record<string, string> = {
  notNull:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  unique:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  range:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 6H3M21 18H3M12 6v12"/></svg>',
  charset:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  allowedValues:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  foreignKey:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  conditional:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  scripted:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  dateLogic:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
}

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
    return constraint.requireScriptEnabled && !settingsStore.isScriptEnabled
  }

  return {
    attributeConstraints,
    relationConstraints,
    logicConstraints,
    isConstraintDisabled,
  }
}
