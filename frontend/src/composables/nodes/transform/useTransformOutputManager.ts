/**
 * @fileoverview Transform 输出节点管理 Composable
 *
 * 职责：
 * - 创建/清理 transformOutput 子节点
 * - 管理连接边（transform-output → target-left）
 * - 等待节点挂载后刷新 internals
 */

import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'

export function useTransformOutputManager() {
  const { updateNodeInternals } = useVueFlow()
  const graphStore = useGraphStore()

  /**
   * Vue Flow 对新节点 handle 的注册晚于普通 nextTick。
   * 额外等待两个宏任务，再刷新 internals，降低"边已创建但端点未就绪"的概率。
   */
  async function waitForNodeMount(nodeIds: string[]) {
    await nextTick()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    await nextTick()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    updateNodeInternals(nodeIds)
    await nextTick()
  }

  /**
   * 批量创建输出节点并自动连线
   *
   * @param transformNodeId - 父 Transform 节点 ID
   * @param oldOutputIds - 需要清理的旧输出节点 ID
   * @param columnNames - 输出列名列表
   * @param rowsByColumn - 每列对应的行数据，rowsByColumn[i] 为第 i 列的 string[][]
   * @param basePosition - 节点定位基准（父节点 position）
   */
  async function createOutputNodes(
    transformNodeId: string,
    oldOutputIds: string[],
    columnNames: string[],
    rowsByColumn: string[][][],
    basePosition: { x: number; y: number },
    columnDataType?: string
  ): Promise<string[]> {
    // 清理旧输出节点
    oldOutputIds.forEach((oid) => {
      if (graphStore.nodes.find((n) => n.id === oid)) {
        graphStore.deleteNode(oid)
      }
    })

    const outputNodeIds: string[] = []
    const baseX = (basePosition?.x || 0) + 400
    const baseY = basePosition?.y || 0

    for (let i = 0; i < columnNames.length; i++) {
      const colName = columnNames[i] ?? ''
      const colRows = rowsByColumn[i] ?? []
      const pos = { x: baseX, y: baseY + i * 140 }
      const newId = graphStore.createTransformOutputNode(
        pos,
        transformNodeId,
        colName,
        colRows,
        columnDataType
      )
      outputNodeIds.push(newId)

      await waitForNodeMount([transformNodeId, newId])

      // 检查是否已有连线，避免重复
      const existingEdge = graphStore.edges.find(
        (edge) =>
          edge.source === transformNodeId &&
          edge.target === newId &&
          edge.sourceHandle === 'transform-output' &&
          edge.targetHandle === 'target-left'
      )

      if (!existingEdge) {
        graphStore.createConnection(transformNodeId, newId, 'transform-output', 'target-left', {
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'var(--edge-data-flow)', strokeWidth: 2 },
          data: { status: 'active', generatedByTransform: true },
        })
        await waitForNodeMount([transformNodeId, newId])
      }
    }

    // 更新父节点的 outputColumns 和 outputNodeIds
    graphStore.updateNodeData(transformNodeId, {
      outputColumns: columnNames,
      outputNodeIds,
    })
    await waitForNodeMount([transformNodeId, ...outputNodeIds])

    return outputNodeIds
  }

  return {
    waitForNodeMount,
    createOutputNodes,
  }
}
