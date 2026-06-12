/**
 * GraphStore 状态声明模块
 *
 * 定义核心响应式状态（nodes/edges/selectedNodeId）和 updateNodeData 唯一修改入口。
 */
import { ref, nextTick } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, TableAsset } from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '../../../api/projectValidationApi'
import { updateNodeData as updateVueFlowNodeData } from '@/services/canvas/vueFlowApi'
import { logger } from '@/core/utils/logger'

/** @returns 包含 nodes / edges / assets / selectedNodeId 等响应式状态的对象 */
export function createGraphStoreState() {
  const nodes = ref<CustomNode[]>([])

  const edges = ref<Edge[]>([])

  const assets = ref<TableAsset[]>([])

  const selectedNodeId = ref<string | null>(null)

  const selectedNodeIds = ref<string[]>([])

  const selectionBox = ref<{ x: number; y: number; width: number; height: number } | null>(null)

  const v2SchemaIdMap = ref<Map<string, string>>(new Map())

  const isSelecting = ref(false)

  const copiedNodes = ref<CustomNode[]>([])

  const pasteOffset = { x: 20, y: 20 }

  const designModalVisible = ref(false)

  const activeRegexNodeId = ref<string | null>(null)

  const regexEditSampleData = ref<string>('')

  const isProjectLoaded = ref(false)

  const projectName = ref('')

  const projectConfigStats = ref({
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
   */
  function updateNodeData(nodeId: string, newData: Partial<CustomNodeData>) {
    // 步骤 1：通过注入层调用 VueFlow 内置 updateNodeData（增量，安全）
    try {
      updateVueFlowNodeData(nodeId, newData as Record<string, unknown>)
    } catch {
      // VueFlow 尚未初始化（如 store 创建阶段），回退到直接 store mutation
      const node = nodes.value.find((n) => n.id === nodeId)
      if (node && node.data) {
        Object.assign(node.data, newData)
      }
      return
    }

    // 步骤 2：nextTick 后同步 store 数据（不触发 v-model watcher）
    nextTick(() => {
      const node = nodes.value.find((n) => n.id === nodeId)
      if (node && node.data) {
        Object.assign(node.data, newData)
      } else if (!node) {
        logger.warn(`[updateNodeData] Node ${nodeId} not found in store after VueFlow update`)
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
    v2SchemaIdMap,
    isSelecting,
    copiedNodes,
    pasteOffset,
    designModalVisible,
    activeRegexNodeId,
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
