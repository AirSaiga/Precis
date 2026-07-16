/**
 * @file load.ts
 * @description V2 配置加载模块 - 负责从文件系统加载项目配置到画布
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. loadProjectFromV2: 加载完整的 V2 项目配置到画布
 *
 * ====================================================================
 * 加载流程
 * ====================================================================
 * 1. 获取配置路径（getEffectiveProjectConfigPath）
 * 2. 加载完整配置（getV2FullConfig）
 * 3. 加载视图位置（getV2ProjectView，可选）
 * 4. 更新项目元信息（projectName, isProjectLoaded）
 * 5. 更新统计信息（schemaCount, constraintCount, regexCount）
 * 6. 创建 ProjectRoot 节点
 * 7. 应用视图位置（若存在 view.json）
 * 注意：不再自动水合所有资源到画布，资源应从资源树手动拖拽
 *
 * ====================================================================
 * 水合（Hydration）概念
 * ====================================================================
 * 水合是将配置数据转换为画布节点的过程：
 * - hydrateSchemasFromV2Config: 将 schema 配置转换为 Schema 节点
 * - hydrateManifestConstraintsFromV2Config: 将约束配置转换为 Constraint 节点
 * - hydrateRegexNodesFromV2Config: 将正则配置转换为 Regex 节点
 *
 * ====================================================================
 * 节点可见性策略
 * ====================================================================
 * 【设计决策】：打开项目时隐藏所有节点，只保留 ProjectRoot 可见
 * - 原因：复杂项目可能有很多节点，全部显示会占用大量画布空间
 * - 用户可通过"聚焦项目"按钮显示所有节点
 * - 这样做可以提升大型项目的加载性能
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
 * - isProjectLoaded: 设为 true
 * - lastFullValidationSummary/Statistics: 重置为 null
 * - selectedNodeId: 重置为 null
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - 配置加载失败显示 toast 错误提示
 * - 清单警告信息（warnings）逐条显示
 * - 视图加载失败不阻止主流程（可选）
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 重置画布状态（nodes, edges）
 * - 更新多个响应式状态（projectName, isProjectLoaded 等）
 * - 显示 toast 通知
 * - 触发统计信息更新
 *
 * @module graphStore/modules/v2/persistence
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '@/api/projectValidationApi'
import type { ProjectConfigStats } from '../../../setup/state'
import { toastError, toastSuccess, toastWarning } from '@/core/toast'
import { useI18n } from 'vue-i18n'
import { useInspectionStore } from '@/stores/inspectionStore'
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
      const totalRegex =
        ((config.manifest as unknown as Record<string, unknown>).regex_nodes as unknown[])
          ?.length || 0
      const totalTransforms = config.manifest.transforms?.length || 0
      const totalTemplates = config.manifest.templates?.length || 0

      ;(config.manifest.schemas || []).forEach((s) => {
        const schema = config.schemas[s.id]
        if (schema && Array.isArray((schema as unknown as Record<string, unknown>).constraints)) {
          inlineConstraints += (
            (schema as unknown as Record<string, unknown>).constraints as unknown[]
          ).length
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
      const savedConsolePos =
        (view?.nodes as unknown as Record<string, unknown>)?.['project-root'] ||
        (view?.nodes as unknown as Record<string, unknown>)?.['project-console']
      if (
        savedConsolePos &&
        typeof (savedConsolePos as { x?: number; y?: number }).x === 'number' &&
        typeof (savedConsolePos as { x?: number; y?: number }).y === 'number'
      ) {
        consolePos = {
          x: (savedConsolePos as { x?: number; y?: number }).x!,
          y: (savedConsolePos as { x?: number; y?: number }).y!,
        }
      }

      nextNodes.push({
        id: 'project-root',
        type: 'projectRoot',
        position: consolePos,
        draggable: false,
        data: {
          projectName: projectName.value,
          projectPath: configPath,
          configPath: configPath,
        } as unknown as CustomNodeData,
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
            saveState: 'saved',
          } as unknown as CustomNodeData,
        })
      }

      // 画布是用户的工作区，资源应从左侧资源树手动拖拽，加载时不自动水合。
      // 若需恢复上次画布状态，应在 saveProject 时保存 view.json 并在加载时恢复。
      if (view?.nodes) {
        nextNodes.forEach((n) => {
          const pos = (view.nodes as unknown as Record<string, unknown>)[n.id] as
            | { x: number; y: number }
            | undefined
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
