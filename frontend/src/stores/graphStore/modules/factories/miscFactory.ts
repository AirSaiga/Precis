/**
 * @file miscFactory.ts
 * @description 杂项节点工厂
 *
 * 提供便捷方法来创建各类空节点，作为画布快捷操作的入口。
 *
 * 功能概述：
 * - createEmptyTableNode: 创建空 Schema 节点
 * - createEmptyPatternNode: 创建空 Regex 节点
 * - createLogicNode: 创建外键约束节点（用于逻辑关系）
 * - 所有方法委托给具体的 createSchemaNode / createRegexNode / createConstraintNode
 *
 * 架构设计：
 * - 纯委托模式，封装常用节点创建操作
 * - 接收具体工厂方法作为参数，不直接操作状态
 * - 使用 i18n 提供本地化默认名称
 */

export function createMiscFactoryModule(params: {
  createSchemaNode: (position: { x: number; y: number }, name?: string) => string
  createRegexNode: (position: { x: number; y: number }, pattern?: string, name?: string) => string
  createConstraintNode: (
    position: { x: number; y: number },
    constraintType:
      | 'foreignKey'
      | 'unique'
      | 'notNull'
      | 'allowedValues'
      | 'conditional'
      | 'scripted'
      | 'range'
      | 'charset'
      | 'dateLogic',
    data?: Record<string, unknown>
  ) => string
}) {
  const { createSchemaNode, createRegexNode, createConstraintNode } = params

  function createEmptyTableNode(position: { x: number; y: number }, name?: string) {
    return createSchemaNode(position, name || '新表格')
  }

  function createEmptyPatternNode(position: { x: number; y: number }, name?: string) {
    return createRegexNode(position, '', name || '新模式')
  }

  function createLogicNode(position: { x: number; y: number }, name?: string) {
    return createConstraintNode(position, 'foreignKey', {
      configName: name || '新逻辑约束',
    })
  }

  return {
    createEmptyTableNode,
    createEmptyPatternNode,
    createLogicNode,
  }
}
