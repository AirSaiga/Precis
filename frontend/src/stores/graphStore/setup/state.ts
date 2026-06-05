import { ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type {
  CustomNode,
  CustomNodeData,
  TableAsset,
} from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '../../../api/projectValidationApi'

function updateNodeDataInArray(
  nodes: CustomNode[],
  nodeId: string,
  data: Partial<CustomNode['data']>
): CustomNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, data: { ...node.data, ...data } } as CustomNode
    }
    return node
  })
}

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

  function updateNodeData(nodeId: string, newData: Partial<CustomNodeData>) {
    nodes.value = updateNodeDataInArray(nodes.value, nodeId, newData)
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
