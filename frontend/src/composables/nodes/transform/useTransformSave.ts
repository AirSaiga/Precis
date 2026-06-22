/**
 * @fileoverview Transform 保存编排 Composable
 *
 * 职责：
 * - 接收 Inspector 最新写入的节点数据
 * - 调用 computeTransformResult 统一分发计算
 * - 调用 useTransformOutputManager 创建/更新输出节点
 *
 * 这是 TransformNode.vue 中 handleSave + 所有 generate*Output 函数的统一替代。
 */

import type {
  CustomNode,
  TransformNodeData,
  ManualDataNodeData,
  TransformOutputNodeData,
} from '@/types/nodes'
import { useGraphStore } from '@/stores/graphStore'
import { useTransformOutputManager } from './useTransformOutputManager'
import { computeTransformResult } from './transformCalculations'

/** 从上游节点获取数据行 */
function getUpstreamRows(upstreamNode: CustomNode): string[][] {
  if (upstreamNode?.type === 'manualData') {
    return (upstreamNode.data as ManualDataNodeData).rows
  }
  if (upstreamNode?.type === 'transformOutput') {
    return (upstreamNode.data as TransformOutputNodeData).rows
  }
  return []
}

/** 从上游节点获取列数据类型 */
function getUpstreamColumnDataType(upstreamNode: CustomNode): string | undefined {
  if (upstreamNode?.type === 'manualData') {
    return (upstreamNode.data as ManualDataNodeData).columnDataType
  }
  if (upstreamNode?.type === 'transformOutput') {
    return (upstreamNode.data as TransformOutputNodeData).columnDataType
  }
  return undefined
}

export function useTransformSave() {
  const graphStore = useGraphStore()
  const { createOutputNodes } = useTransformOutputManager()

  /**
   * 执行 Transform 保存：计算输出并生成子节点
   *
   * @param nodeId - Transform 节点 ID
   */
  async function handleSave(nodeId: string): Promise<void> {
    let storeNode = graphStore.nodes.find((n) => n.id === nodeId)
    if (!storeNode) return

    // 1. 保存自身状态
    graphStore.updateNodeData(nodeId, {
      ...storeNode.data,
      saveState: 'saved',
      lastSaved: new Date().toISOString(),
    })

    // updateNodeData 使用不可变更新，必须重新获取引用
    storeNode = graphStore.nodes.find((n) => n.id === nodeId)
    if (!storeNode) return

    // 2. 自动生成输出节点
    const transformData = storeNode.data as TransformNodeData
    if (!transformData.inputFromNode) return

    const upstreamNode = graphStore.nodes.find((n) => n.id === transformData.inputFromNode)
    if (!upstreamNode) return
    const upstreamType = upstreamNode.type
    if (upstreamType !== 'manualData' && upstreamType !== 'transformOutput') return

    const upstreamRows = getUpstreamRows(upstreamNode)
    const upstreamColumnDataType = getUpstreamColumnDataType(upstreamNode)
    const oldOutputIds = transformData.outputNodeIds || []
    const basePosition = storeNode.position || { x: 0, y: 0 }

    const type = transformData.transformType
    const params = (transformData.params || {}) as Record<string, unknown>

    // 统一分发计算（22 种 transformType 的单一入口）
    const { columns, rowsByColumn, outputDataType } = computeTransformResult(
      type,
      upstreamRows,
      params,
      {
        inputColumn: transformData.inputColumn,
        outputColumns: transformData.outputColumns,
      }
    )

    // MathExpr 特殊处理：outputType 未指定时回退到上游列数据类型
    const finalOutputDataType =
      type === 'MathExpr' && !outputDataType ? upstreamColumnDataType : outputDataType

    await createOutputNodes(
      nodeId,
      oldOutputIds,
      columns,
      rowsByColumn,
      basePosition,
      finalOutputDataType
    )
  }

  return { handleSave }
}
