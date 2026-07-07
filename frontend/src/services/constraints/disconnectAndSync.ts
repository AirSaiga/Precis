/**
 * @file disconnectAndSync.ts
 * @description 约束断连重置 + 级联重验 + 目标引用解析
 *
 * 本模块处理约束校验的"副作用管理"：
 * - H: TargetRefResolver 注册表（约束节点对其他 Schema 的引用关系）
 * - I: 断连重置（buildDisconnectReset）、级联重验（revalidateConstraintsReferencingSchema）
 *
 * 依赖方向：→ constraintMeta（类型判断）→ handlerRegistry（handler 查询）
 *          → validationHelpers（defaultReset）→ validationExecutors（全表校验）
 */

import type { Edge, Node } from '@vue-flow/core'

import { logger } from '@/core/utils/logger'

import { getConstraintKindByNodeType, isConstraintNodeType } from './constraintMeta'
import { handlers } from './handlerRegistry'
import { defaultReset } from './validationHelpers'
import { validateConstraintNodesForSchema } from './validationExecutors'

// ============================================================================
// H: 目标引用解析注册表
// ============================================================================

/**
 * 解析约束节点对目标 Schema 的引用
 *
 * 不同约束类型可能引用其他 Schema 作为目标/参照（如 ForeignKey 的目标表）。
 * 当目标 Schema 的数据源就绪时，需要重新验证这些约束。
 *
 * @returns 被引用的目标 Schema 节点 ID 数组；如果没有引用返回空数组
 */
export type TargetRefResolver = (nodeData: Record<string, unknown>) => string[]

/** 约束类型到目标引用解析器的映射（内部状态） */
const targetRefResolvers = new Map<string, TargetRefResolver>()

/**
 * 注册约束类型的目标引用解析器
 *
 * @param nodeType - 约束节点类型（如 'foreignKeyConstraint'）
 * @param resolver - 解析函数，返回该约束引用的目标 Schema ID 列表
 */
export function registerTargetRefResolver(nodeType: string, resolver: TargetRefResolver): void {
  targetRefResolvers.set(nodeType, resolver)
}

/**
 * 获取约束节点引用的所有目标 Schema ID
 */
export function getConstraintTargetRefs(constraintNode: Node): string[] {
  const resolver = targetRefResolvers.get(constraintNode.type || '')
  if (!resolver) return []
  return resolver((constraintNode.data || {}) as Record<string, unknown>)
}

// ============================================================================
// I: 断连重置
// ============================================================================

/**
 * 构建约束节点断连后的重置数据
 *
 * 查找该约束类型的 handler，调用其 resetOnDisconnect；
 * 未注册 handler 时回退到 defaultReset（validationStatus → idle）。
 */
export function buildDisconnectReset(
  nodeType: string | undefined,
  nodeData: Record<string, unknown>
): Record<string, unknown> {
  const kind = getConstraintKindByNodeType(nodeType)
  if (!kind) return defaultReset(nodeData)
  const handler = handlers.get(kind)
  if (!handler) return defaultReset(nodeData)
  return handler.resetOnDisconnect(nodeData)
}

// ============================================================================
// I: 级联重验
// ============================================================================

/**
 * 当 Schema 节点数据源就绪时，触发引用该 Schema 为目标的约束重新验证
 *
 * 设计说明：
 * - 这是通用机制，不针对特定约束类型
 * - 约束类型通过 registerTargetRefResolver 声明自己的目标引用关系
 * - 新增约束类型时只需注册解析器，无需修改此处逻辑
 */
export async function revalidateConstraintsReferencingSchema(params: {
  schemaNodeId: string
  nodes: Node[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  const { schemaNodeId, nodes, edges, updateNodeData } = params

  // 收集所有引用本 Schema 为目标的约束节点
  const referencingConstraints = nodes.filter((n) => {
    if (!isConstraintNodeType(n.type)) return false
    const targetIds = getConstraintTargetRefs(n)
    return targetIds.includes(schemaNodeId)
  })

  if (referencingConstraints.length === 0) return

  // 按源 Schema 分组，避免同一源 Schema 被重复验证
  const sourceSchemaIds = new Set<string>()
  for (const constraintNode of referencingConstraints) {
    // 约束节点的源 Schema 通过 edges 查找（约束边从 Schema 指向约束节点）
    const sourceEdges = edges.filter((e) => e.target === constraintNode.id)
    for (const edge of sourceEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'schema' || sourceNode?.type === 'jsonSchema') {
        sourceSchemaIds.add(sourceNode.id)
      }
    }
  }

  for (const srcSchemaId of sourceSchemaIds) {
    await validateConstraintNodesForSchema({
      schemaNodeId: srcSchemaId,
      nodes,
      edges,
      updateNodeData,
    }).catch((err) => {
      logger.warn(`[revalidateConstraintsReferencingSchema] 源 ${srcSchemaId} 重验失败:`, err)
    })
  }

  logger.debug(
    `[revalidateConstraintsReferencingSchema] 已触发 ${referencingConstraints.length} 个约束的重验（涉及 ${sourceSchemaIds.size} 个源 Schema）`
  )
}
