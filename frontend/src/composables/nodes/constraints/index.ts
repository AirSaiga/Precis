/**
 * @file index.ts
 * @description 约束节点入口
 * 整合所有约束节点相关的逻辑
 */

// ============================================================
// 约束节点核心逻辑导出
// ============================================================

// 约束基础逻辑（useConstraintBase）
// 提供所有约束类型节点共享的通用逻辑，包括连接管理、验证流程、状态追踪等
export * from './useConstraintBase'

// ============================================================
// 各类型约束节点逻辑导出
// ============================================================
// 每种约束类型都有独立的组合式函数，负责该约束特有的验证逻辑和节点行为

// 非空约束（NotNull）- 检查字段值不能为空
export * from './useNotNull'
// 唯一约束（Unique）- 检查字段值在表中必须唯一
export * from './useUnique'
// 外键约束（ForeignKey）- 检查字段值必须存在于参照表中
export * from './useForeignKey'
// 允许值约束（AllowedValues）- 检查字段值必须在指定列表内
export * from './useAllowedValues'
// 条件约束（Conditional）- 根据条件表达式验证数据
export * from './useConditional'
// 脚本约束（Scripted）- 使用自定义脚本进行验证
export * from './useScripted'
// 范围约束（Range）- 检查数值是否在指定范围内
export * from './useRange'
// 字符集约束（Charset）- 检查字段字符集合规性
export * from './useCharset'
// 日期逻辑约束（DateLogic）- 检查日期字段的逻辑关系
export * from './useDateLogic'

// ============================================================
// 约束节点连接处理器导出
// ============================================================
// 通用约束连接处理器（合并 7 种通用约束）
// Conditional 和 ForeignKey 保持独立

export * from './useConstraintConnection'
// 条件约束连接处理器（双 handle：IF/THEN，逻辑特殊）
export * from './useConditionalConnection'
// 外键约束连接处理器（Schema→Schema shortcut，双向引用）
export * from './useForeignKeyConnection'
