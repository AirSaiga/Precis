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
import { useCanvasTabStore } from './canvasTabStore'

/** 工作区数据类型（从 canvasTabStore.CanvasTab 重导出） */
export type { CanvasTab as Workspace } from './canvasTabStore'

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

  // --- 画布视图操作 ---

  /** 当前缩放级别（1 = 100%），范围 [0.1, 5] */
  const zoomLevel = ref(1)

  /** 是否显示小地图 */
  const showMinimap = ref(false)

  /** 放大 20%，上限 500% */
  function zoomIn() {
    zoomLevel.value = Math.min(zoomLevel.value * 1.2, 5)
  }

  /** 缩小 20%，下限 10% */
  function zoomOut() {
    zoomLevel.value = Math.max(zoomLevel.value / 1.2, 0.1)
  }

  /** 重置为 100% */
  function resetZoom() {
    zoomLevel.value = 1
  }

  /** 适应视图（当前简化实现，等同于重置缩放） */
  function fitView() {
    zoomLevel.value = 1
  }

  /** 切换小地图显示 */
  function toggleMinimap() {
    showMinimap.value = !showMinimap.value
  }

  /** 居中视图（当前简化实现，等同于重置缩放） */
  function centerView() {
    zoomLevel.value = 1
  }

  /**
   * 设置精确缩放级别
   *
   * @param level - 目标缩放值，会被 clamp 到 [0.1, 5] 范围
   */
  function setZoomLevel(level: number) {
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
