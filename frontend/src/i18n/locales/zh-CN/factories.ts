/**
 * @file factories.ts
 * @description 节点工厂中文翻译词条
 *
 * 功能概述：
 * - 提供约束工厂、正则工厂创建节点时的默认名称翻译
 */

const factories = {
  // 约束工厂 - 新建约束默认名称模板
  newConstraint: '新建{type}',
  // 约束类型名称
  foreignKey: '外键约束',
  unique: '唯一约束',
  notNull: '非空约束',
  allowedValues: '允许值约束',
  conditional: '条件约束',
  scripted: '脚本约束',
  range: '区间约束',
  charset: '字符集约束',
  dateLogic: '日期逻辑约束',
  composite: '复合约束',
  unknown: '约束',
  // 正则工厂
  newRegex: '新建正则表达式',
  // 节点工厂默认名称（快捷创建的空节点）
  defaultName: {
    table: '新表格',
    pattern: '新模式',
    logicConstraint: '新逻辑约束',
    schema: '新Schema配置',
    jsonSchema: '新JSON Schema配置',
  },
}

export { factories }
