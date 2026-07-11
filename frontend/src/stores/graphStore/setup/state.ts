/**
 * GraphStore 状态声明模块
 *
 * 定义核心响应式状态（nodes/edges/selectedNodeId）和 updateNodeData 唯一修改入口。
 */
import { ref, nextTick } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, TableAsset } from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '../../../api/projectValidationApi'
import {
  updateNodeData as updateVueFlowNodeData,
  updateNode as updateVueFlowNode,
  VueFlowApiNotInitializedError,
} from '@/services/canvas/vueFlowApi'
import { logger } from '@/core/utils/logger'

/**
 * 项目配置统计信息类型
 *
 * 包含 schema、constraint（独立+内嵌）、regex、transform、template 的完整计数，
 * 用于项目根节点徽章、项目信息面板和资源树统计展示。
 */
export interface ProjectConfigStats {
  schemaCount: number
  constraintCount: number
  constraintStandaloneCount: number
  constraintInlineCount: number
  regexCount: number
  transformCount: number
  templateCount: number
}

/** @returns 包含 nodes / edges / assets / selectedNodeId 等响应式状态的对象 */
export function createGraphStoreState() {
  const nodes = ref<CustomNode[]>([])

  const edges = ref<Edge[]>([])

  const assets = ref<TableAsset[]>([])

  const selectedNodeId = ref<string | null>(null)

  const selectedNodeIds = ref<string[]>([])

  const selectionBox = ref<{ x: number; y: number; width: number; height: number } | null>(null)

  const isSelecting = ref(false)

  const copiedNodes = ref<CustomNode[]>([])

  const pasteOffset = { x: 20, y: 20 }

  const designModalVisible = ref(false)

  const activeRegexNodeId = ref<string | null>(null)

  const extractDesignModalVisible = ref(false)

  const activeRegexExtractNodeId = ref<string | null>(null)

  const regexEditSampleData = ref<string>('')

  const isProjectLoaded = ref(false)

  const projectName = ref('')

  const projectConfigStats = ref<ProjectConfigStats>({
    schemaCount: 0,
    constraintCount: 0,
    constraintStandaloneCount: 0,
    constraintInlineCount: 0,
    regexCount: 0,
    transformCount: 0,
    templateCount: 0,
  })

  const projectConfigStatsLoaded = ref(false)

  const projectConfigStatsConfigPath = ref('')

  const lastFullValidationSummary = ref<FullValidationSummary | null>(null)

  const lastFullValidationStatistics = ref<ValidationStatistics | null>(null)

  const setLastFullValidationSummary = (summary: FullValidationSummary | null) => {
    lastFullValidationSummary.value = summary
  }

  const setLastFullValidationStatistics = (statistics: ValidationStatistics | null) => {
    lastFullValidationStatistics.value = statistics
  }

  /**
   * 统一节点数据更新入口
   *
   * 实现策略：
   * 1. 通过 VueFlow API 直接更新内部状态（增量更新，不触发 setNodes/setEdges）
   * 2. nextTick 后同步 store 中的节点 data（不替换数组，避免 v-model 连锁反应）
   *
   * 此策略避免 nodes.value 数组替换导致的 setNodes → createGraphNodes →
   * setEdges → createGraphEdges 连锁链，从而防止边被静默丢弃。
   *
   * 合并语义（重要）：patch 通过 Object.assign 浅合并到 node.data。
   * 传 `{ field: undefined }` 会把字段值写为 undefined，但 key 仍保留——即"清空值"而非"删除字段"。
   * 多处代码依赖这一语义来清空校验结果（如 `lastValidation: undefined`、`validationErrors: []`）。
   * 如需真正删除字段（让 key 不存在），请改用对象整体替换而非增量 patch。
   */
  type NodeLevelPatch = Partial<Pick<CustomNode, 'hidden' | 'position'>>

  function updateNodeData(nodeId: string, newData: Partial<CustomNodeData & NodeLevelPatch>) {
    // 将 patch 拆分为 data 级别与 node 级别属性
    const nodeLevelKeys = new Set<keyof NodeLevelPatch>(['hidden', 'position'])
    const dataPatch: Record<string, unknown> = {}
    const nodePatch: NodeLevelPatch = {}
    for (const [key, value] of Object.entries(newData)) {
      if (nodeLevelKeys.has(key as keyof NodeLevelPatch)) {
        ;(nodePatch as Record<string, unknown>)[key] = value
      } else {
        dataPatch[key] = value
      }
    }

    const hasDataPatch = Object.keys(dataPatch).length > 0
    const hasNodeLevelPatch = Object.keys(nodePatch).length > 0

    // 步骤 1：通过注入层调用 VueFlow 内置 API（增量，安全）
    let vueFlowNotReady = false
    try {
      if (hasDataPatch) {
        updateVueFlowNodeData(nodeId, dataPatch)
      }
      if (hasNodeLevelPatch) {
        updateVueFlowNode(nodeId, nodePatch)
      }
    } catch (error) {
      // VueFlow 尚未初始化（如 store 创建阶段或在 setup 之外调用），回退到直接 store mutation
      if (error instanceof VueFlowApiNotInitializedError) {
        vueFlowNotReady = true
        const node = nodes.value.find((n) => n.id === nodeId)
        if (node) {
          if (hasDataPatch && node.data) {
            Object.assign(node.data, dataPatch)
          }
          if (nodePatch.hidden !== undefined) {
            node.hidden = nodePatch.hidden
          }
          if (nodePatch.position) {
            node.position = { ...nodePatch.position }
          }
        }
      } else {
        // 真正的 VueFlow 更新异常需要向上抛，避免静默丢失状态
        logger.error(`[updateNodeData] VueFlow 更新节点 ${nodeId} 失败:`, error)
        throw error
      }
    }

    // 步骤 2：nextTick 后同步 store 数据（不触发 v-model watcher）
    // 即使 VueFlow 未初始化也要执行同步，保证 store 状态一致
    nextTick(() => {
      const node = nodes.value.find((n) => n.id === nodeId)
      if (!node) {
        if (!vueFlowNotReady) {
          logger.warn(`[updateNodeData] Node ${nodeId} not found in store after VueFlow update`)
        }
        return
      }
      if (hasDataPatch && node.data) {
        Object.assign(node.data, dataPatch)
      }
      if (nodePatch.hidden !== undefined) {
        node.hidden = nodePatch.hidden
      }
      if (nodePatch.position) {
        node.position = { ...nodePatch.position }
      }
    })
  }

  return {
    nodes,
    edges,
    assets,
    selectedNodeId,
    selectedNodeIds,
    selectionBox,
    isSelecting,
    copiedNodes,
    pasteOffset,
    designModalVisible,
    activeRegexNodeId,
    extractDesignModalVisible,
    activeRegexExtractNodeId,
    regexEditSampleData,
    isProjectLoaded,
    projectName,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    setLastFullValidationSummary,
    setLastFullValidationStatistics,
    updateNodeData,
  }
}

export type GraphStoreState = ReturnType<typeof createGraphStoreState>
