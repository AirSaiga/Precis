/**
 * @file handlerRegistry.ts
 * @description 约束校验 handler 注册表
 *
 * 本模块是约束校验的调度枢纽：管理每种约束类型对应的验证处理器，
 * 提供 register（注册）和 getHandlerByNodeType/getHandlerByKind（查询）接口。
 *
 * 10 个 handler 文件（validationRegistryHandlers/*Handler.ts）在模块加载时
 * 调用 register() 完成自注册。
 */

import type { ConstraintKind, ConstraintValidationHandler } from './types'
import { getConstraintKindByNodeType } from './constraintMeta'

// handler 注册表：kind → handler
export const handlers = new Map<ConstraintKind, ConstraintValidationHandler>()

/**
 * 注册约束验证处理器
 *
 * 每种约束类型在加载时调用此函数注册自己的 handler。
 * handler 包含 kind（类型标识）、validate（验证函数）、resetOnDisconnect（断连重置）。
 */
export function register(handler: ConstraintValidationHandler) {
  handlers.set(handler.kind, handler)
}

/** 按节点类型获取 handler（内部使用，被校验执行器调用） */
export function getHandlerByNodeType(type: string | undefined): ConstraintValidationHandler | null {
  const kind = getConstraintKindByNodeType(type)
  if (!kind) return null
  return handlers.get(kind) || null
}

/** 按 Kind 获取 handler（内部使用，被校验执行器调用） */
export function getHandlerByKind(kind: ConstraintKind): ConstraintValidationHandler | null {
  return handlers.get(kind) || null
}
