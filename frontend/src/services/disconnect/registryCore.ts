/**
 * 断开清理注册表核心模块
 *
 * 功能概述:
 * - 维护 DisconnectHandler 全局注册表
 * - 按优先级排序，查找匹配的 handler 执行清理
 *
 * 架构设计:
 * - 自注册模式：handler 文件通过 side-effect import 自动注册
 * - 排序执行：按 priority 升序排列，优先执行高优先级 handler
 */
import type { Node, Edge } from '@vue-flow/core'
import type { DisconnectHandler, DisconnectContext } from './types'

export type { DisconnectHandler, DisconnectContext } from './types'

const handlers: DisconnectHandler[] = []

/** 注册断开清理处理器（自动按优先级排序） */
export function registerDisconnectHandler(handler: DisconnectHandler): void {
  handlers.push(handler)
  handlers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
}

/**
 * 执行断开边清理
 *
 * 遍历所有已注册 handler，找到第一个 match 成功的执行 cleanup。
 * 若 targetNode 不存在则直接返回。
 */
export function executeDisconnectCleanup(
  edge: Edge,
  sourceNode: Node | undefined,
  targetNode: Node | undefined,
  ctx: DisconnectContext
): void {
  if (!targetNode) return
  const handler = handlers.find((h) => h.match(edge, sourceNode, targetNode, ctx))
  if (handler) {
    handler.cleanup(edge, sourceNode, targetNode, ctx)
  }
}
