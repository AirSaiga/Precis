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
  // 注册约束节点组件。显示名称/描述统一由 i18n 的 constraintTypes 命名空间提供，
  // 此处只登记组件、图标、分类等渲染所需的非文案元数据。
  registerConstraintNode('notNull', {
    component: markRaw(NotNullConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.notNull,
    category: 'attribute',
  })

  registerConstraintNode('unique', {
    component: markRaw(UniqueConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.unique,
    category: 'attribute',
  })

  registerConstraintNode('foreignKey', {
    component: markRaw(ForeignKeyConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.foreignKey,
    category: 'relation',
  })

  registerConstraintNode('allowedValues', {
    component: markRaw(AllowedValuesConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.allowedValues,
    category: 'relation',
  })

  registerConstraintNode('range', {
    component: markRaw(RangeConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.range,
    category: 'attribute',
  })

  registerConstraintNode('conditional', {
    component: markRaw(ConditionalConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.conditional,
    category: 'logic',
  })

  registerConstraintNode('scripted', {
    component: markRaw(ScriptedConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.scripted,
    category: 'logic',
  })

  registerConstraintNode('charset', {
    component: markRaw(CharsetConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.charset,
    category: 'attribute',
  })

  registerConstraintNode('dateLogic', {
    component: markRaw(DateLogicConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.dateLogic,
    category: 'logic',
  })

  registerConstraintNode('composite', {
    component: markRaw(CompositeConstraintNode) as unknown as NodeComponent,
    icon: CONSTRAINT_ICON_NAMES.composite,
    category: 'logic',
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
