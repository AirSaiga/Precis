/**
 * @file useConstraintConnection.ts
 * @description 通用约束连接处理器
 *
 * 合并 7 种通用约束（notNull/unique/allowedValues/range/scripted/charset/dateLogic）
 * 的连接处理逻辑，消除 ~80% 的重复代码。
 *
 * 保持独立的约束：
 * - Conditional：双 handle（IF/THEN），逻辑复杂
 * - ForeignKey：有 Schema→Schema shortcut 连接，双向引用
 *
 * 架构设计：
 * - 通过 ConstraintConnectionConfig 参数化差异行为
 * - 统一处理：查找节点 → 校验类型 → 解析 columnId → 查找列 → 写回 sourceRef → 触发校验
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { dispatchValidation } from '@/services/constraints/orchestration/globalValidation'
import type { SchemaNodeData } from '@/types/graph'

export interface ConstraintConnectionConfig {
  /** 约束类型标识，用于 dispatchValidation 和 addConstraintToColumn */
  kind: string
  /** 目标节点类型，如 'notNullConstraint' */
  nodeType: string
  /** 是否调用 dispatchValidation 触发后端校验 */
  dispatchValidation: boolean
  /** 是否调用 addConstraintToColumn 在 Schema 列上标记约束 */
  addConstraintToColumn: boolean
  /** 连接建立时是否重置校验状态（validationStatus/validationErrors/lastValidation） */
  resetOnConnect: boolean
}

export function useConstraintConnection() {
  const store = useGraphStore()

  const isSchemaType = (type: string | undefined): boolean =>
    type === 'schema' || type === 'jsonSchema'

  /**
   * 处理 Schema(列) → 通用约束节点的连接
   *
   * @param sourceNodeId - 源 Schema 节点 ID
   * @param targetNodeId - 目标约束节点 ID
   * @param sourceHandle - 源 handle（列端口），格式 source-right-{columnId}
   * @param targetHandle - 目标 handle（预期为 target-input-{id}）
   * @param config - 约束类型配置
   */
  const handleSchemaToConstraint = async (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle: string,
    targetHandle: string | null | undefined,
    config: ConstraintConnectionConfig
  ): Promise<void> => {
    const sourceNode = store.nodes.find((n: any) => n.id === sourceNodeId)
    const targetNode = store.nodes.find((n: any) => n.id === targetNodeId)
    if (!sourceNode || !targetNode) return

    if (!isSchemaType(sourceNode.type) || targetNode.type !== config.nodeType) {
      return
    }

    const columnId = sourceHandle.startsWith('source-right-')
      ? sourceHandle.replace('source-right-', '')
      : sourceHandle

    const schemaData = sourceNode.data as SchemaNodeData
    const column = schemaData.columns.find((c: any) => c.id === columnId)
    if (!column) {
      logger.warn('❌ 未找到连接的列:', columnId)
      return
    }

    logger.debug(`🔗 Schema列连接到${config.kind}约束:`, {
      sourceNodeId,
      columnId,
      columnName: column.columnName,
    })

    const updateData: Record<string, unknown> = {
      sourceRef: { nodeId: sourceNodeId, columnId },
      table: schemaData.tableName,
      column: column.columnName,
      saveState: 'draft',
    }

    if (config.resetOnConnect) {
      updateData.validationStatus = 'idle'
      updateData.validationErrors = []
      updateData.lastValidation = undefined
    }

    store.updateNodeData(targetNodeId, {
      ...targetNode.data,
      ...updateData,
    })

    if (config.addConstraintToColumn) {
      store.addConstraintToColumn(sourceNodeId, columnId, config.kind as 'notNull' | 'unique')
    }

    if (config.dispatchValidation) {
      dispatchValidation(
        config.kind,
        sourceNodeId,
        columnId,
        store.nodes,
        store.edges,
        store.updateNodeData
      )
    }
  }

  return { handleSchemaToConstraint }
}
