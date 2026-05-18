/**
 * @file useSubGraphStore.ts
 * @description 子画布（SubCanvas）局部状态管理
 *
 * 完全隔离于主 graphStore，用于管理 CompositeConstraint 节点内部的子图。
 */

import { ref, type Ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'

export interface SubGraphState {
  nodes: Ref<Node[]>
  edges: Ref<Edge[]>
}

export function useSubGraphStore(initialNodes: Node[] = [], initialEdges: Edge[] = []) {
  const nodes = ref<Node[]>(JSON.parse(JSON.stringify(initialNodes)))
  const edges = ref<Edge[]>(JSON.parse(JSON.stringify(initialEdges)))

  function addNode(node: Node) {
    nodes.value.push(node)
  }

  function removeNode(nodeId: string) {
    nodes.value = nodes.value.filter((n) => n.id !== nodeId)
    edges.value = edges.value.filter((e) => e.source !== nodeId && e.target !== nodeId)
  }

  function updateNodeData(nodeId: string, data: Record<string, unknown>) {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node) {
      node.data = { ...node.data, ...data }
    }
  }

  function addEdge(edge: Edge) {
    edges.value.push(edge)
  }

  function removeEdge(edgeId: string) {
    edges.value = edges.value.filter((e) => e.id !== edgeId)
  }

  function getState() {
    return {
      nodes: JSON.parse(JSON.stringify(nodes.value)),
      edges: JSON.parse(JSON.stringify(edges.value)),
    }
  }

  function createInputNode(schemaId: string, schemaName: string): Node {
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
