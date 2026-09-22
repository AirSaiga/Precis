/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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

import { computed, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import type { CustomNode } from '@/types/graph'
import type { Edge } from '@vue-flow/core'
import { useCanvasTabStore } from './canvasTabStore'
import { useGraphStore } from './graphStore'
// 视口缩放统一走 Vue Flow（d3-zoom）真实 API；画布未挂载时内部静默降级
import {
  zoomIn as vueFlowZoomIn,
  zoomOut as vueFlowZoomOut,
  zoomTo as vueFlowZoomTo,
  fitView as vueFlowFitView,
  VueFlowApiNotInitializedError,
} from '@/services/canvas/vueFlowApi'
// fitView 安全留白常量位于服务层中立位置（store 不得反向依赖 feature）
import { SAFE_FITVIEW_PADDING } from '@/services/canvas/fitViewPadding'

/** 工作区数据类型（从 canvasTabStore.CanvasTab 重导出） */
export type { CanvasTab as Workspace } from './canvasTabStore'

/** graphStore 最小接口，用于批量删除时委托活跃工作区的删除操作 */
interface GraphStoreLike {
  nodes: CustomNode[]
  edges: Edge[]
  deleteNodes?: (ids: string[]) => void | Promise<void>
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

  // --- 画布内容加载完成信号 ---

  /**
   * 项目加载/工作区恢复完成的通知信号（单调递增计数）。
   *
   * 触发方（两处）：
   * - graphStore.loadProjectFromV2 成功后（项目加载/重载/切换的统一出口）
   * - 本 Store 的 initialize / loadWorkspaces 完成后（工作区快照恢复入口）
   *
   * 消费方：NodeCanvas 的加载适配（自动取景 + 位置异常修复）监听该信号，
   * 仅在加载完成后执行一次性适配。用计数而非布尔是为了支持连续多次加载。
   */
  const contentLoadedEpoch = ref(0)

  /** 标记一次画布内容加载完成（通知画布执行加载后适配） */
  function markContentLoaded(): void {
    contentLoadedEpoch.value++
  }

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
        // 先收集待删节点 id 集合，边过滤对照该集合。
        // 顺序不能对调：先 filter 节点再在已删数组里 find 端点会恒 undefined，
        // 导致悬挂边全被保留（docstring 承诺"移除节点及其关联边"）
        const removedIds = new Set(tab.nodes.filter(predicate).map((n) => n.id))
        tab.nodes = tab.nodes.filter((node) => !removedIds.has(node.id))
        if (tab.edges) {
          tab.edges = tab.edges.filter(
            (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
          )
        }
      }
    })
  }

  // --- 画布视图操作 ---

  /** 本地缩放镜像（1 = 100%），仅反映最近一次缩放操作；真实视口以 Vue Flow 为准 */
  const zoomLevel = ref(1)

  /** 是否显示小地图 */
  const showMinimap = ref(false)

  /**
   * 放大画布视图
   *
   * 真实缩放走 Vue Flow 的 zoomIn（内部尊重画布 minZoom/maxZoom 与过渡动画）；
   * zoomLevel 仅作本地乐观镜像，供测试与潜在 UI 读数使用。
   */
  function zoomIn() {
    // 镜像步进与旧实现一致：×1.2，上限 5（500%）
    zoomLevel.value = Math.min(zoomLevel.value * 1.2, 5)
    void vueFlowZoomIn()
  }

  /**
   * 缩小画布视图
   *
   * 真实缩放走 Vue Flow 的 zoomOut；zoomLevel 仅作本地乐观镜像。
   */
  function zoomOut() {
    // 镜像步进与旧实现一致：÷1.2，下限 0.1（10%）
    zoomLevel.value = Math.max(zoomLevel.value / 1.2, 0.1)
    void vueFlowZoomOut()
  }

  /**
   * 重置画布缩放为 100%
   *
   * 走 Vue Flow 的 zoomTo(1) 精确回到 100%（而非 fitView 的"适配内容"缩放），
   * 常用于快捷键（如 Ctrl+0）或重置视图按钮。
   */
  function resetZoom() {
    zoomLevel.value = 1
    void vueFlowZoomTo(1)
  }

  /**
   * 适应画布视图（框住全部节点）
   *
   * 走 Vue Flow 的 fitView 真实 API：duration: 0 瞬时完成（不留动画窗口，
   * 慢环境下取景动画会与用户画布交互重叠导致落点漂移）；安全留白避开
   * MiniMap / 检查器 / 状态栏浮层（见 SAFE_FITVIEW_PADDING 注释）。
   *
   * - 空画布跳过（fitView 无意义且可能视口跳变）
   * - Vue Flow 未挂载（IDE ↔ Agent 模式切换重建窗口期）抛
   *   VueFlowApiNotInitializedError，此处静默跳过不报错——快捷键在该
   *   窗口期仍可能触发（参照 canvasOps.ts 的既有降级模式）
   * - 不再镜像写入 zoomLevel：fitView 后真实缩放由 Vue Flow 内部维护，
   *   store 侧拿不到 viewport，镜像值只会失真
   */
  function fitView() {
    if (useGraphStore().nodes.length === 0) return
    try {
      vueFlowFitView({ padding: { ...SAFE_FITVIEW_PADDING }, duration: 0 })
    } catch (error) {
      if (error instanceof VueFlowApiNotInitializedError) {
        return
      }
      throw error
    }
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
   * Vue Flow 无"只居中不变焦"的单发 API，与 fitView 同义：框住全部内容
   * 即同时完成居中与变焦（含安全留白与空画布/未挂载守卫）。
   */
  function centerView() {
    fitView()
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

  /**
   * initialize / loadWorkspaces 在委托 tabStore 的基础上，完成后广播
   * contentLoadedEpoch——工作区快照恢复可能整体替换画布节点，画布需要
   * 在恢复完成后执行一次性加载适配（自动取景/位置异常修复）。
   * 参数类型直接取自 tabStore.initialize（其 GraphStoreLike 要求更全，
   * 含 resetCanvas 等），避免在本文件重复维护接口。
   */
  async function initialize(...args: Parameters<typeof tabStore.initialize>) {
    await tabStore.initialize(...args)
    markContentLoaded()
  }

  async function loadWorkspaces(configPath: string) {
    await tabStore.loadTabs(configPath)
    markContentLoaded()
  }

  return {
    // 工作区状态（委托）
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    unsavedWorkspacesCount,

    // 最近一次加载是否存在已保存工作区快照（委托 tabStore）
    lastLoadHadSavedWorkspaces: computed(() => tabStore.lastLoadHadSavedWorkspaces),

    // 画布内容加载完成信号
    contentLoadedEpoch,
    markContentLoaded,

    // 画布视图
    zoomLevel,
    showMinimap,

    // 工作区方法（委托）
    initialize,
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
    loadWorkspaces,
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
