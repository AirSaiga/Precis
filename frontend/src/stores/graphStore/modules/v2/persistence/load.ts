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
import { toastError, toastSuccess, toastWarning } from '@/core/toast'
import { useI18n } from 'vue-i18n'
import { getV2FullConfig, getV2ProjectView, ProjectNotFoundError } from '@/api/projectV2Api'
// Hydration imports retained for potential future use (e.g. restoring saved canvas state)
// import { hydrateSchemasFromV2Config } from './load/hydrateSchemas'
// import { hydrateManifestConstraintsFromV2Config } from './load/hydrateConstraints'
// import { hydrateRegexNodesFromV2Config } from './load/hydrateRegex'
// import { hydrateTransformNodesFromV2Config } from './load/hydrateTransforms'

export function createV2LoadOps(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  projectName: Ref<string>
  isProjectLoaded: Ref<boolean>
  projectConfigStats: Ref<{
    schemaCount: number
    constraintCount: number
    regexCount: number
    transformCount: number
    templateCount: number
  }>
  projectConfigStatsLoaded: Ref<boolean>
  projectConfigStatsConfigPath: Ref<string>
  lastFullValidationSummary: Ref<FullValidationSummary | null>
  lastFullValidationStatistics: Ref<ValidationStatistics | null>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  saveProject: () => Promise<boolean>
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
    resolveProjectRelativePath,
    saveProject,
  } = params
  const { t } = useI18n()

  async function loadProjectFromV2(): Promise<boolean> {
    try {
      const configPath = getEffectiveProjectConfigPath()
      const config = await getV2FullConfig(configPath)
      projectName.value = config.manifest.project.name
      // isProjectLoaded 推迟到 hydration 完全成功后再设置（F7）
      lastFullValidationSummary.value = null
      lastFullValidationStatistics.value = null

      if (config.manifest.warnings && config.manifest.warnings.length > 0) {
        config.manifest.warnings.forEach((warning) => {
          toastWarning(warning)
        })
      }

      const totalSchemas = config.manifest.schemas.length
      let totalConstraints = config.manifest.constraints.length
      const totalRegex =
        ((config.manifest as unknown as Record<string, unknown>).regex_nodes as unknown[])
          ?.length || 0
      const totalTransforms = config.manifest.transforms?.length || 0
      const totalTemplates = config.manifest.templates?.length || 0

      config.manifest.schemas.forEach((s) => {
        const schema = config.schemas[s.id]
        if (schema && Array.isArray((schema as unknown as Record<string, unknown>).constraints)) {
          totalConstraints += (
            (schema as unknown as Record<string, unknown>).constraints as unknown[]
          ).length
        }
      })

      projectConfigStats.value = {
        schemaCount: totalSchemas,
        constraintCount: totalConstraints,
        regexCount: totalRegex,
        transformCount: totalTransforms,
        templateCount: totalTemplates,
      }
      projectConfigStatsLoaded.value = true
      projectConfigStatsConfigPath.value = configPath || ''

      const nextNodes: CustomNode[] = []
      const nextEdges: Edge[] = []

      let view: { nodes?: Record<string, { x: number; y: number }> } | undefined
      try {
        view = await getV2ProjectView(configPath)
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

      // 模板实例节点不在加载时自动恢复到画布。
      // 画布是用户的工作区，模板实例应由用户主动从资源树拖入或展开。
      // 模板实例的元数据（template_instances）仍保留在 manifest 中，由 save 流程维护。

      // 注意：不再自动水合所有资源到画布。
      // 画布是用户的工作区，资源应从左侧资源树手动拖拽。
      // 若需恢复上次画布状态，应在 saveProject 时保存 view.json 并在加载时恢复。
      //
      // const schemaHydration = hydrateSchemasFromV2Config({ config, getEffectiveProjectConfigPath, resolveProjectRelativePath })
      // nextNodes.push(...schemaHydration.nodes)
      // nextEdges.push(...schemaHydration.edges)
      //
      // const constraintHydration = hydrateManifestConstraintsFromV2Config({ config, existingNodes: nextNodes })
      // nextNodes.push(...constraintHydration.nodes)
      // nextEdges.push(...constraintHydration.edges)
      //
      // const regexHydration = hydrateRegexNodesFromV2Config({ config, existingNodes: nextNodes })
      // nextNodes.push(...regexHydration.nodes)
      // nextEdges.push(...regexHydration.edges)
      //
      // const transformHydration = hydrateTransformNodesFromV2Config({ config, existingNodes: nextNodes })
      // nextNodes.push(...transformHydration.nodes)
      // nextEdges.push(...transformHydration.edges)

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

      // 注意：这里不再调用 saveProject，因为：
      // 1. AI 生成配置时，handleConflictConfirm 已经用 putV2FullConfig 保存了配置
      // 2. 常规加载时，配置已经存在于文件中，不需要重新保存
      // 如果需要强制保存，应该在业务逻辑中显式调用
      /*
      if (
        config.manifest.schemas.length > 0 ||
        config.manifest.constraints.length > 0 ||
        (((config.manifest as unknown) as Record<string, unknown>).regex_nodes as unknown[])?.length || 0 > 0
      ) {
        logger.debug('[loadProjectFromV2] 检测到 schema/constraint/regex 数据，调用 saveProject 保存 manifest')
        await saveProject()
      } else {
        logger.debug('[loadProjectFromV2] 没有 schema/constraint/regex 数据，跳过保存')
      }
      */

      // 提示配置文件解析错误
      const schemaErrors = config.schema_errors
      if (schemaErrors && Object.keys(schemaErrors).length > 0) {
        const errorList = Object.entries(schemaErrors)
          .map(([id, msg]) => `${id}: ${msg}`)
          .join('\n')
        toastWarning(`部分配置文件解析失败，已跳过:\n${errorList}`, '配置警告')
      }

      // hydration 全部成功后再标记项目为已加载（F7）
      isProjectLoaded.value = true

      toastSuccess(`V2 项目 "${projectName.value}" 已载入`, '加载成功')
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
