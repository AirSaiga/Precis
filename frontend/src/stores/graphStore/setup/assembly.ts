import { nextTick } from 'vue'
import type { Edge } from '@vue-flow/core'
import type {
  CustomNode,
  SchemaNodeData,
} from '@/types/graph'
import { addNodes, removeNodes, removeEdges } from '@/services/canvas/vueFlowApi'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import '@/services/disconnect' // side-effect: 触发所有断开清理处理器的自注册
import {
  listV2Templates,
  getV2Template,
  createV2Template,
  updateV2Template,
  deleteV2Template,
  expandV2Template,
} from '@/api/projectV2Api'

import { createHistoryModule } from '../modules/history'
import { createSelectionModule } from '../modules/selection'
import { createV2ImportModule } from '../modules/v2Import'
import { createV2PersistenceModule } from '../modules/v2Persistence'
import { createClipboardModule } from '../modules/clipboard'
import { createPathingModule } from '../modules/pathing'
import { createConnectionOpsModule } from '../modules/connectionOps'
import { createConnectionStateSyncModule } from '../modules/connectionStateSync'
import { createYamlIOModule } from '../modules/yamlIO'
import { createProjectLifecycleModule } from '../modules/projectLifecycle'
import { createSchemaFactoryModule } from '../modules/factories/schemaFactory'
import { createConstraintFactoryModule } from '../modules/factories/constraintFactory'
import { createRegexFactoryModule } from '../modules/factories/regexFactory'
import { createTransformFactoryModule } from '../modules/factories/transformFactory'
import { createTransformOutputFactoryModule } from '../modules/factories/transformOutputFactory'
import { createManualDataFactoryModule } from '../modules/factories/manualDataFactory'
import { createLibraryNodesFactoryModule } from '../modules/factories/libraryNodesFactory'
import { createMiscFactoryModule } from '../modules/factories/miscFactory'
import { createJsonSchemaFactoryModule } from '../modules/factories/jsonSchemaFactory'
import { createTemplateInstanceFactoryModule } from '../modules/factories/templateInstanceFactory'
import { createTemplateExpandModule } from '../modules/templateExpand'
import { createSchemaOpsModule } from '../modules/schemaOps'
import { createRegexDesignModule } from '../modules/regexDesign'
import { createAssetsModule } from '../modules/assets'
import { createScopeModule } from '../modules/scope'

import type { GraphStoreState } from './state'
import type { GraphStoreComputed } from './computed'
import { useProjectStore } from '@/stores/projectStore'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'

