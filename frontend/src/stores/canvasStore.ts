/**
 * @file canvasStore.ts
 * @description 画布状态管理（门面 Store）
 *
 * 本 Store 作为统一门面，将工作区管理职责委托给 canvasTabStore，
 * 同时保留画布视口控制。
 *
 * 架构设计：
 * - 采用 Facade 模式，外部组件只与本 Store 交互，不直接引用 canvasTabStore
 * - 通过 storeToRefs 将 tabStore 的状态转换为响应式引用，保持 Pinia 的响应性
 * - 方法通过直接赋值委托（initialize: tabStore.initialize），无需包装函数
 *
 * 对外暴露两类职责：
 * 1. 工作区管理：创建、切换、关闭、重命名、同步后端
 * 2. 画布视口控制：缩放、小地图、适应视图
 */

import { ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import type { CustomNode } from '@/types/graph'
import type { Edge } from '@vue-flow/core'
import { useCanvasTabStore } from './canvasTabStore'

/** 工作区数据类型（从 canvasTabStore.CanvasTab 重导出） */
export type { CanvasTab as Workspace } from './canvasTabStore'

/** graphStore 最小接口，用于批量删除时委托活跃工作区的删除操作 */
interface GraphStoreLike {
  nodes: CustomNode[]
  edges: Edge[]
  deleteNodes?: (ids: string[]) => void
}

export const useCanvasStore = defineStore('canvas', () => {
  const tabStore = useCanvasTabStore()

  // --- 工作区状态（通过 storeToRefs 保持响应性） ---
  // storeToRefs 确保解构后的 ref 仍与 tabStore 内部状态双向绑定
  const {
    tabs: workspaces,
    activeTabId: activeWorkspaceId,
    activeTab: activeWorkspace,
    unsavedTabsCount: unsavedWorkspacesCount,
  } = storeToRefs(tabStore)

  // --- 工作区批量节点删除 ---

  /**
   * 从所有工作区中移除匹配 predicate 的节点及其关联边
   *
   * 对当前活跃工作区使用 graphStore.deleteNodes 走 Vue Flow 增量删除路径；
   * 对其他工作区快照直接过滤数组（封装在 store 内部，避免业务层直接赋值）。
   */
  function removeNodesFromAllWorkspaces(
    predicate: (node: CustomNode) => boolean,
    graphStore: GraphStoreLike
  ): void {
    const activeId = activeWorkspaceId.value
    tabStore.tabs.forEach((tab) => {
      if (tab.id === activeId && graphStore.deleteNodes) {
        const idsToRemove = graphStore.nodes.filter(predicate).map((n) => n.id)
        if (idsToRemove.length > 0) {
          graphStore.deleteNodes(idsToRemove)
        }
      }
      if (tab.nodes) {
        tab.nodes = tab.nodes.filter((node) => !predicate(node))
      }
      if (tab.edges) {
        tab.edges = tab.edges.filter((edge) => {
          const sourceNode = tab.nodes?.find((n) => n.id === edge.source)
          const targetNode = tab.nodes?.find((n) => n.id === edge.target)
          // 节点已被移除的边直接保留；仅当节点仍存在且匹配 predicate 时才移除该边
          const shouldRemoveSource = sourceNode ? predicate(sourceNode) : false
          const shouldRemoveTarget = targetNode ? predicate(targetNode) : false
          return !shouldRemoveSource && !shouldRemoveTarget
        })
      }
    })
  }

  // --- 画布视图操作 ---

  /** 当前缩放级别（1 = 100%），范围 [0.1, 5] */
  const zoomLevel = ref(1)

  /** 是否显示小地图 */
  const showMinimap = ref(false)

  /**
   * 放大画布视图
   *
   * 每次调用将当前缩放级别乘以 1.2（放大 20%），
   * 上限为 500%（zoomLevel = 5），防止过度放大导致性能问题。
   */
  function zoomIn() {
    // Math.min 确保缩放不超过上限 5（500%）
    zoomLevel.value = Math.min(zoomLevel.value * 1.2, 5)
  }

  /**
   * 缩小画布视图
   *
   * 每次调用将当前缩放级别除以 1.2（缩小 20%），
   * 下限为 10%（zoomLevel = 0.1），防止缩放过小导致内容不可见。
   */
  function zoomOut() {
    // Math.max 确保缩放不低于下限 0.1（10%）
    zoomLevel.value = Math.max(zoomLevel.value / 1.2, 0.1)
  }

  /**
   * 重置画布缩放为 100%
   *
   * 将 zoomLevel 恢复为默认值 1，常用于快捷键（如 Ctrl+0）或重置视图按钮。
   */
  function resetZoom() {
    zoomLevel.value = 1
  }

  /**
   * 适应画布视图
   *
   * 当前为简化实现，等同于重置缩放为 100%。
   * 未来可扩展为根据画布内容自动计算最佳缩放和偏移。
   */
  function fitView() {
    zoomLevel.value = 1
  }

  /**
   * 切换小地图（Minimap）的显示/隐藏状态
   *
   * 小地图用于在画布内容较多时提供全局缩略图导航。
   */
  function toggleMinimap() {
    showMinimap.value = !showMinimap.value
  }

  /**
   * 将画布视图居中
   *
   * 当前为简化实现，等同于重置缩放为 100%。
   * 未来可扩展为计算画布内容边界框并居中显示。
   */
  function centerView() {
    zoomLevel.value = 1
  }

  /**
   * 设置精确的缩放级别
   *
   * 外部组件（如缩放滑块）可通过此方法直接设置目标缩放值，
   * 内部会自动将值限制在 [0.1, 5] 的安全范围内。
   *
   * @param level - 目标缩放值，1 表示 100%
   */
  function setZoomLevel(level: number) {
    // 双重 clamp：先取最小值限制上限，再取最大值限制下限
    zoomLevel.value = Math.max(0.1, Math.min(level, 5))
  }

  return {
    // 工作区状态（委托）
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    unsavedWorkspacesCount,

    // 画布视图
    zoomLevel,
    showMinimap,

    // 工作区方法（委托）
    initialize: tabStore.initialize,
    createNewWorkspace: tabStore.createNewTab,
    setActiveWorkspace: tabStore.setActiveTab,
    closeWorkspace: tabStore.closeTab,
    renameWorkspace: tabStore.renameTab,
    markWorkspaceSaved: tabStore.markTabSaved,
    markWorkspaceDirty: tabStore.markTabDirty,
    saveAllWorkspaces: tabStore.saveAllTabs,
    getWorkspaceList: tabStore.getTabList,
    reorderWorkspaces: tabStore.reorderTabs,
    syncWorkspacesToBackend: tabStore.syncTabsToBackend,
    loadWorkspaces: tabStore.loadTabs,
    saveCurrentCanvasData: tabStore.saveCurrentCanvasData,
    loadCanvasDataFromWorkspace: tabStore.loadCanvasDataFromTab,

    // 工作区批量节点删除
    removeNodesFromAllWorkspaces,

    // 画布视图操作
    zoomIn,
    zoomOut,
    resetZoom,
    fitView,
    toggleMinimap,
    centerView,
    setZoomLevel,
  }
})
