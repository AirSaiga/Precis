/**
 * 模板展开后置钩子注册表核心模块
 *
 * 维护 TemplateExpandHandler 全局注册表，按优先级排序执行。
 * 模仿 services/disconnect/registryCore.ts 的自注册模式。
 */
import type { TemplateExpandDagNode, TemplateExpandContext, TemplateExpandHandler } from './types'
import { logger } from '@/core/utils/logger'

export type { TemplateExpandDagNode, TemplateExpandContext, TemplateExpandHandler } from './types'

const handlers: TemplateExpandHandler[] = []

/** 注册模板展开后置钩子（按优先级自动排序） */
export function registerTemplateExpandHandler(handler: TemplateExpandHandler): void {
  handlers.push(handler)
  handlers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
}

/**
 * 执行所有匹配的模板展开后置钩子
 *
 * 对每个 dagNode，遍历已注册 handler，找到第一个 match 成功的执行 execute。
 * handler 内部异常被 try/catch 隔离，单个失败不影响其他节点的处理。
 *
 * @param dagNodes - 模板展开阶段构建的 DAG 节点列表
 * @param ctx - 画布上下文（nodes/edges/updateNodeData/reconcileAll）
 */
export async function executeTemplateExpandHooks(
  dagNodes: TemplateExpandDagNode[],
  ctx: TemplateExpandContext
): Promise<void> {
  for (const dagNode of dagNodes) {
    for (const handler of handlers) {
      if (!handler.match(dagNode, ctx)) continue
      try {
        await handler.execute(dagNode, ctx)
      } catch (error) {
        // 单个 handler 失败不应阻塞后续处理
        logger.error('[TemplateExpand] handler 执行失败:', error, {
          dagNodeId: dagNode.id,
          kind: dagNode.kind,
        })
      }
      break // 一个 dagNode 只由第一个匹配的 handler 处理
    }
  }
}

/** 测试用：清空注册表（生产代码不应调用） */
export function _resetTemplateExpandHandlers(): void {
  handlers.length = 0
}
