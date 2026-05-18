/**
 * @file validationRegistry.ts
 * @description 约束验证注册表 - 统一导出入口
 *
 * 本文件为向后兼容的 barrel 导出，实际实现已拆分为：
 * - validationRegistryCore.ts: 核心注册表逻辑、类型、辅助函数
 * - validationRegistryHandlers.ts: 各约束类型的验证处理器注册
 */

// 重新导出核心模块的所有符号
export * from './validationRegistryCore'

// side-effect import：触发约束处理器的自注册
import './validationRegistryHandlers'
