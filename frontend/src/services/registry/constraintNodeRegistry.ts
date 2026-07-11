/**
 * @file constraintNodeRegistry.ts
 * @description 约束节点组件注册中心
 *
 * 维护约束节点类型到 Vue 组件的映射注册表，用于画布渲染时根据节点类型
 * 动态加载对应的节点组件。
 *
 * 功能概述：
 * - registerConstraintNode: 注册约束节点类型及其对应的 Vue 组件
 * - getConstraintNodeComponent: 根据类型获取已注册的组件
 * - constraintNodeRegistry: 全局注册表对象
 *
 * 架构设计：
 * - 注册表模式：Partial<Record<ConstraintNodeType, ConstraintNodeRegistration>>
 * - 在应用启动时由各约束节点模块调用 registerConstraintNode 完成注册
 * - 与 core/constraints/types.ts 中的类型定义配合使用
 */

import type { NodeComponent } from '@vue-flow/core'

/**
 * 约束节点类型定义
 * 枚举所有支持的约束节点类型
 */
export type ConstraintNodeType =
  | 'notNull'
  | 'unique'
  | 'foreignKey'
  | 'allowedValues'
  | 'range'
  | 'conditional'
  | 'scripted'
  | 'charset'
  | 'dateLogic'
  | 'composite'

/**
 * 约束节点注册信息
 * 描述一个约束节点类型在画布中应该如何渲染和展示
 *
 * 注意：显示名称（name）与描述（description）不再在此注册——它们统一由 i18n 的
 * `constraintTypes.<kind>.{name,description}` 命名空间提供，避免多处维护中文文案。
 */
export interface ConstraintNodeRegistration {
  /** 对应的 Vue 组件，用于画布渲染该节点 */
  component: NodeComponent
  /** 节点图标标识，用于工具箱和节点头部展示 */
  icon: string
  /** 节点分类：attribute（属性级）、relation（关系级）、logic（逻辑级） */
  category: 'attribute' | 'relation' | 'logic'
}

/**
 * 约束节点注册中心
 * 全局注册表对象，维护约束节点类型到注册信息的映射
 * 应用在启动时由各约束节点模块调用 registerConstraintNode 完成填充
 */
export const constraintNodeRegistry: Partial<
  Record<ConstraintNodeType, ConstraintNodeRegistration>
> = {}

/**
 * 注册约束节点
 * 将指定的约束节点类型及其对应的组件、元数据注册到全局注册表中
 * @param type - 约束节点类型，如 'notNull'、'unique' 等
 * @param registration - 约束节点的注册信息，包含组件、显示名、图标等
 * @returns 无返回值
 */
export function registerConstraintNode(
  type: ConstraintNodeType,
  registration: ConstraintNodeRegistration
) {
  constraintNodeRegistry[type] = registration
}

/**
 * 获取所有已注册的约束节点
 * 返回注册表中所有键值对，用于遍历或展示全部约束类型
 * @returns 由 [类型, 注册信息] 数组组成的列表
 */
export function getAllConstraintNodes() {
  return Object.entries(constraintNodeRegistry)
}

/**
 * 根据类型获取约束节点
 * 通过约束节点类型查找对应的注册信息
 * @param type - 约束节点类型
 * @returns 对应的 ConstraintNodeRegistration，若未注册则返回 undefined
 */
export function getConstraintNode(type: ConstraintNodeType) {
  return constraintNodeRegistry[type]
}

/**
 * 根据分类获取约束节点
 * 筛选出指定分类（属性级/关系级/逻辑级）的所有约束节点
 * @param category - 分类标识：'attribute' | 'relation' | 'logic'
 * @returns 符合条件的 [类型, 注册信息] 数组
 */
export function getConstraintNodesByCategory(category: 'attribute' | 'relation' | 'logic') {
  return Object.entries(constraintNodeRegistry).filter(([_, node]) => node.category === category)
}
