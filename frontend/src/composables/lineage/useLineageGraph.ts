import { computed, ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { Edge } from '@vue-flow/core'
import type {
  LineageNode,
  LineageEdge,
  LineageGraph,
  LineageNodeType,
  LineageEdgeKind,
  LineageLayoutNode,
  LineageLayoutResult,
} from '@/types/lineage'

const NODE_LAYER_MAP: Record<LineageNodeType, number> = {
  sourcePreview: 0,
  manualData: 0,
  schema: 1,
  transform: 2,
  transformOutput: 2,
  constraint: 3,
  regex: 3,
}

export function getNodeLabel(data: CustomNodeData): string {
  if ('configName' in data && data.configName) return data.configName as string
  if ('tableName' in data && data.tableName) return data.tableName as string
  if ('name' in data && data.name) return data.name as string
  if ('constraintType' in data && data.constraintType) return data.constraintType as string
  return 'unknown'
}

/** 节点类型到血缘类型的映射表 */
const LINEAGE_TYPE_MAP: Record<string, LineageNodeType> = {
  sourcePreview: 'sourcePreview',
  jsonSourcePreview: 'sourcePreview',
  schema: 'schema',
  jsonSchema: 'schema',
  transform: 'transform',
  transformOutput: 'transformOutput',
  manualData: 'manualData',
  regex: 'regex',
  notNullConstraint: 'constraint',
  uniqueConstraint: 'constraint',
  foreignKeyConstraint: 'constraint',
  allowedValuesConstraint: 'constraint',
  rangeConstraint: 'constraint',
  conditionalConstraint: 'constraint',
  scriptedConstraint: 'constraint',
  charsetConstraint: 'constraint',
  dateLogicConstraint: 'constraint',
  compositeConstraint: 'constraint',
}

/** 根据节点类型字符串获取血缘类型（供外部组件复用） */
export function getNodeType(type: string): LineageNodeType | null {
  return LINEAGE_TYPE_MAP[type] || null
}

function getEdgeKind(edge: Edge): LineageEdgeKind {
  if (edge.data?.kind === 'fkDisplay') return 'fk'
  const sourceNode = edge.source
  if (edge.sourceHandle?.startsWith('source-right-')) return 'constraint'
  return 'data'
}

export function useLineageGraph(
  nodes: Ref<CustomNode[]>,
  edges: Ref<Edge[]>
) {
  const lineageGraph = computed<LineageGraph>(() => {
    const lineageNodes: LineageNode[] = []
    const lineageEdges: LineageEdge[] = []
    const nodeMap = new Map<string, CustomNode>()

    for (const node of nodes.value) {
      nodeMap.set(node.id, node)
      const nodeType = getNodeType(node.type)
      if (!nodeType) continue

      const lineageNode: LineageNode = {
        id: node.id,
        type: nodeType,
        name: getNodeLabel(node.data as CustomNodeData),
      }

      if (nodeType === 'constraint' && 'constraintType' in node.data) {
        lineageNode.constraintType = node.data.constraintType as string
      }
      if ('validationStatus' in node.data) {
        lineageNode.status = node.data.validationStatus as string
      }

      lineageNodes.push(lineageNode)
    }

    const lineageNodeIds = new Set(lineageNodes.map((n) => n.id))

    for (const edge of edges.value) {
      if (edge.data?.transient) continue
      if (!lineageNodeIds.has(edge.source) || !lineageNodeIds.has(edge.target)) continue

      const kind = getEdgeKind(edge)
      const columnId = edge.sourceHandle?.replace('source-right-', '') || undefined

      lineageEdges.push({
        from: edge.source,
        to: edge.target,
        kind,
        columnId: kind === 'constraint' ? columnId : undefined,
      })
    }

    return { nodes: lineageNodes, edges: lineageEdges }
  })

  const layoutGraph = (direction: 'horizontal' | 'vertical' = 'horizontal'): LineageLayoutResult => {
    const graph = lineageGraph.value
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>()
    for (const node of graph.nodes) {
      inDegree.set(node.id, 0)
      adjList.set(node.id, [])
    }
    for (const edge of graph.edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1)
      adjList.get(edge.from)?.push(edge.to)
    }

    const layers: string[][] = []
    const visited = new Set<string>()
    const queue = graph.nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id)

    while (queue.length > 0) {
      const layerSize = queue.length
      const currentLayer: string[] = []
      for (let i = 0; i < layerSize; i++) {
        const nodeId = queue.shift()!
        if (visited.has(nodeId)) continue
        visited.add(nodeId)
        currentLayer.push(nodeId)
        for (const neighbor of adjList.get(nodeId) || []) {
          inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1)
          if ((inDegree.get(neighbor) || 0) <= 0 && !visited.has(neighbor)) {
            queue.push(neighbor)
          }
        }
      }
      if (currentLayer.length > 0) layers.push(currentLayer)
    }

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        layers.push([node.id])
        visited.add(node.id)
      }
    }

    const NODE_W = 160
    const NODE_H = 48
    const LAYER_GAP = direction === 'horizontal' ? 200 : 120
    const NODE_GAP = direction === 'horizontal' ? 20 : 16

    const layoutNodes: LineageLayoutNode[] = []
    let maxLayerSize = 0

    for (let li = 0; li < layers.length; li++) {
      maxLayerSize = Math.max(maxLayerSize, layers[li].length)
    }

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li]
      const layerSize = layer.length
      const totalHeight = layerSize * NODE_H + (layerSize - 1) * NODE_GAP
      const startY = -totalHeight / 2

      for (let ni = 0; ni < layer.length; ni++) {
        const nodeId = layer[ni]
        const node = nodeMap.get(nodeId)
        if (!node) continue

        const x = direction === 'horizontal' ? li * LAYER_GAP : ni * (NODE_W + NODE_GAP)
        const y = direction === 'horizontal' ? startY + ni * (NODE_H + NODE_GAP) : li * LAYER_GAP

        layoutNodes.push({
          ...node,
          x,
          y,
          layer: li,
        })
      }
    }

    const width = direction === 'horizontal' ? layers.length * LAYER_GAP : maxLayerSize * (NODE_W + NODE_GAP)
    const height = direction === 'horizontal' ? maxLayerSize * (NODE_H + NODE_GAP) : layers.length * LAYER_GAP

    return { nodes: layoutNodes, edges: graph.edges, width, height }
  }

  const selectedNode = ref<string | undefined>()

  const selectNode = (nodeId: string | undefined) => {
    selectedNode.value = nodeId
  }

  const upstreamNodes = computed(() => {
    if (!selectedNode.value) return []
    const visited = new Set<string>()
    const result: LineageNode[] = []
    const graph = lineageGraph.value
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)
      for (const edge of graph.edges) {
        if (edge.to === nodeId) {
          const node = nodeMap.get(edge.from)
          if (node) result.push(node)
          dfs(edge.from)
        }
      }
    }
    dfs(selectedNode.value)
    return result
  })

  const downstreamNodes = computed(() => {
    if (!selectedNode.value) return []
    const visited = new Set<string>()
    const result: LineageNode[] = []
    const graph = lineageGraph.value
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)
      for (const edge of graph.edges) {
        if (edge.from === nodeId) {
          const node = nodeMap.get(edge.to)
          if (node) result.push(node)
          dfs(edge.to)
        }
      }
    }
    dfs(selectedNode.value)
    return result
  })

  return {
    lineageGraph,
    layoutGraph,
    selectedNode,
    selectNode,
    upstreamNodes,
    downstreamNodes,
  }
}
