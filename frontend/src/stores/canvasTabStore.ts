/**
 * @file canvasTabStore.ts
 * @description 多画布 Tab 工作区状态管理
 *
 * 职责：
 * - 工作区的创建、关闭、切换、重命名
 * - 工作区画布数据的保存与加载
 * - 后端工作区配置的同步
 *
 * 架构设计：
 * - 被 canvasStore（门面 Store）委托调用，外部不直接使用本 Store
 * - 每个工作区（CanvasTab）独立持有自己的 nodes/edges 快照，
 *   切换工作区时通过 saveCurrentCanvasData / loadCanvasDataFromTab 实现画布状态隔离
 * - graphStore 参数采用 GraphStoreLike 接口（非直接引用 graphStore），
 *   降低 store 间耦合，便于单元测试 mock
 *
 * 数据持久化：
 * - 后端文件：.precis/workspaces.json（通过 GET/PUT /v2/workspaces 同步）
 * - 仅保存元数据（id、title、index），不保存完整节点/边数据
 * - 节点坐标由 project.view.json 承载，与本文件分工协作
 *
 * 注意事项：
 * - 空数组 [] 在 JS 中是 truthy，判断"工作区是否有画布数据"时
 *   必须使用 .length > 0 而非简单的 truthy 检查
 */

import { ref, computed, toRaw, isProxy } from 'vue'
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { useI18n } from 'vue-i18n'
import { logger } from '@/core/utils/logger'
import { getV2Workspaces, putV2Workspaces } from '@/api/projectV2Api'
import { useProjectStore } from './projectStore'

/**
 * 单个工作区（Tab）的数据结构
 *
 * 每个工作区独立维护画布快照（nodes/edges），
 * 切换工作区时这些数据会被保存/恢复，实现多画布状态隔离。
 */
export interface CanvasTab {
  id: string
  index: number
  title: string
  icon: string
  hasUnsavedChanges: boolean
  createdAt: string
  lastActiveAt: string
  nodes?: CustomNode[]
  edges?: Edge[]
}

/**
 * graphStore 的最小接口提取
 *
 * 本 Store 不直接 import graphStore，而是通过此接口注入依赖，
 * 实现 store 间松耦合。传入方只需满足此接口即可（Duck Typing）。
 */
interface GraphStoreLike {
  nodes: CustomNode[]
  edges: Edge[]
  resetCanvas: () => void
  isProjectLoaded?: boolean
  createProjectRootNode?: (position: { x: number; y: number }) => string
}

/**
 * 安全的深拷贝，处理 Vue reactive proxy 和不可序列化对象
 * 跳过 DOM 元素、函数、Symbol、Vue proxy 等不可 clone 的类型
 */
function safeClone<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  // 解包 Vue proxy
  const raw = isProxy(obj) ? toRaw(obj) : obj

  // 跳过 DOM 元素
  if (raw instanceof HTMLElement || raw instanceof Element) {
    return undefined as unknown as T
  }

  // 处理数组
  if (Array.isArray(raw)) {
    return raw.map((item) => safeClone(item)) as unknown as T
  }

  // 处理对象
  const result: any = {}
  for (const key in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = (raw as any)[key]
      if (typeof value === 'function' || typeof value === 'symbol') {
        continue
      }
      result[key] = safeClone(value)
    }
  }
  return result
}

