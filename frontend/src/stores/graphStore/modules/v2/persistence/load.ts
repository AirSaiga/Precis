/**
 * @file load.ts
 * @description V2 项目加载模块 - 从后端加载项目配置并重建画布基础结构
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * createV2LoadOps 工厂返回唯一操作 loadProjectFromV2：
 * 加载完整的 V2 项目配置，重建画布基础节点并更新项目状态。
 *
 * ====================================================================
 * 加载流程
 * ====================================================================
 * 1. 获取配置路径（getEffectiveProjectConfigPath）
 * 2. 加载完整配置（getV2FullConfig，含配置自检 inspect）
 * 3. 重置校验摘要/统计状态，逐条 toast 清单警告
 * 4. 统计并写入 projectConfigStats（schema/约束（独立+内联）/regex/transform/模板实例数）
 * 5. 加载视图文件 view.json（getV2ProjectView，可选，失败不阻断主流程）
 * 6. 构建节点数组：projectRoot 节点 + templateInstance 节点（统一折叠态）
 * 7. 应用 view.json 中保存的节点位置与 hidden 状态
 * 8. 向后兼容：检测旧 projectConsole 节点并迁移为 projectRoot
 * 9. 全量替换 nodes/edges，重置 selectedNodeId，清空撤销/重做栈（clearHistory）
 * 10. 写入配置自检结果（inspectionStore），标记 isProjectLoaded = true
 * 11. 广播 markContentLoaded（画布侧据此执行一次性自动取景）
 *
 * ====================================================================
 * 水合（Hydration）策略
 * ====================================================================
 * 加载时不自动水合 Schema/Constraint/Regex 等资源节点到画布——
 * 画布是用户的工作区，资源应从左侧资源树手动拖拽。
 * 画布结构仅重建 projectRoot 与折叠态 templateInstance 两类节点。
 *
 * ====================================================================
 * 节点可见性策略
 * ====================================================================
 * 默认显示所有节点，不做默认隐藏（F8）：
 * 之前强制 hidden=true 导致用户每次打开项目都要手动显示节点，已废弃。
 * 若 view.json 中保存了 hidden 状态，则按 view 恢复对应节点的可见性。
 *
 * ====================================================================
 * 向后兼容
 * ====================================================================
 * - 自动检测并迁移旧 projectConsole 节点为 projectRoot
 * - 保持对历史版本的兼容性
 *
 * ====================================================================
 * 状态更新
 * ====================================================================
 * - projectName: 从配置中读取项目名称
 * - isProjectLoaded: hydration 全部成功后设为 true，失败时回滚为 false
 * - lastFullValidationSummary/Statistics: 重置为 null
 * - selectedNodeId: 重置为 null
 * - projectConfigStats/Loaded/ConfigPath: 写入最新统计
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - ProjectNotFoundError：提示项目路径不存在（manifest 缺失或路径错误）
 * - 其他异常：toast 错误提示并回滚 isProjectLoaded/projectName
 * - 清单警告信息（warnings）与配置解析错误（schema_errors）逐条 toast
 * - 视图加载失败不阻止主流程（可选）
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 全量替换画布状态（nodes, edges）
 * - 更新多个响应式状态（projectName, isProjectLoaded 等）
 * - 清空撤销/重做栈（项目加载是画布上下文的不可逆切换）
 * - 显示 toast 通知、写入 inspectionStore、广播 markContentLoaded
 *
 * @module graphStore/modules/v2/persistence
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '@/api/projectValidationApi'
import type { ProjectConfigStats } from '../../../setup/state'
import { toastError, toastSuccess, toastWarning } from '@/core/toast'
import { useI18n } from 'vue-i18n'
import { useInspectionStore } from '@/stores/inspectionStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { getV2FullConfig, getV2ProjectView, ProjectNotFoundError } from '@/api/projectV2Api'

export function createV2LoadOps(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  projectName: Ref<string>
  isProjectLoaded: Ref<boolean>
  projectConfigStats: Ref<ProjectConfigStats>
  projectConfigStatsLoaded: Ref<boolean>
  projectConfigStatsConfigPath: Ref<string>
  lastFullValidationSummary: Ref<FullValidationSummary | null>
  lastFullValidationStatistics: Ref<ValidationStatistics | null>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  /** 清空撤销/重做栈（history 模块注入）。项目加载是画布上下文的不可逆切换，旧栈必须废弃 */
  clearHistory?: () => void
}) {
  const {
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
    getEffectiveProjectConfigPath,
    clearHistory,
  } = params
  const { t } = useI18n()

  async function loadProjectFromV2(): Promise<boolean> {
    try {
      const configPath = getEffectiveProjectConfigPath()
      const config = await getV2FullConfig(configPath, { inspect: true })
      projectName.value = config.manifest.project.name
      // isProjectLoaded 推迟到 hydration 完全成功后再设置（F7）
      lastFullValidationSummary.value = null
      lastFullValidationStatistics.value = null

      if (config.manifest.warnings && config.manifest.warnings.length > 0) {
        config.manifest.warnings.forEach((warning) => {
          toastWarning(warning)
        })
      }

      // 防御：manifest 的 schemas/constraints 可能为 undefined（最小/损坏项目），
      // 与下方 regex_nodes/transforms/templates 一致使用 ?.length || 0 守卫
      const totalSchemas = config.manifest.schemas?.length || 0
      const standaloneConstraints = config.manifest.constraints?.length || 0
      let inlineConstraints = 0
      const totalRegex = config.manifest.regex_nodes?.length || 0
      const totalTransforms = config.manifest.transforms?.length || 0
      // 模板实例数取自 template_instances（画布上的 templateInstance 节点），
      // templates 字段是模板定义列表，二者含义不同（见 ProjectManifestV2）。
      const totalTemplates = config.manifest.template_instances?.length || 0

      ;(config.manifest.schemas || []).forEach((s) => {
        const schema = config.schemas[s.id]
        if (schema && Array.isArray(schema.constraints)) {
          inlineConstraints += schema.constraints.length
        }
      })

      projectConfigStats.value = {
        schemaCount: totalSchemas,
        constraintCount: standaloneConstraints + inlineConstraints,
        constraintStandaloneCount: standaloneConstraints,
        constraintInlineCount: inlineConstraints,
        regexCount: totalRegex,
        transformCount: totalTransforms,
        templateCount: totalTemplates,
      }
      projectConfigStatsLoaded.value = true
      projectConfigStatsConfigPath.value = configPath || ''

      const nextNodes: CustomNode[] = []
      const nextEdges: Edge[] = []

      let view:
        | {
            nodes?: Record<string, { x: number; y: number }>
            nodeStates?: Record<string, { hidden?: boolean; expanded?: boolean }>
          }
        | undefined
      try {
        view = (await getV2ProjectView(configPath)) as typeof view
      } catch (e) {
        view = undefined
      }

      let consolePos = { x: 80, y: 80 }
      const savedConsolePos = view?.nodes?.['project-root'] || view?.nodes?.['project-console']
      if (
        savedConsolePos &&
        typeof savedConsolePos.x === 'number' &&
        typeof savedConsolePos.y === 'number'
      ) {
        consolePos = { x: savedConsolePos.x, y: savedConsolePos.y }
      }

      nextNodes.push({
        id: 'project-root',
        type: 'projectRoot',
        position: consolePos,
        draggable: false,
        data: {
          projectName: projectName.value,
          projectPath: configPath ?? '',
          configPath: configPath,
        },
      })

      // 恢复 templateInstance 节点（自包含 DAG 的视图容器）
      // 重载时统一重置为折叠态：展开子节点作为独立文件持久化，
      // 但不自动恢复到画布。用户需重新点击"展开"从模板定义生成新节点。
      const templateInstances = config.manifest.template_instances || []
      for (const ref of templateInstances) {
        const position = view?.nodes?.[ref.id] || { x: 300, y: 100 }
        nextNodes.push({
          id: ref.id,
          type: 'templateInstance',
          position,
          data: {
            configName: ref.id,
            templateId: ref.template_id,
            templateName: ref.template_id,
            enabled: ref.enabled !== false,
            expanded: false,
            nodeCount: 0,
            // 与 templateInstanceFactory 的新建默认一致（重载统一折叠态，未展开无摘要）
            summaryText: '',
            saveState: 'saved',
          },
        })
      }

      // 画布是用户的工作区，资源应从左侧资源树手动拖拽，加载时不自动水合。
      // 若需恢复上次画布状态，应在 saveProject 时保存 view.json 并在加载时恢复。
      if (view?.nodes) {
        nextNodes.forEach((n) => {
          const pos = view.nodes![n.id]
          if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            n.position = { x: pos.x, y: pos.y }
          }
        })
      }

      // 应用 view.json 中保存的节点 UI 状态（hidden）
      // 注意：expanded 状态不在重载时恢复——模板实例统一从折叠态开始，
      // 用户需重新展开。这避免"已展开但无子节点"的空容器问题。
      if (view?.nodeStates) {
        nextNodes.forEach((n) => {
          const state = view.nodeStates![n.id]
          if (!state) return
          if (typeof state.hidden === 'boolean') {
            n.hidden = state.hidden
          }
        })
      }

      // 向后兼容：将旧 projectConsole 节点迁移为 projectRoot
      const oldConsoleNode = nextNodes.find((n) => n.type === 'projectConsole')
      if (oldConsoleNode) {
        logger.debug('[loadProjectFromV2] 检测到旧 projectConsole 节点，迁移为 projectRoot')
        oldConsoleNode.type = 'projectRoot'
        oldConsoleNode.id = 'project-root'
        oldConsoleNode.draggable = false
      }

      // 默认显示所有节点，让用户自行决定是否需要折叠
      // 之前强制 hidden=true 导致用户每次打开项目都要手动显示节点（F8）
      // 若 view.json 中存在 hidden 状态，则在下文应用 view 时覆盖
      // 当前不做任何默认隐藏操作
      nodes.value = nextNodes
      edges.value = nextEdges
      selectedNodeId.value = null
      // 项目加载 = 画布上下文不可逆切换：清空撤销栈，
      // 防止 Ctrl+Z 把上一个项目的节点图恢复到当前画布
      clearHistory?.()

      // 注意：加载时不调用 saveProject。
      // AI 生成配置时 handleConflictConfirm 已用 putV2FullConfig 保存；常规加载时配置已存在于文件中。

      // 提示配置文件解析错误
      const schemaErrors = config.schema_errors
      if (schemaErrors && Object.keys(schemaErrors).length > 0) {
        const errorList = Object.entries(schemaErrors)
          .map(([id, msg]) => `${id}: ${msg}`)
          .join('\n')
        toastWarning(
          t('messages.persistence.configParseFailed', { list: errorList }),
          t('messages.persistence.configWarningTitle')
        )
      }

      // hydration 全部成功后再标记项目为已加载（F7）
      isProjectLoaded.value = true

      // 处理配置自检结果（写入 store，由 Header 徽章 + 抽屉展示）
      const inspection = config.inspection
      if (inspection) {
        const inspectionStore = useInspectionStore()
        inspectionStore.setResult(inspection, { autoOpen: 'if-blocker' })
        if (inspection.errors.length > 0) {
          logger.warn('[loadProjectFromV2] 配置自检发现 %d 个问题', inspection.errors.length)
        }
      }

      toastSuccess(
        t('messages.persistence.projectLoaded', { name: projectName.value }),
        t('messages.persistence.loadSuccess')
      )

      // 广播"画布内容加载完成"信号：画布侧（NodeCanvas 的加载适配）据此执行
      // 一次性自动取景与位置异常修复。加载路径（启动/切换/重载）统一走此出口。
      useCanvasStore().markContentLoaded()
      return true
    } catch (error) {
      // 项目路径不存在时提示用户（manifest 缺失或路径错误）
      if (error instanceof ProjectNotFoundError) {
        logger.debug('[loadProjectFromV2] 项目路径不存在，跳过加载:', error.configPath)
        toastError(
          t('messages.error.projectNotFound', { path: error.configPath || '' }),
          t('messages.persistence.loadFailed')
        )
        return false
      }
      logger.error('加载V2项目失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.persistence.loadFailed')
      )
      // 回滚加载状态，避免空画布+已加载UI（F7）
      isProjectLoaded.value = false
      projectName.value = ''
      return false
    }
  }

  return { loadProjectFromV2 }
}
