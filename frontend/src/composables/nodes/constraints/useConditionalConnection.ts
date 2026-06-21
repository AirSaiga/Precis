/**
 * @file useConditionalConnection.ts
 * @description 条件约束连接处理
 *
 * 处理 Schema(列) → ConditionalConstraint 节点的连接逻辑：
 * - 通过 targetHandle 区分 IF 列端口与 THEN 列端口
 * - 解析列端口 sourceHandle，提取 columnId
 * - 写回 conditional 节点的稳定引用 ifRef/thenRef（nodeId + columnId）
 * - 同步写回 table/ifColumn/thenColumn 仅用于 UI 展示与导出兼容
 * - 连接变更后清空旧校验结果，避免脏状态
 */
import { useGraphStore } from '@/stores/graphStore'
import type { SchemaNodeData } from '@/types/graph'
import type { TransformOutputNodeData, CustomNode } from '@/types/nodes'
import type { ConditionalConstraintNodeData } from '@/types/constraints'

export function useConditionalConnection() {
  const store = useGraphStore()

  // 辅助函数：判断是否为可连接的源节点类型（Schema / TransformOutput / ManualData）
  const isValidSourceType = (type: string | undefined): boolean =>
    type === 'schema' ||
    type === 'jsonSchema' ||
    type === 'transformOutput' ||
    type === 'manualData'

  const handleSchemaToConditionalConnection = async (
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandleId: string,
    targetHandleId?: string | null,
    edgeId?: string
  ): Promise<void> => {
    const sourceNode = store.nodes.find((n: CustomNode) => n.id === sourceNodeId)
    const targetNode = store.nodes.find((n: CustomNode) => n.id === targetNodeId)
    if (!sourceNode || !targetNode) return

    if (!isValidSourceType(sourceNode?.type) || targetNode?.type !== 'conditionalConstraint') return
    if (!targetHandleId) return

    const isIfHandle =
      targetHandleId === `target-if-${targetNodeId}` ||
      targetHandleId.startsWith(`target-if-${targetNodeId}:`)
    const isThenHandle =
      targetHandleId.includes('target-then-') || targetHandleId.includes('target-input-')
    if (!isIfHandle && !isThenHandle) return

    const columnId = sourceHandleId.startsWith('source-right-')
      ? sourceHandleId.replace('source-right-', '')
      : sourceHandleId

    // 区分 Schema 节点与纯数据节点（TransformOutput / ManualData）的数据结构
    const isPureDataSource =
      sourceNode.type === 'transformOutput' || sourceNode.type === 'manualData'
    let columnName: string
    let tableName: string

    if (isPureDataSource) {
      const sourceData = sourceNode.data as TransformOutputNodeData
      columnName = sourceData.columnName || columnId
      tableName = sourceData.configName || columnName
    } else {
      const sourceData = sourceNode.data as SchemaNodeData
      const column = sourceData.columns.find((c) => c.id === columnId)
      if (!column) return
      columnName = column.columnName
      tableName = sourceData.tableName
    }

    const current = targetNode.data as ConditionalConstraintNodeData

    const nextData: Partial<ConditionalConstraintNodeData> = {
      table: tableName,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    }

    if (isIfHandle) {
      // 纯数据源（TransformOutput / ManualData）场景下 IF/THEN 可来自不同节点
      if (!isPureDataSource) {
        const existingNodeId =
          current.thenRef?.nodeId ||
          current.ifConditions?.find((c) => c.ref?.nodeId)?.ref?.nodeId ||
          current.ifRef?.nodeId

        if (existingNodeId && existingNodeId !== sourceNodeId) {
          if (edgeId) store.deleteConnection(edgeId)
          return
        }
      }

      const baseConditions =
        Array.isArray(current.ifConditions) && current.ifConditions.length > 0
          ? current.ifConditions.slice()
          : [
              {
                operator: 'eq' as const,
                value: current.ifValue || '',
                column: current.ifColumn || '',
                ref: current.ifRef
                  ? { nodeId: current.ifRef.nodeId, columnId: current.ifRef.columnId }
                  : undefined,
              },
            ]

      const duplicate = baseConditions.some(
        (c) => c.ref?.nodeId === sourceNodeId && c.ref?.columnId === columnId
      )
      if (duplicate) {
        if (edgeId) store.deleteConnection(edgeId)
        return
      }

      const fillIndex = baseConditions.findIndex((c) => !c.ref?.columnId)
      const idx = fillIndex >= 0 ? fillIndex : baseConditions.length
      if (fillIndex < 0) {
        baseConditions.push({ operator: 'eq', value: '' })
      }

      const existing = baseConditions[idx]
      baseConditions[idx] = {
        ...existing,
        edgeId,
        ref: { nodeId: sourceNodeId, columnId },
        column: columnName,
        operator: existing?.operator || 'eq',
      }

      nextData.ifLogic = current.ifLogic || 'and'
      nextData.ifConditions = baseConditions

      const first = baseConditions[0]
      nextData.ifRef = first?.ref
      nextData.ifColumn = first?.column || ''
      nextData.ifValue = typeof first?.value === 'string' ? first.value : ''
    }

    if (isThenHandle) {
      // 纯数据源场景下 IF/THEN 可来自不同节点
      if (!isPureDataSource) {
        const existingNodeId =
          current.ifConditions?.find((c) => c.ref?.nodeId)?.ref?.nodeId || current.ifRef?.nodeId
        if (existingNodeId && existingNodeId !== sourceNodeId) {
          if (edgeId) store.deleteConnection(edgeId)
          return
        }
      }

      const thenHandles = new Set([`target-then-${targetNodeId}`, `target-input-${targetNodeId}`])
      const existingThenEdges = store.edges.filter(
        (e) =>
          e.id !== edgeId &&
          e.target === targetNodeId &&
          !!e.targetHandle &&
          thenHandles.has(e.targetHandle)
      )
      existingThenEdges.forEach((e) => store.deleteConnection(e.id))

      nextData.thenRef = { nodeId: sourceNodeId, columnId }
      nextData.thenColumn = columnName
    }

    store.updateNodeData(targetNodeId, {
      ...(targetNode.data as ConditionalConstraintNodeData),
      ...nextData,
    })
  }

  return {
    handleSchemaToConditionalConnection,
  }
}