export function createGraphStoreAssembly(state: GraphStoreState, computed: GraphStoreComputed) {
  const {
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
    regexEditSampleData,
    isProjectLoaded,
    projectName,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    updateNodeData,
  } = state

  // --- 项目管理 ---

  const projectStore = useProjectStore()
  const resourceTreeStore = useResourceTreeStore()

  const { normalizeConfigDir, resolveProjectRelativePath, getEffectiveProjectConfigPath } =
    createPathingModule({
      nodes,
      projectStore,
    })

  // --- 连接状态同步模块（统一管理 parent/children/outputPortConnected） ---
  const connectionStateSync = createConnectionStateSyncModule({
    nodes,
    edges,
    updateNodeData,
  })

  const { importV2ResourceToCanvas } = createV2ImportModule({
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    reconcileAll: connectionStateSync.reconcileAll,
  })

  const { createSchemaNode, addColumnToSchema } = createSchemaFactoryModule({
    nodes,
    selectedNodeId,
  })
  const { createConstraintNode } = createConstraintFactoryModule({ nodes, selectedNodeId })
  const { createRegexNode } = createRegexFactoryModule({ nodes, selectedNodeId })
  const { createTransformNode } = createTransformFactoryModule({ nodes, selectedNodeId })
  const { createTransformOutputNode } = createTransformOutputFactoryModule({ nodes })
  const { createManualDataNode } = createManualDataFactoryModule({ nodes, selectedNodeId })
  const { createPatternToolboxNode, createConstraintDashboardNode } =
    createLibraryNodesFactoryModule({
      nodes,
      selectedNodeId,
      getEffectiveProjectConfigPath,
    })
  const { createEmptyTableNode, createEmptyPatternNode, createLogicNode } = createMiscFactoryModule(
    {
      createSchemaNode,
      createRegexNode,
      createConstraintNode,
    }
  )

  const { createJsonSchemaNode, createJsonSourcePreviewNode } = createJsonSchemaFactoryModule({
    nodes,
    selectedNodeId,
  })

  const { createTemplateInstanceNode } = createTemplateInstanceFactoryModule({
    nodes,
    selectedNodeId,
  })

  const templateExpand = createTemplateExpandModule({
    nodes,
    edges,
    updateNodeData,
  })

  const v2Persistence = createV2PersistenceModule({
    nodes,
    edges,
    selectedNodeId,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    normalizeConfigDir,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    updateNodeData,
  })

  const projectLifecycle = createProjectLifecycleModule({
    nodes,
    edges,
    assets,
    selectedNodeId,
    selectedNodeIds,
    selectionBox,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    designModalVisible,
    activeRegexNodeId,
    regexEditSampleData,
    copiedNodes,
    normalizeConfigDir,
    refreshProjectConfigStats: v2Persistence.refreshProjectConfigStats,
    projectStore,
    resourceTreeStore,
  })

  const {
    createProject,
    clearProject,
    resetCanvas,
    createProjectConsoleNode,
    createProjectRootNode,
  } = projectLifecycle

  const schemaOps = createSchemaOpsModule({
    nodes,
    edges,
    updateNodeData,
    syncOnConnect: connectionStateSync.syncOnConnect,
  })
  const {
    bindRegexToSchemaColumn,
    addConstraintToColumn,
    removeConstraintFromColumn,
    hasColumnConstraint,
    clearColumnValidationErrors,
    clearAllValidationErrors,
  } = schemaOps

  function collectCascadeNodeIds(nodeId: string): string[] {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return [nodeId]

    if (node.type === 'templateInstance') {
      return [nodeId, ...templateExpand.getExpandedIds(nodeId)]
    }

    if (node.type !== 'transform') {
      return [nodeId]
    }

    const transformData = (node.data || {}) as Record<string, unknown>
    const outputNodeIds = Array.isArray(transformData.outputNodeIds)
      ? (transformData.outputNodeIds as string[])
      : []

    const childIdsByParentRef = nodes.value
      .filter((candidate) => {
        if (candidate.type !== 'transformOutput') return false
        const outputData = (candidate.data || {}) as Record<string, unknown>
        return outputData.parentTransformId === nodeId
      })
      .map((candidate) => candidate.id)

    return Array.from(new Set([nodeId, ...outputNodeIds, ...childIdsByParentRef]))
  }

  function deleteNode(nodeId: string) {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node?.type === 'projectRoot') {
      return
    }

    const deleteIds = collectCascadeNodeIds(nodeId)
    const nodeIdSet = new Set(deleteIds)

    const relatedEdges = edges.value.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }

    removeNodes(deleteIds)

    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIdSet.has(id))

    if (selectedNodeId.value && nodeIdSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null
    }

    nextTick(() => {
      connectionStateSync.reconcileAll()
    })
  }

  function moveSelectedNode(deltaX: number, deltaY: number) {
    if (!selectedNodeId.value) {
      return
    }

    const node = nodes.value.find((n) => n.id === selectedNodeId.value)
    if (!node) {
      return
    }

    node.position.x += deltaX
    node.position.y += deltaY
  }

  const {
    selectAllNodes,
    addToSelection,
    removeFromSelection,
    clearSelection,
    setSelection,
    setSelectionFromBox,
    setSelectionBox,
    setSelecting,
  } = createSelectionModule({ nodes, selectedNodeId, selectedNodeIds, selectionBox, isSelecting })

  function deleteNodes(nodeIds: string[]) {
    const filteredIds = nodeIds.filter((id) => {
      const node = nodes.value.find((n) => n.id === id)
      return node?.type !== 'projectRoot'
    })

    if (filteredIds.length === 0) {
      return
    }

    const deleteIds = Array.from(new Set(filteredIds.flatMap((id) => collectCascadeNodeIds(id))))
    const nodeIdSet = new Set(deleteIds)

    const relatedEdges = edges.value.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }

    removeNodes(deleteIds)

    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIdSet.has(id))

    if (selectedNodeId.value && nodeIdSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null
    }

    nextTick(() => {
      connectionStateSync.reconcileAll()
    })
  }

  function moveSelectedNodes(deltaX: number, deltaY: number) {
    if (selectedNodeIds.value.length === 0) {
      return
    }

    for (const node of nodes.value) {
      if (selectedNodeIds.value.includes(node.id)) {
        node.position.x += deltaX
        node.position.y += deltaY
      }
    }
  }

  const { undoStack, redoStack, saveState, undo, redo } = createHistoryModule({ nodes, edges, reconcileAll: connectionStateSync.reconcileAll })

  const { cutSelectedNodes, copySelectedNodes, pasteNodes, duplicateSelectedNode } =
    createClipboardModule({
      nodes,
      edges,
      selectedNodeId,
      selectedNodeIds,
      copiedNodes,
      deleteNode,
      deleteNodes,
      saveState,
      pasteOffset,
      reconcileAll: connectionStateSync.reconcileAll,
    })

  function setSelectedNode(nodeId: string | null) {
    selectedNodeId.value = nodeId
  }

  // --- 连接管理 ---

  const { createConnection, deleteConnection, handleEdgeRemoved } = createConnectionOpsModule({
    nodes,
    edges,
    updateNodeData,
    clearAllValidationErrors,
    syncOnDisconnect: connectionStateSync.syncOnDisconnect,
  })

  function clearCanvas() {
    templateExpand.resetAll()
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
  }

  const { buildProjectYAML, exportProjectAsFile, exportSchemaAsYAML, importSchemaFromYAML } =
    createYamlIOModule({
      nodes,
      assets,
      projectName,
      selectedNodeId,
    })

  function hasUnsavedChanges(): boolean {
    return nodes.value.some((node) => {
      const data = node.data as unknown as Record<string, unknown>
      if (data._expandedFromInstanceId) return false

      if (node.type === 'schema' || node.type === 'jsonSchema') {
        const schemaData = node.data as SchemaNodeData
        return schemaData.saveState === 'draft'
      }
      if (isConstraintNodeType(node.type)) {
        return data?.saveState === 'draft'
      }
      if (node.type === 'regex') {
        return data?.saveState === 'draft'
      }
      if (node.type === 'transform') {
        return data?.saveState === 'draft'
      }
      if (node.type === 'templateInstance') {
        return data?.saveState === 'draft'
      }
      return false
    })
  }

  function getSaveStatusSummary() {
    const totalSchemas = nodes.value.filter((n) => n.type === 'schema').length
    const savedSchemas = nodes.value.filter((n) => {
      if (n.type === 'schema') {
        const schemaData = n.data as SchemaNodeData
        return schemaData.saveState === 'saved'
      }
      return false
    }).length

    const totalTransforms = nodes.value.filter((n) => n.type === 'transform').length
    const savedTransforms = nodes.value.filter((n) => {
      if (n.type === 'transform') {
        return (n.data as unknown as Record<string, unknown>)?.saveState === 'saved'
      }
      return false
    }).length

    return {
      total: totalSchemas + totalTransforms,
      saved: savedSchemas + savedTransforms,
      unsaved: totalSchemas - savedSchemas + totalTransforms - savedTransforms,
      hasChanges: hasUnsavedChanges(),
    }
  }

  const { openRegexDesignModal, closeRegexDesignModal, saveRegexDesign, setRegexEditSampleData } =
    createRegexDesignModule({
      nodes,
      designModalVisible,
      activeRegexNodeId,
      regexEditSampleData,
      updateNodeData,
    })

  const { saveCanvasAsAsset, loadAssetToCanvas } = createAssetsModule({
    nodes,
    assets,
    clearCanvas,
    createSchemaNode,
  })

  const { switchScope, getSubGraphStats } = createScopeModule({ nodes, edges })

  function registerV2SchemaMapping(canvasNodeId: string, v2SchemaId: string) {
    state.v2SchemaIdMap.value.set(canvasNodeId, v2SchemaId)
  }

  function getV2SchemaId(canvasNodeId: string): string | undefined {
    if (canvasNodeId.startsWith('sc_')) return canvasNodeId
    return state.v2SchemaIdMap.value.get(canvasNodeId)
  }

  return {
    nodes,
    edges,
    assets,
    selectedNode: computed.selectedNode,
    selectedNodeId,
    v2SchemaIdMap: state.v2SchemaIdMap,
    selectedNodes: computed.selectedNodes,
    hasMultipleSelection: computed.hasMultipleSelection,
    selectedNodeIds,
    selectionBox,
    isSelecting,
    isProjectLoaded,
    projectName,
    projectConfigStats,
    projectConfigStatsLoaded,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    designModalVisible,
    activeRegexNodeId,
    activeRegexNode: computed.activeRegexNode,
    regexEditSampleData,

    createProject,
    clearProject,
    resetCanvas,
    setLastFullValidationSummary: state.setLastFullValidationSummary,
    setLastFullValidationStatistics: state.setLastFullValidationStatistics,

    createProjectConsoleNode,
    createProjectRootNode,
    createPatternToolboxNode,
    createConstraintDashboardNode,
    createSchemaNode,
    addColumnToSchema,
    createConstraintNode,
    createRegexNode,
    createTransformNode,
    createTransformOutputNode,
    createManualDataNode,
    createJsonSchemaNode,
    createJsonSourcePreviewNode,
    createTemplateInstanceNode,
    expandOnCanvas: templateExpand.expandOnCanvas,
    clearExpansion: templateExpand.clearExpansion,
    collapseExpansion: templateExpand.collapseExpansion,
    reExpand: templateExpand.reExpand,
    getExpandedIds: templateExpand.getExpandedIds,
    createEmptyTableNode,
    createEmptyPatternNode,
    createLogicNode,
    updateNodeData,
    bindRegexToSchemaColumn,
    deleteNode,
    setSelectedNode,
    copySelectedNodes,
    pasteNodes,
    duplicateSelectedNode,
    moveSelectedNode,
    moveSelectedNodes,
    selectAllNodes,
    cutSelectedNodes,

    addToSelection,
    removeFromSelection,
    clearSelection,
    setSelection,
    setSelectionFromBox,
    deleteNodes,

    setSelectionBox,
    setSelecting,

    undoStack,
    redoStack,
    saveState,
    undo,
    redo,
    addConstraintToColumn,
    removeConstraintFromColumn,
    hasColumnConstraint,

    clearColumnValidationErrors,
    clearAllValidationErrors,

    createConnection,
    deleteConnection,
    handleEdgeRemoved,

    syncOnConnect: connectionStateSync.syncOnConnect,
    syncOnDisconnect: connectionStateSync.syncOnDisconnect,
    reconcileAll: connectionStateSync.reconcileAll,

    clearCanvas,

    exportSchemaAsYAML,
    importSchemaFromYAML,
    buildProjectYAML,
    saveProject: v2Persistence.saveProject,
    exportProjectAsFile,
    saveSchemaNode: v2Persistence.saveSchemaNode,
    saveConstraintNode: v2Persistence.saveConstraintNode,
    saveRegexNode: v2Persistence.saveRegexNode,
    saveTransformNode: v2Persistence.saveTransformNode,
    saveTemplateInstanceNode: v2Persistence.saveTemplateInstanceNode,
    loadProjectFromV2: v2Persistence.loadProjectFromV2,
    importV2ResourceToCanvas,
    refreshProjectConfigStats: v2Persistence.refreshProjectConfigStats,
    hasUnsavedChanges,
    getSaveStatusSummary,

    saveCanvasAsAsset,
    loadAssetToCanvas,

    switchScope,

    getSubGraphStats,

    registerV2SchemaMapping,
    getV2SchemaId,

    openRegexDesignModal,
    closeRegexDesignModal,
    saveRegexDesign,
    setRegexEditSampleData,

    listV2Templates,
    getV2Template,
    createV2Template,
    updateV2Template,
    deleteV2Template,
    expandV2Template,
  }
}
