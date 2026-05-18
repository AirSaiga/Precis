/**
 * @file constraintNodeRegistry.ts
 * @description 约束节点注册中心
 */
import { markRaw } from 'vue'
import type { NodeComponent } from '@vue-flow/core'
import type { ConstraintKind } from '@/services/constraints/types'

/**
 * 约束节点类型定义
 */
export type ConstraintNodeType = ConstraintKind

/**
 * 约束节点注册项
 */
export interface ConstraintNodeRegistration {
  component: NodeComponent
  displayName: string
  icon: string
  category: 'attribute' | 'relation' | 'logic'
  description: string
}

/**
 * 约束节点注册表
 */
export const constraintNodeRegistry: Record<ConstraintNodeType, ConstraintNodeRegistration> =
  {} as Record<ConstraintNodeType, ConstraintNodeRegistration>

/**
 * 注册约束节点
 * @param type 约束节点类型
 * @param registration 约束节点注册信息
 */
export function registerConstraintNode(
  type: ConstraintNodeType,
  registration: ConstraintNodeRegistration
) {
  constraintNodeRegistry[type] = registration
}

/**
 * 获取约束节点组件
 * @param type 约束节点类型
 * @returns 约束节点组件或undefined
 */
export function getConstraintNodeComponent(type: ConstraintNodeType): NodeComponent | undefined {
  return constraintNodeRegistry[type]?.component
}

/**
 * 获取所有注册的约束节点类型
 * @returns 约束节点类型数组
 */
export function getAllConstraintNodeTypes(): ConstraintNodeType[] {
  return Object.keys(constraintNodeRegistry) as ConstraintNodeType[]
}

/**
 * 获取指定分类的约束节点类型
 * @param category 约束节点分类
 * @returns 指定分类的约束节点类型数组
 */
export function getConstraintNodeTypesByCategory(
  category: 'attribute' | 'relation' | 'logic'
): ConstraintNodeType[] {
  return Object.entries(constraintNodeRegistry)
    .filter(([, registration]) => registration.category === category)
    .map(([type]) => type as ConstraintNodeType)
}
