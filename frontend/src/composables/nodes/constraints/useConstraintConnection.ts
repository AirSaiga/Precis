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
import { validateForInlineSource } from '@/services/constraints/validationRegistryCore'
import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'
import type { SchemaNodeData, JsonSchemaNodeData } from '@/types/graph'

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

  const isPureDataSourceType = (type: string | undefined): boolean =>
    type === 'transformOutput' || type === 'manualData'

  /**
   * 处理数据源 → 通用约束节点的连接
   * 支持 Schema / JsonSchema / TransformOutput / ManualData 作为数据源
   *
   * @param sourceNodeId - 源节点 ID
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

    const isSchema = isSchemaType(sourceNode.type)
    const isPureData = isPureDataSourceType(sourceNode.type)

    if ((!isSchema && !isPureData) || targetNode.type !== config.nodeType) {
      return
    }

    // 根据源节点类型构建列信息
    let columnId: string
    let columnName: string
    let tableName: string

    if (isPureData) {
      // TransformOutput / ManualData：单列数据，columnName 存在节点 data 上
      const sourceData = sourceNode.data as Record<string, unknown>
      columnId = sourceHandle.startsWith('source-right-')
        ? sourceHandle.replace('source-right-', '')
        : sourceHandle || '0'
      columnName = (sourceData.columnName as string) || 'Column1'
      tableName = (sourceData.configName as string) || columnName
    } else {
      // Schema / JsonSchema：从 columns 数组中查找
      columnId = sourceHandle.startsWith('source-right-')
        ? sourceHandle.replace('source-right-', '')
        : sourceHandle
      const schemaData = sourceNode.data as SchemaNodeData | JsonSchemaNodeData
      let column: { columnName: string } | undefined
      if (sourceNode.type === 'jsonSchema') {
        const found = findJsonSchemaColumnById(
          (schemaData as JsonSchemaNodeData).columns,
          columnId
        )
        column = found ? found.column : undefined
      } else {
        column = schemaData.columns.find((c: any) => c.id === columnId)
      }
      if (!column) {
        logger.warn('❌ 未找到连接的列:', columnId)
        return
      }
      columnName = column.columnName
      tableName = schemaData.tableName
    }

    logger.debug(`🔗 数据源列连接到${config.kind}约束:`, {
      sourceNodeId,
      sourceType: sourceNode.type,
      columnId,
      columnName,
    })

    const updateData: Record<string, unknown> = {
      sourceRef: { nodeId: sourceNodeId, columnId },
      table: tableName,
      column: columnName,
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

    // Schema 专属操作：在列上标记约束
    if (isSchema && config.addConstraintToColumn) {
      store.addConstraintToColumn(sourceNodeId, columnId, config.kind as 'notNull' | 'unique')
    }

    // 触发校验
    if (config.dispatchValidation) {
      if (isPureData) {
        // 纯数据节点：使用行内校验（本地执行，无需后端文件路径）
        await validateForInlineSource({
          sourceNodeId,
          constraintNode: targetNode,
          nodes: store.nodes,
          updateNodeData: store.updateNodeData,
        })
      } else {
        // Schema 节点：使用后端 API 校验
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
  }

  return { handleSchemaToConstraint }
}