export const useCanvasTabStore = defineStore('canvasTab', () => {
  const { t } = useI18n()

  // --- 核心状态 ---

  /** 所有工作区列表，顺序对应 Tab 栏从左到右的排列 */
  const tabs = ref<CanvasTab[]>([])

  /** 当前激活的工作区 ID，null 表示无激活工作区 */
  const activeTabId = ref<string | null>(null)

  // --- 计算属性 ---

  /** 当前激活的工作区对象，用于 UI 层读取标题、脏标记等 */
  const activeTab = computed(() => {
    return tabs.value.find((w) => w.id === activeTabId.value)
  })

  /** 有未保存更改的工作区数量，用于全局脏状态提示 */
  const unsavedTabsCount = computed(() => {
    return tabs.value.filter((w) => w.hasUnsavedChanges).length
  })

  // --- Actions: 后端同步 ---

  /**
   * 将当前工作区列表同步到后端持久化文件（.precis/workspaces.json）
   *
   * 触发时机：创建、关闭、重命名、切换、重排工作区后自动调用。
   * 仅保存元数据（id/title/index/时间戳/可见节点 ID），
   * 不保存完整节点/边数据（节点坐标由 project.view.json 承载）。
   *
   * 副作用：无项目路径时静默跳过（首次启动未加载项目）
   */
  async function syncTabsToBackend() {
    const projectStore = useProjectStore()
    const configPath = projectStore.currentPaths?.configPath
    if (!configPath) return
    try {
      const payload = {
        version: 1,
        activeWorkspaceId: activeTabId.value,
        workspaces: tabs.value.map((w) => ({
          id: w.id,
          title: w.title,
          index: w.index,
          createdAt: w.createdAt,
          lastActiveAt: w.lastActiveAt,
          visibleNodeIds: w.nodes?.map((n) => n.id) || [],
          nodes: w.nodes || [],
          edges: w.edges || [],
        })),
      }
      await putV2Workspaces(payload, configPath)
    } catch (e) {
      logger.error('[CanvasTabStore] 保存工作区失败:', e)
    }
  }

  /**
   * 确保画布上存在 projectRoot 节点
   *
   * 在以下场景调用：
   * - initialize 从后端恢复了已保存的工作区后
   * - 此时画布可能已被 Vue Flow 的 v-model 双向绑定重置为空
   *
   * 幂等性：如果 projectRoot 已存在，仅更新位置
   */
  function ensureProjectRootInCanvas(graphStore: GraphStoreLike) {
    if (graphStore.isProjectLoaded && graphStore.createProjectRootNode) {
      const hasRoot = graphStore.nodes.some((n) => n.type === 'projectRoot')
      if (!hasRoot) {
        graphStore.createProjectRootNode({ x: 100, y: 100 })
      }
    }
  }

  /**
   * 从后端加载已保存的工作区列表
   *
   * 恢复工作区的元数据（id/title/index 等），但 nodes/edges 初始化为空。
   * 画布节点数据由 loadProjectFromV2 在项目加载阶段独立恢复。
   *
   * 副作用：后端无已保存工作区时，tabs 保持为空，由 initialize 兜底创建默认 Tab
   */
  async function loadTabs(configPath: string) {
    try {
      const data = await getV2Workspaces(configPath)
      if (data.workspaces && data.workspaces.length > 0) {
        tabs.value = data.workspaces.map((w) => ({
          id: w.id,
          index: w.index,
          title: w.title,
          icon: '🖼️',
          hasUnsavedChanges: false,
          createdAt: w.createdAt,
          lastActiveAt: w.lastActiveAt,
          nodes: (w.nodes || []) as unknown as CustomNode[],
          edges: (w.edges || []) as unknown as Edge[],
        }))
        activeTabId.value = data.activeWorkspaceId || tabs.value[0]?.id || null
      } else {
        tabs.value = []
        activeTabId.value = null
      }
    } catch (e) {
      logger.error('[CanvasTabStore] 加载工作区失败:', e)
      tabs.value = []
      activeTabId.value = null
    }
  }

  /**
   * 初始化工作区系统（应用启动时调用一次）
   *
   * 流程：
   * 1. 设置项目配置路径
   * 2. 从后端加载已保存的工作区列表
   * 3. 如果后端无已保存工作区，创建一个默认 Tab
   *
   * @param configPath - 项目配置根目录，用于后端 API 调用
   * @param graphStore - graphStore 实例（GraphStoreLike），用于在创建默认 Tab 时
   *                     自动重置画布并添加 projectRoot 节点
   */
  async function initialize(configPath?: string, graphStore?: GraphStoreLike) {
    if (configPath) {
      await loadTabs(configPath)
    }
    if (tabs.value.length === 0) {
      createNewTab(graphStore)
    } else if (graphStore) {
      ensureProjectRootInCanvas(graphStore)
    }
  }

  // --- Actions: Tab 管理 ---

  /**
   * 创建新的工作区 Tab
   *
   * 流程：
   * 1. 保存当前工作区的画布快照（如果有前一个工作区）
   * 2. 创建新 Tab 并设为激活
   * 3. 如果传入了 graphStore，重置画布并在项目已加载时自动创建 projectRoot
   * 4. 同步到后端
   *
   * @param graphStore - 可选。传入时会在新工作区中自动创建 projectRoot 节点；
   *                     不传入时仅创建空 Tab（用于初始化阶段，画布由外部管理）
   * @returns 新创建 Tab 的 ID
   */
  function createNewTab(graphStore?: GraphStoreLike) {
    // 找最小空闲正整数编号：优先填补缺失编号（如历史遗留缺少 1），再扩展
    const usedIndices = new Set(tabs.value.map((t) => t.index))
    let nextIndex = 1
    while (usedIndices.has(nextIndex)) {
      nextIndex++
    }
    const newTab: CanvasTab = {
      id: uuidv4(),
      index: nextIndex,
      title: t('canvas.workspaceWithIndex', {
        name: t('canvas.workspace'),
        index: nextIndex,
      }),
      icon: '🖼️',
      hasUnsavedChanges: true,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      nodes: [],
      edges: [],
    }

    // 保存前一个工作区的画布快照，防止切换丢失
    const previousTabId = activeTabId.value
    if (previousTabId && graphStore) {
      saveCurrentCanvasData(graphStore.nodes, graphStore.edges)
    }

    tabs.value = [...tabs.value, newTab]
    activeTabId.value = newTab.id

    if (graphStore) {
      graphStore.resetCanvas()
      // 项目已加载时，空画布需要 projectRoot 作为项目入口
      ensureProjectRootInCanvas(graphStore)
    }

    syncTabsToBackend()
    return newTab.id
  }

  /**
   * 将当前画布的节点/边深拷贝保存到对应工作区
   *
   * 使用 structuredClone 实现深拷贝，
   * 断开引用关系，确保工作区间的画布状态完全隔离。
   *
   * 副作用：设置 hasUnsavedChanges = true，Tab 标题栏显示脏标记（●）
   */
  function saveCurrentCanvasData(nodes: CustomNode[], edges: Edge[]) {
    const currentTab = tabs.value.find((w) => w.id === activeTabId.value)
    if (currentTab) {
      currentTab.nodes = safeClone(nodes)
      currentTab.edges = safeClone(edges)
      currentTab.hasUnsavedChanges = true
    }
  }

  /**
   * 从当前工作区加载画布快照数据
   *
   * 返回 nodes/edges 的深拷贝，避免外部修改污染工作区内部状态。
   *
   * 注意：使用 .length > 0 判断而非 truthy 检查，
   * 因为空数组 [] 在 JS 中是 truthy，会导致空工作区被误判为"有数据"。
   *
   * @returns 画布数据（深拷贝），或 null 表示当前工作区无画布数据
   */
  function loadCanvasDataFromTab(): { nodes: CustomNode[]; edges: Edge[] } | null {
    const currentTab = tabs.value.find((w) => w.id === activeTabId.value)
    // 必须检查 .length > 0，因为 [] 是 truthy
    const hasData =
      currentTab &&
      ((currentTab.nodes && currentTab.nodes.length > 0) ||
        (currentTab.edges && currentTab.edges.length > 0))
    if (hasData) {
      return {
        nodes: currentTab.nodes ? safeClone(currentTab.nodes) : [],
        edges: currentTab.edges ? safeClone(currentTab.edges) : [],
      }
    }
    return null
  }

  /**
   * 切换到指定工作区
   *
   * 流程：
   * 1. 保存当前工作区的画布快照
   * 2. 激活目标 Tab
   * 3. 恢复目标 Tab 的画布数据：
   *    - 有数据：从快照恢复 nodes/edges
   *    - 无数据：重置画布，如果项目已加载则自动创建 projectRoot
   *
   * @param tabId - 目标工作区 ID
   * @param graphStore - 可选。传入时支持画布状态保存/恢复和 projectRoot 自动创建
   */
  function setActiveTab(tabId: string, graphStore?: GraphStoreLike) {
    const tab = tabs.value.find((w) => w.id === tabId)
    if (!tab) return

    // Step 1: 离开当前工作区前，保存画布快照
    const previousTabId = activeTabId.value
    if (previousTabId && graphStore) {
      saveCurrentCanvasData(graphStore.nodes, graphStore.edges)
    }

    // Step 2: 激活目标 Tab
    tab.lastActiveAt = new Date().toISOString()
    activeTabId.value = tabId

    // Step 3: 恢复目标 Tab 的画布状态
    // 必须检查 .length > 0，因为空数组 [] 是 truthy
    const hasCanvasData = (tab.nodes && tab.nodes.length > 0) || (tab.edges && tab.edges.length > 0)

    if (graphStore && hasCanvasData) {
      // 分支 A：目标 Tab 有画布数据，恢复快照
      const canvasData = loadCanvasDataFromTab()
      if (canvasData) {
        graphStore.resetCanvas()
        graphStore.nodes = canvasData.nodes
        graphStore.edges = canvasData.edges
      }
      // 恢复快照后确保 projectRoot 存在（快照可能在 project-closed 时被移除）
      ensureProjectRootInCanvas(graphStore)
    } else if (graphStore) {
      // 分支 B：目标 Tab 无画布数据，重置画布并创建 projectRoot
      graphStore.resetCanvas()
      if (graphStore.isProjectLoaded && graphStore.createProjectRootNode) {
        graphStore.createProjectRootNode({ x: 100, y: 100 })
      }
    }

    // 切换完成后持久化到磁盘（含画布快照）
    syncTabsToBackend()
  }

  /**
   * 关闭指定工作区
   *
   * 流程：
   * 1. 如果有未保存更改，弹窗确认
   * 2. 从列表中移除 Tab
   * 3. 如果关闭的是当前激活 Tab：
   *    - 还有其他 Tab：切换到相邻 Tab
   *    - 最后一个 Tab：自动创建新的空 Tab
   *
   * @param tabId - 要关闭的工作区 ID
   * @param graphStore - 可选。传入时支持画布状态保存和自动创建 projectRoot
   */
  function closeTab(tabId: string, graphStore?: GraphStoreLike) {
    const index = tabs.value.findIndex((w) => w.id === tabId)
    if (index === -1) return

    // 未保存更改确认
    const tab = tabs.value[index]
    if (!tab) return
    if (tab.hasUnsavedChanges) {
      const confirmed = confirm(t('canvas.closeWorkspaceConfirm', { title: tab.title }))
      if (!confirmed) return
    }

    tabs.value.splice(index, 1)

    // 关闭的是当前激活 Tab，需要切换到其他 Tab 或创建新 Tab
    if (activeTabId.value === tabId) {
      if (tabs.value.length > 0) {
        // 选择被关闭 Tab 的相邻位置（优先右侧，否则左侧）
        const newIndex = index < tabs.value.length ? index : index - 1
        const nextTab = tabs.value[newIndex]
        if (nextTab) {
          setActiveTab(nextTab.id, graphStore)
        }
      } else {
        // 最后一个 Tab 被关闭，自动创建新的空 Tab
        activeTabId.value = null
        createNewTab(graphStore)
      }
    } else {
      // 关闭非激活 Tab：同步到磁盘（setActiveTab/createNewTab 内部已有同步）
      syncTabsToBackend()
    }
  }

  /**
   * 重命名工作区
   *
   * @param tabId - 目标工作区 ID
   * @param newTitle - 新标题。不传时弹出浏览器 prompt 让用户输入
   */
  function renameTab(tabId: string, newTitle?: string) {
    const tab = tabs.value.find((w) => w.id === tabId)
    if (!tab) return

    if (newTitle !== undefined && newTitle.trim()) {
      tab.title = newTitle.trim()
      tab.hasUnsavedChanges = true
    } else if (newTitle === undefined) {
      const userInput = prompt(t('canvas.renameWorkspacePrompt'), tab.title)
      if (userInput && userInput.trim()) {
        tab.title = userInput.trim()
        tab.hasUnsavedChanges = true
      }
    }

    syncTabsToBackend()
  }

  /**
   * 标记指定工作区为已保存状态（清除脏标记）
   *
   * 脏标记用于在 Tab 标题栏显示未保存指示（如 ● 符号）。
   * 通常在用户显式保存（Ctrl+S）或自动保存成功后调用。
   *
   * @param tabId - 目标工作区 ID
   */
  function markTabSaved(tabId: string) {
    const tab = tabs.value.find((w) => w.id === tabId)
    if (tab) {
      // 清除脏标记，Tab 标题栏不再显示未保存指示
      tab.hasUnsavedChanges = false
    }
  }

  /**
   * 标记指定工作区为有未保存更改（显示脏标记）
   *
   * 当用户修改画布内容（添加/删除节点、修改连接等）时调用，
   * 提示用户当前工作区有未保存的更改。
   *
   * @param tabId - 目标工作区 ID
   */
  function markTabDirty(tabId: string) {
    const tab = tabs.value.find((w) => w.id === tabId)
    if (tab) {
      // 设置脏标记，Tab 标题栏显示未保存指示（如 ●）
      tab.hasUnsavedChanges = true
    }
  }

  /**
   * 标记所有工作区为已保存并同步到后端
   *
   * 用于全局保存操作（如 Ctrl+S），批量清除所有 Tab 的脏标记。
   */
  async function saveAllTabs() {
    tabs.value.forEach((w) => {
      w.hasUnsavedChanges = false
    })
    await syncTabsToBackend()
  }

  /**
   * 获取工作区列表的浅拷贝引用（用于 UI 渲染）
   *
   * 返回 tabs 数组的浅拷贝，避免外部直接修改内部数组引用，
   * 同时保持响应性以便 Vue 的模板系统能够追踪变化。
   *
   * @returns 当前所有工作区的浅拷贝数组
   */
  function getTabList() {
    // 使用展开运算符创建浅拷贝，保留响应性引用
    return [...tabs.value]
  }

  /**
   * 重排工作区顺序（拖拽排序后调用）
   *
   * 用户通过拖拽 Tab 栏重新排列工作区顺序后，
   * 调用此方法用新顺序替换原数组，并同步到后端持久化。
   *
   * @param newOrder - 重新排序后的工作区数组
   */
  function reorderTabs(newOrder: CanvasTab[]) {
    // 创建新数组引用，触发 Vue 的响应式更新
    tabs.value = [...newOrder]
    // 同步新顺序到后端配置文件
    syncTabsToBackend()
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    unsavedTabsCount,
    initialize,
    createNewTab,
    setActiveTab,
    closeTab,
    renameTab,
    markTabSaved,
    markTabDirty,
    saveAllTabs,
    getTabList,
    reorderTabs,
    syncTabsToBackend,
    loadTabs,
    saveCurrentCanvasData,
    loadCanvasDataFromTab,
  }
})
