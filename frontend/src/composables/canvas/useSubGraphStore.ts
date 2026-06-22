/**
 * @file useSubGraphStore.ts
 * @description 子画布（SubCanvas）局部状态管理
 *
 * 完全隔离于主 graphStore，用于管理 CompositeConstraint 节点内部的子图。
 */

import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import type { CustomNode } from '@/types/graph'

export interface SubGraphEdgeApi {
  addEdges: (edges: Edge | Edge[]) => void
  removeEdges: (ids: string | string[]) => void
}

/** 允许传入 addNode/createInputNode 的宽松节点输入结构 */
interface SubGraphNodeInput {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface SubGraphState {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
}

export function useSubGraphStore(
  initialNodes: CustomNode[] = [],
  initialEdges: Edge[] = [],
  edgeApi?: SubGraphEdgeApi
) {
  const nodes = ref<CustomNode[]>(structuredClone(initialNodes) as CustomNode[])
  const edges = ref<Edge[]>(structuredClone(initialEdges))

  function addNode(node: SubGraphNodeInput) {
    // useSubGraphStore 的 nodes 是局部状态，不走 Vue Flow 管线，此处赋值替换仅为代码规范统一
    nodes.value = [...nodes.value, node as unknown as CustomNode]
  }

  function removeNode(nodeId: string) {
    nodes.value = nodes.value.filter((n) => n.id !== nodeId)
    const relatedEdgeIds = edges.value
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .map((e) => e.id)
    if (relatedEdgeIds.length > 0) {
      if (edgeApi) {
        edgeApi.removeEdges(relatedEdgeIds)
      } else {
        edges.value = edges.value.filter((e) => e.source !== nodeId && e.target !== nodeId)
      }
    }
  }

  function updateNodeData(nodeId: string, data: Record<string, unknown>) {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node) {
      node.data = {
        ...(node.data as unknown as Record<string, unknown>),
        ...data,
      } as unknown as CustomNode['data']
    }
  }

  function addEdge(edge: Edge) {
    if (edgeApi) {
      edgeApi.addEdges(edge)
    } else {
      // useSubGraphStore 的 edges 是局部状态，不走 Vue Flow 管线，此处赋值替换仅为代码规范统一
      edges.value = [...edges.value, edge]
    }
  }

  function removeEdge(edgeId: string) {
    if (edgeApi) {
      edgeApi.removeEdges(edgeId)
    } else {
      edges.value = edges.value.filter((e) => e.id !== edgeId)
    }
  }

  function getState() {
    return {
      nodes: structuredClone(nodes.value) as CustomNode[],
      edges: structuredClone(edges.value),
    }
  }

  function createInputNode(schemaId: string, schemaName: string): SubGraphNodeInput {
    return {
      id: `sub-input-${uuidv4()}`,
      type: 'subSchemaInput',
      position: { x: 50, y: 100 },
      data: {
        configName: schemaName || 'Input',
        schemaId,
      },
    }
  }

  return {
    nodes,
    edges,
    addNode,
    removeNode,
    updateNodeData,
    addEdge,
    removeEdge,
    getState,
    createInputNode,
  }
}
