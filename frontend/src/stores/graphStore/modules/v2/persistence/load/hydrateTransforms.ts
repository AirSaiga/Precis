/**
 * @file hydrateTransforms.ts
 * @description V2 Transform 节点水合模块
 *
 * 将后端 V2 项目配置中的 transform 节点定义反序列化为画布上的 Transform 节点。
 *
 * 功能概述：
 * - hydrateTransformNodesFromV2Config: 主入口，遍历 manifest.transforms
 * - 解析转换类型和参数
 * - 建立 Transform 节点到上游节点的 input_from_node 关联
 * - 自动布局：按网格排列（3列，间距 420x240）
 *
 * 架构设计：
 * - 纯函数设计，接收 config + existingNodes 作为参数
 * - 通过 existingNodes 查找源节点以建立边
 * - 返回 { nodes, edges } 供上层合并
 */

import type { Edge } from '@vue-flow/core'
import type { CustomNode, TransformNodeData } from '@/types/graph'
import type { FullConfigV2Response, TransformFileV2 } from '@/types/projectV2'

export function hydrateTransformNodesFromV2Config(params: {
  config: FullConfigV2Response
  existingNodes: CustomNode[]
}) {
  const { config, existingNodes } = params

  const nextNodes: CustomNode[] = []
  const nextEdges: Edge[] = []

  const transformRefs = config.manifest.transforms || []
  transformRefs.forEach((ref, idx) => {
    const tData = config.transforms[ref.id] as TransformFileV2 | undefined
    if (!tData) return

    const nodeId = ref.id
    const pos = { x: 980 + (idx % 3) * 420, y: 80 + Math.floor(idx / 3) * 240 }

    const inputFromNode = tData.input_from_node || undefined
    const inputColumn = tData.input_column || undefined

    nextNodes.push({
      id: nodeId,
      type: 'transform',
      position: pos,
      data: {
        configName: tData.name || tData.id || 'Transform',
        transformType: tData.type || 'StringSplit',
        description: tData.description || '',
        inputFromNode,
        inputColumn,
        params: tData.params || {},
        outputColumns: tData.output_columns || [],
        enabled: tData.enabled !== false,
        saveState: 'saved',
      } as TransformNodeData,
    })

    // 如果配置了 input_from_node，尝试建立数据流边
    if (inputFromNode) {
      const sourceNode = existingNodes.find((n) => n.id === inputFromNode)
      if (sourceNode) {
        const sourceHandle =
          sourceNode.type === 'transform'
            ? 'transform-output'
            : sourceNode.type === 'regex'
              ? 'regex-output'
              : undefined
        nextEdges.push({
          id: `e-${inputFromNode}-${nodeId}`,
          source: inputFromNode,
          target: nodeId,
          sourceHandle,
          targetHandle: 'transform-input',
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'var(--edge-data-flow)', strokeWidth: 2 },
        } as Edge)
      }
    }
  })

  return { nodes: nextNodes, edges: nextEdges }
}
