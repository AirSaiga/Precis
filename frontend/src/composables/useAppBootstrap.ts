/**
 * @file useAppBootstrap.ts
 * @description 应用启动引导组合式函数
 *
 * 职责：
 * - Electron 模式下从主进程恢复项目路径
 * - 初始化 Workspace、Canvas、Drag Store
 * - 初始化键盘快捷键系统
 * - 提供清理函数
 *
 * 架构设计：
 * - 本模块是应用启动的唯一入口，由 App.vue 的 onMounted 调用
 * - 采用串行初始化顺序：项目路径 → 工作区 → 画布 → 拖拽 → 快捷键
 * - graphStore 在此模块中实例化后，作为参数传递给 canvasStore.initialize，
 *   使工作区创建时能自动添加 projectRoot 节点
 *
 * 启动流程：
 * 1. bootstrapProjectPaths — 从能力抽象层恢复最近项目路径，创建项目并添加 projectRoot
 * 2. workspaceStore.initialize — 初始化数据源配置（非画布工作区）
 * 3. canvasStore.initialize — 初始化画布工作区系统，传入 graphStore 支持自动 projectRoot
 * 4. dragStore.initializeDragState — 初始化拖拽状态
 * 5. useKeyboardShortcuts — 启动全局键盘快捷键监听
 *
 * 注意事项：
 * - bootstrap 中各步骤有隐式依赖顺序，不可并行化
 * - bootstrapProjectPaths 通过 appApi 统一恢复最近项目（Electron IPC / Web localStorage）
 */

import { watch, type WatchStopHandle } from 'vue'
import { useGraphStore } from '@/stores/graphStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useDragStore } from '@/stores/dragStore'
import { useProjectStore } from '@/stores/projectStore'
import { useShortcutStore } from '@/features/keyboard/stores/shortcutStore'
import { useKeyboardShortcuts, platformDetector } from '@/features/keyboard'
import type { Shortcut } from '@/features/keyboard/types'
import { logger } from '@/core/utils/logger'
import { useInspectionStore } from '@/stores/inspectionStore'
import { getV2FullConfig, ProjectNotFoundError } from '@/api/projectV2Api'
import { appApi } from '@/core/capabilities/appApi'

/**
 * 提取路径的最后一层目录名作为项目名称
 *
 * 例：'D:/Projects/MyProject' → 'MyProject'
 * 兼容 Windows（\）和 Unix（/）路径分隔符
 */
const basename = (p: string): string => {
  const raw = (p || '').replace(/[\\/]+$/, '')
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return idx >= 0 ? raw.slice(idx + 1) : raw
}

/**
 * 引导函数的返回类型，提供启动、清理和键盘管理器访问
 *
 * @property bootstrap - 启动应用主流程（串行初始化各子系统）
 * @property cleanup - 清理所有启动时创建的资源与监听器
 * @property keyboardManager - 键盘快捷键管理器实例，用于外部控制（如暂停/恢复）
 */
export interface BootstrapResult {
  bootstrap: () => Promise<void>
  cleanup: () => void
  continueBootstrapAfterProject: (projectPath: string) => Promise<void>
  keyboardManager: ReturnType<typeof useKeyboardShortcuts> | null
}

/**
 * 应用启动引导组合式函数
 *
 * 在 App.vue 的 setup 阶段调用一次，返回 bootstrap/cleanup 方法。
 * bootstrap 在 onMounted 中调用，cleanup 在 onUnmounted 中调用。
 */
