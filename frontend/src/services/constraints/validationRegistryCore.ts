/**
 * @file validationRegistryCore.ts
 * @description 约束验证注册表 - barrel 聚合入口
 *
 * 本文件已拆分为 5 个职责清晰的子模块，此处仅做 re-export 聚合，
 * 保持 50 个调用方的 import 路径（@/services/constraints/validationRegistryCore
 * 或 @/services/constraints/validationRegistry）完全兼容。
 *
 * 拆分后的模块结构（按 DAG 依赖层级）：
 * - constraintMeta.ts        — 元数据表 + 三向映射查询（Layer 0-1）
 * - handlerRegistry.ts       — handler 注册表（Layer 2，调度枢纽）
 * - validationHelpers.ts     — 公共工具函数（Layer 0）
 * - validationExecutors.ts   — 校验执行入口（Layer 3-5）
 * - disconnectAndSync.ts     — 断连重置 + 级联重验（Layer 4）
 *
 * 已清理的死代码（0 外部引用，未迁入新模块）：
 * - getV2TypeByConstraintKind
 * - getV2ConstraintTypeByKind
 * - executeConstraintValidation
 * - buildValidationContext re-export（外部已直接 import validationContext）
 */

// re-export 全部子模块符号，保持调用方零改动
export * from './constraintMeta'
export * from './handlerRegistry'
export * from './validationHelpers'
export * from './validationExecutors'
export * from './disconnectAndSync'
// buildValidationContext re-export（测试通过 barrel 引用，生产代码直接 import validationContext）
export { buildValidationContext } from './validationContext'
