/**
 * @file ConstraintNodeLibrary.ts
 * @description 约束节点组件库
 */

import { markRaw } from 'vue'
import type { NodeComponent } from '@vue-flow/core'
import { CONSTRAINT_ICON_NAMES } from '@/components/icons/iconRegistry'
import {
  registerConstraintNode,
  constraintNodeRegistry,
} from '@/services/registry/constraintNodeRegistry'

// 导入所有约束节点组件
import NotNullConstraintNode from './NotNullConstraintNode.vue'
import UniqueConstraintNode from './UniqueConstraintNode.vue'
import ForeignKeyConstraintNode from './ForeignKeyConstraintNode.vue'
import AllowedValuesConstraintNode from './AllowedValuesConstraintNode.vue'
import RangeConstraintNode from './RangeConstraintNode.vue'
import ConditionalConstraintNode from './ConditionalConstraintNode.vue'
import ScriptedConstraintNode from './ScriptedConstraintNode.vue'
import CharsetConstraintNode from './CharsetConstraintNode.vue'
import DateLogicConstraintNode from './DateLogicConstraintNode.vue'
import CompositeConstraintNode from './CompositeConstraintNode.vue'

/**
 * 约束节点组件库
 * 集中管理和注册所有约束节点组件
 */
export const registerConstraintNodeLibrary = () => {
  // 注册非空约束节点
  registerConstraintNode('notNull', {
    component: markRaw(NotNullConstraintNode) as unknown as NodeComponent,
    displayName: '非空约束',
    icon: CONSTRAINT_ICON_NAMES.notNull,
    category: 'attribute',
    description: '确保列中的值不为空',
  })

  // 注册唯一约束节点
  registerConstraintNode('unique', {
    component: markRaw(UniqueConstraintNode) as unknown as NodeComponent,
    displayName: '唯一约束',
    icon: CONSTRAINT_ICON_NAMES.unique,
    category: 'attribute',
    description: '确保列中的值唯一',
  })

  // 注册外键约束节点
  registerConstraintNode('foreignKey', {
    component: markRaw(ForeignKeyConstraintNode) as unknown as NodeComponent,
    displayName: '外键约束',
    icon: CONSTRAINT_ICON_NAMES.foreignKey,
    category: 'relation',
    description: '确保列中的值引用其他表的主键',
  })

  // 注册允许值约束节点
  registerConstraintNode('allowedValues', {
    component: markRaw(AllowedValuesConstraintNode) as unknown as NodeComponent,
    displayName: '允许值约束',
    icon: CONSTRAINT_ICON_NAMES.allowedValues,
    category: 'relation',
    description: '确保列中的值在允许的范围内',
  })

  // 注册区间约束节点
  registerConstraintNode('range', {
    component: markRaw(RangeConstraintNode) as unknown as NodeComponent,
    displayName: '区间约束',
    icon: CONSTRAINT_ICON_NAMES.range,
    category: 'attribute',
    description: '确保列中的值在指定数值范围内',
  })

  // 注册条件约束节点
  registerConstraintNode('conditional', {
    component: markRaw(ConditionalConstraintNode) as unknown as NodeComponent,
    displayName: '条件约束',
    icon: CONSTRAINT_ICON_NAMES.conditional,
    category: 'logic',
    description: '基于条件验证列中的值',
  })

  // 注册脚本约束节点
  registerConstraintNode('scripted', {
    component: markRaw(ScriptedConstraintNode) as unknown as NodeComponent,
    displayName: '脚本约束',
    icon: CONSTRAINT_ICON_NAMES.scripted,
    category: 'logic',
    description: '使用自定义脚本验证列中的值',
  })

  // 注册字符集约束节点
  registerConstraintNode('charset', {
    component: markRaw(CharsetConstraintNode) as unknown as NodeComponent,
    displayName: '字符集约束',
    icon: CONSTRAINT_ICON_NAMES.charset,
    category: 'attribute',
    description: '校验ASCII或中文字符',
  })

  // 注册日期逻辑约束节点
  registerConstraintNode('dateLogic', {
    component: markRaw(DateLogicConstraintNode) as unknown as NodeComponent,
    displayName: '日期逻辑约束',
    icon: CONSTRAINT_ICON_NAMES.dateLogic,
    category: 'logic',
    description: '日期比较和计算校验',
  })

  // 注册复合约束节点
  registerConstraintNode('composite', {
    component: markRaw(CompositeConstraintNode) as unknown as NodeComponent,
    displayName: '复合约束',
    icon: CONSTRAINT_ICON_NAMES.composite,
    category: 'logic',
    description: '将多个约束组织为逻辑单元，支持 all/any/none 策略',
  })
}

/**
 * 获取约束节点类型映射
 * 用于Vue Flow的nodeTypes配置
 */
export const getConstraintNodeTypes = () => {
  return {
    notNullConstraint: constraintNodeRegistry.notNull?.component || null,
    uniqueConstraint: constraintNodeRegistry.unique?.component || null,
    foreignKeyConstraint: constraintNodeRegistry.foreignKey?.component || null,
    allowedValuesConstraint: constraintNodeRegistry.allowedValues?.component || null,
    rangeConstraint: constraintNodeRegistry.range?.component || null,
    conditionalConstraint: constraintNodeRegistry.conditional?.component || null,
    scriptedConstraint: constraintNodeRegistry.scripted?.component || null,
    charsetConstraint: constraintNodeRegistry.charset?.component || null,
    dateLogicConstraint: constraintNodeRegistry.dateLogic?.component || null,
    compositeConstraint: constraintNodeRegistry.composite?.component || null,
  }
}