export function useAppBootstrap(): BootstrapResult {
  // === 核心 Store 实例 ===
  // graphStore: 画布节点/边状态，负责 projectRoot 节点创建
  // workspaceStore: 数据源配置（非画布工作区）
  // canvasStore: 多标签画布工作区系统
  // dragStore: 资源树 → 画布跨组件拖拽状态
  // projectStore: 当前项目路径管理
  // shortcutStore: 用户自定义快捷键配置
  const graphStore = useGraphStore()
  const workspaceStore = useWorkspaceStore()
  const canvasStore = useCanvasStore()
  const dragStore = useDragStore()
  const projectStore = useProjectStore()
  const shortcutStore = useShortcutStore()

  // === 局部状态 ===
  // keyboardManager: 键盘引擎实例，由 bootstrap 阶段创建
  // stopShortcutConfigWatch: watch 返回的停止函数，cleanup 时调用
  let keyboardManager: ReturnType<typeof useKeyboardShortcuts> | null = null
  let stopShortcutConfigWatch: WatchStopHandle | null = null

  /**
   * 将 shortcutStore 中的自定义快捷键配置转换为键盘引擎所需的格式
   *
   * shortcutStore 存储的是扁平对象 { commandId: { key, ctrl, ... } }，
   * 键盘引擎需要 Map<string, Shortcut> 格式，此函数完成转换。
   */
  const buildCustomShortcutMap = (): Record<string, Shortcut> => {
    const result: Record<string, Shortcut> = {}
    const custom = shortcutStore.config.customShortcuts
    for (const [commandId, value] of Object.entries(custom)) {
      result[commandId] = {
        key: value.key,
        ctrl: Boolean(value.ctrl),
        meta: Boolean(value.meta),
        shift: Boolean(value.shift),
        alt: Boolean(value.alt),
      }
    }
    return result
  }

  /**
   * 从能力抽象层恢复最近项目路径并初始化项目
   *
   * 通过 appApi.loadRecentProject 统一获取上次打开的项目路径（Electron IPC / Web localStorage），然后：
   * 1. 验证项目路径是否真实存在（调用后端 API 检查）
   * 2. 如果项目存在：设置 projectStore 路径并创建 projectRoot 节点
   * 3. 如果项目不存在（已删除/移动）：清理残留路径，避免显示无效项目
   *
   * 幂等性：通过 !graphStore.isProjectLoaded 守卫，防止重复初始化
   * 副作用：修改 projectStore、graphStore 的状态
   */
  const bootstrapProjectPaths = async (): Promise<boolean> => {
    // 优先从能力抽象层恢复最近项目（Electron IPC / Web localStorage）
    const recent = await appApi.loadRecentProject()
    let configPath = recent.configPath
    let dataPath = recent.dataPath

    // 如果能力层未返回路径，再回退到当前 store 中的路径
    if (!configPath) {
      configPath = projectStore.currentPaths?.configPath || undefined
      dataPath = projectStore.currentPaths?.dataPath || undefined
    }

    // 没有任何可用路径时返回 false，由调用方决定下一步
    if (!configPath) {
      return false
    }

    try {
      // 验证项目路径是否真实存在（后端能正常返回配置），同时执行配置自检
      const fullConfig = await getV2FullConfig(configPath, { inspect: true })
      // 项目存在，设置路径并创建 projectRoot
      projectStore.setProjectPaths({ configPath, dataPath: dataPath || configPath })
      await appApi.saveRecentProject({ configPath, dataPath: dataPath || configPath })

      // 处理配置自检结果：
      // - 写入 store，由 Header 徽章 + InspectionDrawer 渲染
      // - 首次进入项目：如有 blocker 严重度问题，自动展开抽屉
      const inspectionStore = useInspectionStore()
      if (fullConfig.inspection) {
        inspectionStore.setResult(fullConfig.inspection, { autoOpen: 'if-blocker' })
        if (fullConfig.inspection.errors.length > 0) {
          logger.warn(
            '[AppBootstrap] 配置自检发现 %d 个问题',
            fullConfig.inspection.errors.length
          )
        } else {
          logger.info('[AppBootstrap] 配置自检通过')
        }
      }
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        // 项目已不存在（被删除或移动），清理残留路径
        logger.warn('[AppBootstrap] 项目路径已失效，清理残留:', configPath)
        projectStore.clearProject()
        await appApi.saveRecentProject({ configPath: '', dataPath: '' }).catch(() => undefined)
        return false
      }
      // 其他错误（如后端未启动）暂不清理路径，避免网络抖动导致状态丢失
      logger.warn('[AppBootstrap] 验证项目路径时出错，保留路径待重试:', error)
      projectStore.setProjectPaths({ configPath, dataPath: dataPath || configPath })
    }
    return true
  }

  /**
   * 在用户通过 ProjectSelector 选择项目后，继续执行引导流程。
   * 设置项目路径、创建 projectRoot 后进入标准初始化流程。
   */
  const continueBootstrapAfterProject = async (projectPath: string) => {
    projectStore.setProjectPaths({ configPath: projectPath, dataPath: projectPath })

    // 验证项目并创建 projectRoot
    if (!graphStore.isProjectLoaded) {
      graphStore.createProject(basename(projectPath) || 'project', projectPath)
      graphStore.createProjectRootNode({ x: 80, y: 80 })
    }

    // 加载项目配置、统计与自检信息，与 ProjectManagementModal.loadProject 行为保持一致
    await graphStore.loadProjectFromV2()

    // 执行 bootstrap 中剩余的步骤 2-5
    await workspaceStore.initialize()
    await canvasStore.initialize(projectStore.currentPaths?.configPath, graphStore)
    dragStore.initializeDragState()

    // 初始化键盘快捷键
    keyboardManager = useKeyboardShortcuts({
      getExecutionContext: () => ({ showFeedback: shortcutStore.showFeedback }),
      userConfig: {
        customShortcuts: buildCustomShortcutMap(),
        disabledCommands: [...shortcutStore.config.disabledCommands],
      },
    })
    keyboardManager.updateWhen(() => shortcutStore.enabled)

    stopShortcutConfigWatch = watch(
      () => shortcutStore.config,
      (cfg) => {
        if (!keyboardManager) return
        keyboardManager.applyUserConfig({
          customShortcuts: buildCustomShortcutMap(),
          disabledCommands: [...cfg.disabledCommands],
        })
      },
      { deep: true }
    )

    logger.debug('[App] Web 模式项目已加载，键盘快捷键系统已启动')
  }

  /**
   * 创建项目并添加 projectRoot 节点（在 bootstrapProjectPaths 之后调用）。
   *
   * 幂等性：通过 !graphStore.isProjectLoaded 守卫，防止重复初始化
   */
  const createProjectIfLoaded = () => {
    if (!graphStore.isProjectLoaded) {
      const activeConfigPath = projectStore.currentPaths?.configPath
      if (activeConfigPath) {
        graphStore.createProject(basename(activeConfigPath) || 'project', activeConfigPath)
        graphStore.createProjectRootNode({ x: 80, y: 80 })
      }
    }
  }

  /**
   * 应用启动主流程（串行执行）
   *
   * 步骤顺序不可更改，存在隐式依赖：
   * - canvasStore.initialize 依赖 projectStore.currentPaths（由 bootstrapProjectPaths 设置）
   * - canvasStore.initialize 依赖 graphStore.isProjectLoaded（由 createProject 设置）
   * - 键盘快捷键依赖所有 Store 初始化完成
   *
   * 副作用：
   * - 创建全局键盘事件监听器
   * - 创建 shortcutStore.config 的深度 watch（用户修改快捷键配置时实时生效）
   */
  const bootstrap = async () => {
    // Step 1: 恢复项目路径（Electron 或 Web localStorage）并创建项目
    const hasProject = await bootstrapProjectPaths()

    if (!hasProject) {
      // 没有已保存的项目路径，由 ProjectSelector 处理
      // 不执行后续步骤，不等启动键盘快捷键
      logger.info('[AppBootstrap] 无项目路径，等待用户选择')
      return
    }

    // 创建项目节点（如果 bootstrapProjectPaths 已设置路径但未创建）
    createProjectIfLoaded()

    // Step 2: 初始化数据源工作区（非画布 Tab 工作区，而是数据源配置）
    await workspaceStore.initialize()

    // Step 3: 初始化画布工作区系统
    // 传入 graphStore 使工作区创建/切换时能自动管理 projectRoot 节点
    await canvasStore.initialize(projectStore.currentPaths?.configPath, graphStore)

    // Step 4: 初始化拖拽状态（资源树 → 画布的跨组件拖拽）
    dragStore.initializeDragState()

    // Step 5: 启动键盘快捷键系统
    keyboardManager = useKeyboardShortcuts({
      getExecutionContext: () => ({ showFeedback: shortcutStore.showFeedback }),
      userConfig: {
        customShortcuts: buildCustomShortcutMap(),
        disabledCommands: [...shortcutStore.config.disabledCommands],
      },
    })

    // 全局开关：settings 中可以启用/禁用快捷键
    keyboardManager.updateWhen(() => shortcutStore.enabled)

    // 监听快捷键配置变更，实时应用到键盘引擎
    stopShortcutConfigWatch = watch(
      () => shortcutStore.config,
      (cfg) => {
        if (!keyboardManager) return
        keyboardManager.applyUserConfig({
          customShortcuts: buildCustomShortcutMap(),
          disabledCommands: [...cfg.disabledCommands],
        })
      },
      { deep: true }
    )

    logger.debug('[App] 键盘快捷键系统已启动')
  }

  /**
   * 清理所有启动时创建的资源和监听器
   *
   * 在 App.vue 的 onUnmounted 中调用，防止 SPA 路由切换或热重载时
   * 产生重复的事件监听器导致内存泄漏。
   */
  const cleanup = () => {
    if (keyboardManager) {
      keyboardManager.stop()
      keyboardManager = null
    }
    if (stopShortcutConfigWatch) {
      stopShortcutConfigWatch()
      stopShortcutConfigWatch = null
    }
    dragStore.resetDragState()
    logger.debug('🧹 App引导组件已清理')
  }

  return {
    // 启动主流程：串行初始化项目路径 → 工作区 → 画布 → 拖拽 → 快捷键
    bootstrap,
    // Web 模式：用户在 ProjectSelector 中选择项目后继续引导
    continueBootstrapAfterProject,
    // 清理函数：在 onUnmounted 中调用，防止内存泄漏
    cleanup,
    // 通过 getter 暴露 keyboardManager，使外部可访问但不可直接赋值
    get keyboardManager() {
      return keyboardManager
    },
  }
}
