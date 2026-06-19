/**
 * @file storeInterfaces.ts
 * @description Store 接口定义，用于解耦 store 间的直接导入依赖
 *
 * 通过接口类型替代直接的 store 实例引用，降低 store 间的耦合度。
 * 各 store 实现对应接口，消费者通过接口类型访问。
 */
import type { Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { Edge } from '@vue-flow/core'
import type { ProjectPaths } from '@/stores/projectStore'
import type { ResourceItem } from '@/types/resource/types'

/**
 * GraphStore 最小公共接口
 *
 * 定义外部 store/composable 需要从 graphStore 获取的核心能力。
 * 新增需求时应优先扩展此接口而非直接导入 useGraphStore。
 */
export interface GraphStoreLike {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  isProjectLoaded: Ref<boolean>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
  deleteConnection: (edgeId: string) => void
}

/**
 * ProjectStore 最小公共接口
 *
 * 定义外部模块需要从 projectStore 获取的核心能力。
 * 注意：Pinia store 会自动解包 Ref，所以属性类型不带 Ref 包装。
 */
export interface ProjectStoreLike {
  currentPaths: ProjectPaths | null
  isProjectActive: boolean
  setProjectPaths: (newPaths: ProjectPaths) => void
  clearProject: () => void
}

/**
 * ResourceTreeStore 最小公共接口
 *
 * 定义外部模块需要从 resourceTreeStore 获取的核心能力。
 * 用于在 graphStore 模块中解耦对 resourceTreeStore 的直接导入。
 */
export interface ResourceTreeStoreLike {
  getResourceById: (id: string) => ResourceItem | undefined
  clear: () => void
}
