/**
 * GraphStore 组装模块
 *
 * 将所有 createXxxModule 工厂函数组装为一个扁平对象，
 * 与 state/computed 组合后导出，供 graphStore setup() 使用。
 */

import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { useInspectionStore } from '@/stores/inspectionStore'
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
import { createRegexExtractFactoryModule } from '../modules/factories/regexExtractFactory'
import { createTransformFactoryModule } from '../modules/factories/transformFactory'
import { createTransformOutputFactoryModule } from '../modules/factories/transformOutputFactory'
import { createManualDataFactoryModule } from '../modules/factories/manualDataFactory'
import { createLibraryNodesFactoryModule } from '../modules/factories/libraryNodesFactory'
import { createMiscFactoryModule } from '../modules/factories/miscFactory'
import { createJsonSchemaFactoryModule } from '../modules/factories/jsonSchemaFactory'
import { createTemplateInstanceFactoryModule } from '../modules/factories/templateInstanceFactory'
import { createTemplateExpandModule } from '../modules/templateExpand'
import { createNodeOpsModule } from '../modules/nodeOps'
import { createPersistenceStatusModule } from '../modules/persistenceStatus'
import { createSchemaOpsModule } from '../modules/schemaOps'
import { createSchemaSourceIndex } from '../modules/schemaSourceIndex'
import { createRegexDesignModule } from '../modules/regexDesign'
import { createAssetsModule } from '../modules/assets'
import { createScopeModule } from '../modules/scope'
import type { GraphStoreState } from './state'
import type { GraphStoreComputed } from './computed'
import type { ProjectStoreLike, ResourceTreeStoreLike } from '@/types/storeInterfaces'
export function createGraphStoreAssembly(
  state: GraphStoreState,
  computed: GraphStoreComputed,
  projectStore: ProjectStoreLike,
  resourceTreeStore: ResourceTreeStoreLike
) {
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
    updateNodeData,
  } = state

  // --- 项目管理 ---

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

  const sourceIndex = createSchemaSourceIndex(nodes)

  const { importV2ResourceToCanvas } = createV2ImportModule({
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    reconcileAll: connectionStateSync.reconcileAll,
    resourceTreeStore,
    sourceIndex,
  })

  const { createSchemaNode, addColumnToSchema } = createSchemaFactoryModule({
    nodes,
    selectedNodeId,
    updateNodeData,
  })
  const { createConstraintNode } = createConstraintFactoryModule({ nodes, selectedNodeId })
  const { createRegexNode } = createRegexFactoryModule({ nodes, selectedNodeId })
  const { createRegexExtractNode } = createRegexExtractFactoryModule({ nodes, selectedNodeId })
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
    reconcileAll: connectionStateSync.reconcileAll,
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
    extractDesignModalVisible,
    activeRegexExtractNodeId,
    regexEditSampleData,
    copiedNodes,
    normalizeConfigDir,
    refreshProjectConfigStats: v2Persistence.refreshProjectConfigStats,
    projectStore,
    resourceTreeStore,
  })

  const {
    createProject,
    clearProject: clearProjectBase,
    resetCanvas,
    createProjectConsoleNode,
    createProjectRootNode,
  } = projectLifecycle

  // 包装 clearProject:在清理画布/项目状态后,同步重置 inspection 结果,
  // 避免旧项目的检测结果(红点/绿点)残留到新项目
  const clearProject = () => {
    clearProjectBase()
    useInspectionStore().reset()
  }

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

  const nodeOps = createNodeOpsModule({
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    reconcileAll: connectionStateSync.reconcileAll,
    templateExpand,
    clearExpansion: templateExpand.clearExpansion,
    sourceIndex,
  })
  const { deleteNode, moveSelectedNode, moveSelectedNodes } = nodeOps

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

  const { deleteNodes } = nodeOps

  const { undoStack, redoStack, saveState, undo, redo } = createHistoryModule({
    nodes,
    edges,
    reconcileAll: connectionStateSync.reconcileAll,
  })

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
    reconcileAll: connectionStateSync.reconcileAll,
  })

  function clearCanvas() {
    templateExpand.resetAll()
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
    sourceIndex.rebuild()
  }

  const { buildProjectYAML, exportProjectAsFile, exportSchemaAsYAML, importSchemaFromYAML } =
    createYamlIOModule({
      nodes,
      assets,
      projectName,
      selectedNodeId,
    })

  const { hasUnsavedChanges, getSaveStatusSummary } = createPersistenceStatusModule({
    nodes,
    isConstraintNodeType,
  })

  const {
    openRegexDesignModal,
    closeRegexDesignModal,
    openRegexExtractDesignModal,
    closeRegexExtractDesignModal,
    saveRegexDesign,
    saveRegexExtractDesign,
    setRegexEditSampleData,
  } = createRegexDesignModule({
    nodes,
    designModalVisible,
    activeRegexNodeId,
    regexEditSampleData,
    updateNodeData,
    extractDesignModalVisible,
    activeRegexExtractNodeId,
  })

  const { saveCanvasAsAsset, loadAssetToCanvas } = createAssetsModule({
    nodes,
    assets,
    clearCanvas,
    createSchemaNode,
    updateNodeData,
  })

  const { getSubGraphStats } = createScopeModule({ nodes, edges })

  return {
    nodes,
    edges,
    assets,
    selectedNode: computed.selectedNode,
    selectedNodeId,
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
    extractDesignModalVisible,
    activeRegexExtractNodeId,
    regexEditSampleData,

    schemaSourceIndex: sourceIndex,

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
    createRegexExtractNode,
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

    getSubGraphStats,

    openRegexDesignModal,
    closeRegexDesignModal,
    openRegexExtractDesignModal,
    closeRegexExtractDesignModal,
    saveRegexDesign,
    saveRegexExtractDesign,
    setRegexEditSampleData,

    listV2Templates,
    getV2Template,
    createV2Template,
    updateV2Template,
    deleteV2Template,
    expandV2Template,
  }
}
