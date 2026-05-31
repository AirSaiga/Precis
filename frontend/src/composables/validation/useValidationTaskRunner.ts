/**
 * @file useValidationTaskRunner.ts
 * @description 全量校验任务运行器组合式函数 - 管理数据质量校验的完整执行流程
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 该模块负责执行完整的数据质量校验流程，包括：
 * 1. 任务初始化 - 加载项目和配置信息
 * 2. 前置检查（Preflight）- 验证配置完整性和引用有效性
 * 3. 任务执行 - 调用后端 API 执行校验
 * 4. 结果处理 - 显示校验结果和统计信息
 *
 * ====================================================================
 * 校验目标类型
 * ====================================================================
 * 支持三种校验范围：
 * - full_project: 全量校验（整个项目）
 * - single_table: 单表校验（指定 Schema）
 * - single_file: 单文件校验（计划中，暂不支持）
 *
 * ====================================================================
 * 执行阶段（Task Stages）
 * ====================================================================
 * 1. load-settings: 加载项目校验设置
 * 2. save-project: 保存当前项目配置
 * 3. preflight: 前置检查（引用完整性检测）
 * 4. execute: 执行校验
 *
 * 每个阶段都有状态：pending/running/success/error/attention/skipped
 *
 * ====================================================================
 * 前置检查（Preflight）机制
 * ====================================================================
 * 检测配置中的引用完整性问题：
 * - missingConstraintRefs: 清单中缺失但实际存在的约束
 * - missingRegexRefs: 清单中缺失但实际存在的正则
 * - danglingConstraintRefs: 清单中引用但实际不存在的约束
 * - danglingRegexRefs: 清单中引用但实际不存在的正则
 *
 * 处理策略：
 * - ask: 询问用户是否合并缺失资源
 * - merge_then_run: 自动合并后运行
 * - run_directly: 直接运行（可能失败）
 *
 * ====================================================================
 * 任务请求构建
 * ====================================================================
 * buildTaskRequest 方法构建校验请求，包含：
 * - target: 校验目标（类型、ID、显示名称）
 * - run_options: 运行选项（校验设置、文件处理设置、脚本安全设置）
 * - preflight_options: 前置选项（是否保存、缺失资源策略）
 *
 * ====================================================================
 * 校验设置（Runtime Overrides）
 * ====================================================================
 * 支持在运行时覆盖项目的默认校验设置：
 * - strict_mode: 严格模式
 * - error_handling: 错误处理策略
 * - timeout_seconds: 超时时间
 * - batch_max_files: 批量最大文件数
 * - auto_validate: 自动校验
 *
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 使用 ref 管理响应式状态
 * - 使用 computed 计算派生状态
 * - 依赖多个 Store（graphStore, projectStore, settingsStore, validationTaskStore）
 * - 依赖后端 API 进行实际校验
 *
 * ====================================================================
 * 关键设计决策
 * ====================================================================
 * 1. 【保存策略】校验前可以选择是否保存项目
 *    - 目的：确保校验使用最新配置
 *    - 用户可选择跳过（用于测试场景）
 *
 * 2. 【合并确认】发现缺失资源时询问用户
 *    - 避免静默失败
 *    - 提供"合并后运行"选项简化操作
 *
 * 3. 【结果高亮】提取关键指标展示
 *    - files: 加载的文件统计
 *    - tables: 加载的表数量
 *    - errors: 错误总数
 *    - duration: 执行耗时
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - runTask 可能触发项目保存（saveProject）
 * - 校验结果更新 graphStore 的统计信息
 * - 可能显示 toast 通知（成功/警告）
 *
 * @module composables/validation
 */

import { logger } from '@/core/utils/logger'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@/composables/shared'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore, type ValidationSettings } from '@/stores/settingsStore'
import { useValidationTaskStore } from '@/stores/validationTaskStore'
import { getV2FullConfig, getV2Manifest, putV2Manifest } from '@/api/projectV2Api'
import {
  validateValidationTask,
  type FullValidationResponse,
  type ValidationTaskRequest,
} from '@/api/projectValidationApi'
import { saveValidationRun } from '@/api/validationHistoryApi'
import type { DataSourceRefV2, ProjectManifestV2, TableSchemaFileV2 } from '@/types/projectV2'
import { detectFileTypeFromPath } from '@/utils/fileTypeUtils'

type ValidationTaskStageKey = 'load-settings' | 'save-project' | 'preflight' | 'execute'
type ValidationTaskStageStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'attention'
  | 'skipped'

interface ValidationTaskStageItem {
  key: ValidationTaskStageKey
  label: string
  description: string
  status: ValidationTaskStageStatus
}

interface ValidationTaskTargetDescriptor {
  type: 'full_project' | 'single_table' | 'single_file'
  label: string
  description: string
  status: 'active' | 'available' | 'planned'
}

interface ValidationTaskTableOption {
  value: string
  label: string
  path?: string
  sourceType?: 'csv' | 'excel' | 'json' | 'unknown'
}

interface ValidationPreflightSummary {
  missingConstraintRefs: Array<{ id: string; path: string }>
  missingRegexRefs: Array<{ id: string; path: string }>
  danglingConstraintRefs: Array<{ id: string; path: string }>
  danglingRegexRefs: Array<{ id: string; path: string }>
}

const defaultPreflightSummary = (): ValidationPreflightSummary => ({
  missingConstraintRefs: [],
  missingRegexRefs: [],
  danglingConstraintRefs: [],
  danglingRegexRefs: [],
})

export function useValidationTaskRunner() {
  const { t } = useI18n()
  const { success, warning } = useToast()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
  const settingsStore = useSettingsStore()
  const validationTaskStore = useValidationTaskStore()

  const running = ref(false)
  const errorMessage = ref('')
  const result = ref<FullValidationResponse | null>(null)
  const manifest = ref<ProjectManifestV2 | null>(null)
  const schemaConfigs = ref<Record<string, TableSchemaFileV2>>({})
  const preflightSummary = ref<ValidationPreflightSummary>(defaultPreflightSummary())
  const saveBeforeRun = ref(true)
  const missingResourcesStrategy = ref<'ask' | 'merge_then_run' | 'run_directly'>('ask')
  const runtimeValidationSettings = ref<ValidationSettings>(
    settingsStore.getProjectValidationRunDefaults()
  )
  const pendingTaskRequest = ref<ValidationTaskRequest | null>(null)
  const showMergeConfirm = ref(false)

  // 执行进度跟踪
  const progress = ref(0)
  const processedStats = ref({
    filesLoaded: 0,
    filesTotal: 0,
    tablesLoaded: 0,
    tablesTotal: 0,
    errorsFound: 0,
  })

  const stageMeta: Array<Omit<ValidationTaskStageItem, 'status'>> = [
    {
      key: 'load-settings',
      label: t('common.fullValidation.task.stages.loadSettings'),
      description: t('common.fullValidation.task.stages.loadSettingsDesc'),
    },
    {
      key: 'save-project',
      label: t('common.fullValidation.task.stages.saveProject'),
      description: t('common.fullValidation.task.stages.saveProjectDesc'),
    },
    {
      key: 'preflight',
      label: t('common.fullValidation.task.stages.preflight'),
      description: t('common.fullValidation.task.stages.preflightDesc'),
    },
    {
      key: 'execute',
      label: t('common.fullValidation.task.stages.execute'),
      description: t('common.fullValidation.task.stages.executeDesc'),
    },
  ]

  const stageStatuses = ref<Record<ValidationTaskStageKey, ValidationTaskStageStatus>>({
    'load-settings': 'pending',
    'save-project': 'pending',
    preflight: 'pending',
    execute: 'pending',
  })

  const taskStages = computed<ValidationTaskStageItem[]>(() =>
    stageMeta.map((item) => ({
      ...item,
      status: stageStatuses.value[item.key],
    }))
  )

  const dataSources = computed<DataSourceRefV2[]>(() => manifest.value?.data_sources || [])
  const projectConfigPath = computed(() => projectStore.currentPaths?.configPath || '')

  const resolvedDataDirectoryLabel = computed(() => {
    const currentPath = projectStore.currentPaths?.configPath || ''
    if (dataSources.value.length === 0) {
      return currentPath || t('common.fullValidation.task.context.noProject')
    }

    const firstDataSource = dataSources.value[0]
    if (firstDataSource.mode === 'absolute') {
      return firstDataSource.path
    }

    return currentPath ? `${currentPath}/${firstDataSource.path}` : firstDataSource.path
  })

  const defaultValidationSettings = computed(() => settingsStore.projectValidationRunDefaults)
  const hasRuntimeOverrides = computed(() => {
    const current = runtimeValidationSettings.value
    const defaults = defaultValidationSettings.value

    return (
      current.strict_mode !== defaults.strict_mode ||
      current.error_handling !== defaults.error_handling ||
      current.timeout_seconds !== defaults.timeout_seconds ||
      current.batch_max_files !== defaults.batch_max_files ||
      current.auto_validate !== defaults.auto_validate
    )
  })

  const currentTargetLabel = computed(() => {
    const target = validationTaskStore.target
    if (target.type === 'single_table') {
      return target.display_name || t('common.fullValidation.task.targets.singleTable')
    }
    if (target.type === 'single_file') {
      return target.display_name || t('common.fullValidation.task.targets.singleFile')
    }
    return target.display_name || t('common.fullValidation.task.targets.fullProject')
  })

  const availableTableTargets = computed<ValidationTaskTableOption[]>(() => {
    const schemaRefs = manifest.value?.schemas || []

    return schemaRefs.map((item) => {
      // 优先使用 schema 配置文件中的 name 字段
      const schemaConfig = schemaConfigs.value[item.id]
      const displayName = schemaConfig?.name

      // 解析数据源类型
      const sourcePath = schemaConfig?.source?.path || ''
      const sourceType = detectFileTypeFromPath(sourcePath)

      // 如果没有 name，则回退到 graph node 的 tableName/configName
      if (!displayName) {
        const graphNode = graphStore.nodes.find((node) => node.id === item.id)
        const graphData = graphNode?.data as { tableName?: string; configName?: string } | undefined
        const fallbackName = graphData?.tableName || graphData?.configName
        if (fallbackName) {
          return {
            value: item.id,
            label: fallbackName,
            path: item.path,
            sourceType,
          }
        }
      }

      // 最终回退到 item.id
      return {
        value: item.id,
        label: displayName || item.id,
        path: item.path,
        sourceType,
      }
    })
  })

  const currentTableId = computed(() => {
    if (validationTaskStore.target.type !== 'single_table') return ''
    return validationTaskStore.target.table_id || ''
  })

  const targetDescriptors = computed<ValidationTaskTargetDescriptor[]>(() => [
    {
      type: 'full_project',
      label: t('common.fullValidation.task.targets.fullProject'),
      description: t('common.fullValidation.task.scope.fullProjectDesc'),
      status: validationTaskStore.target.type === 'full_project' ? 'active' : 'available',
    },
    {
      type: 'single_table',
      label: t('common.fullValidation.task.targets.singleTable'),
      description: t('common.fullValidation.task.scope.singleTableDesc'),
      status: validationTaskStore.target.type === 'single_table' ? 'active' : 'available',
    },
    {
      type: 'single_file',
      label: t('common.fullValidation.task.targets.singleFile'),
      description: t('common.fullValidation.task.scope.singleFileDesc'),
      status: validationTaskStore.target.type === 'single_file' ? 'active' : 'planned',
    },
  ])

  const preflightIssueCount = computed(() => {
    const summary = preflightSummary.value
    return (
      summary.missingConstraintRefs.length +
      summary.missingRegexRefs.length +
      summary.danglingConstraintRefs.length +
      summary.danglingRegexRefs.length
    )
  })

  const preflightStatusTone = computed<'success' | 'warning' | 'danger'>(() => {
    if (!projectStore.isProjectActive) return 'danger'
    if (preflightIssueCount.value > 0) return 'warning'
    return 'success'
  })

  const resultHighlights = computed(() => {
    if (!result.value) return []

    return [
      {
        key: 'files',
        label: t('common.fullValidation.report.loadedFiles'),
        value: `${result.value.summary.files_loaded}/${result.value.summary.files_total}`,
      },
      {
        key: 'tables',
        label: t('common.fullValidation.report.tablesLoaded'),
        value: String(result.value.summary.tables_loaded),
      },
      {
        key: 'errors',
        label: t('common.fullValidation.result.total'),
        value: String(result.value.summary.total_error_count),
      },
      {
        key: 'duration',
        label: t('common.fullValidation.result.duration'),
        value: `${result.value.summary.duration_ms}ms`,
      },
    ]
  })

  const failedPreviewItems = computed(() => {
    if (!result.value) return []
    return result.value.errors.slice(0, 6)
  })

  /**
   * 重置所有阶段状态为 pending
   * 在启动新校验任务前调用，清除上一轮的状态残留
   */
  function resetStageStatuses(): void {
    stageStatuses.value = {
      'load-settings': 'pending',
      'save-project': 'pending',
      preflight: 'pending',
      execute: 'pending',
    }
  }

  /**
   * 设置指定阶段的运行状态
   * @param key - 阶段标识
   * @param status - 目标状态
   */
  function setStageStatus(key: ValidationTaskStageKey, status: ValidationTaskStageStatus): void {
    stageStatuses.value = {
      ...stageStatuses.value,
      [key]: status,
    }
  }

  /**
   * 重置运行时校验设置为项目默认值
   * 取消用户在校验面板中的所有临时覆盖
   */
  function resetRuntimeOverrides(): void {
    runtimeValidationSettings.value = settingsStore.getProjectValidationRunDefaults()
  }

  /**
   * 确保单表校验目标指向有效的表
   * 如果当前选中的表已不在可用列表中，自动回退到第一张表
   */
  function ensureSingleTableTarget(): void {
    if (availableTableTargets.value.length === 0) return
    if (validationTaskStore.target.type !== 'single_table') return

    const current = validationTaskStore.target.table_id
    const matched = availableTableTargets.value.find((item) => item.value === current)
    if (matched) return

    const fallback = availableTableTargets.value[0]
    validationTaskStore.openSingleTable(fallback.value, fallback.label)
  }

  /**
   * 刷新运行前检查数据
   * 拉取最新的 manifest 和完整配置，检测缺失/悬空引用
   */
  async function refreshPreflight(): Promise<void> {
    if (!projectStore.currentPaths?.configPath) {
      manifest.value = null
      preflightSummary.value = defaultPreflightSummary()
      return
    }

    try {
      const [nextManifest, fullConfig] = await Promise.all([
        getV2Manifest(),
        getV2FullConfig(projectStore.currentPaths.configPath),
      ])

      manifest.value = nextManifest
      schemaConfigs.value = fullConfig.schemas || {}
      preflightSummary.value = {
        missingConstraintRefs: fullConfig.coverage?.unlisted?.constraints || [],
        missingRegexRefs: fullConfig.coverage?.unlisted?.regex_nodes || [],
        danglingConstraintRefs: fullConfig.coverage?.dangling?.constraints || [],
        danglingRegexRefs: fullConfig.coverage?.dangling?.regex_nodes || [],
      }
    } catch (error) {
      logger.warn('[ValidationTask] 运行前检查刷新失败:', error)
      preflightSummary.value = defaultPreflightSummary()
    }
  }

  /**
   * 初始化校验任务面板
   * 加载项目设置、刷新 preflight、确保单表目标有效
   */
  async function initializeTask(): Promise<void> {
    errorMessage.value = ''
    pendingTaskRequest.value = null
    showMergeConfirm.value = false

    if (projectStore.currentPaths?.configPath) {
      await settingsStore.loadProjectSettings().catch(() => undefined)
      resetRuntimeOverrides()
      await refreshPreflight()
      ensureSingleTableTarget()
      return
    }

    manifest.value = null
    schemaConfigs.value = {}
    preflightSummary.value = defaultPreflightSummary()
    resetRuntimeOverrides()
  }

  /**
   * 选择校验目标类型
   * @param type - 目标类型：全项目 / 单表 / 单文件
   */
  function selectTargetType(type: 'full_project' | 'single_table' | 'single_file'): void {
    if (type === 'full_project') {
      validationTaskStore.openFullProject()
      return
    }

    if (type === 'single_table') {
      const firstTable = availableTableTargets.value[0]
      if (!firstTable) {
        errorMessage.value = t('common.fullValidation.task.scope.singleTableUnavailable')
        return
      }

      const current = availableTableTargets.value.find(
        (item) => item.value === currentTableId.value
      )
      validationTaskStore.openSingleTable(
        (current || firstTable).value,
        (current || firstTable).label
      )
      return
    }

    errorMessage.value = t('common.fullValidation.task.unsupportedTarget')
  }

  /**
   * 选择单表校验的目标表
   * @param tableId - 表 ID
   */
  function selectTableTarget(tableId: string): void {
    const matched = availableTableTargets.value.find((item) => item.value === tableId)
    if (!matched) return
    validationTaskStore.openSingleTable(matched.value, matched.label)
  }

  /**
   * 构建后端校验任务请求体
   * 整合目标配置、运行时覆盖设置和前置选项
   * @returns 校验任务请求对象
   */
  function buildTaskRequest(): ValidationTaskRequest {
    const target =
      validationTaskStore.target.type === 'single_table'
        ? {
            ...validationTaskStore.target,
            table_id: currentTableId.value || validationTaskStore.target.table_id || null,
          }
        : { ...validationTaskStore.target }

    return {
      target,
      run_options: {
        override_settings: {
          validation: { ...runtimeValidationSettings.value },
          file_processing: { ...settingsStore.fileProcessingSettings },
          script_security: { ...settingsStore.scriptSecuritySettings },
        },
      },
      preflight_options: {
        save_before_run: saveBeforeRun.value,
        missing_resources_strategy: missingResourcesStrategy.value,
      },
    }
  }

  /**
   * 合并缺失的资源引用到 manifest
   * 将 preflight 发现的缺失约束和正则节点自动补录到清单中
   * @returns 合并是否成功
   */
  async function mergeMissingResources(): Promise<boolean> {
    if (!manifest.value) return true

    const currentConstraints = manifest.value.constraints || []
    const currentRegexNodes = manifest.value.regex_nodes || []
    const constraintSet = new Set(currentConstraints.map((item) => item.id))
    const regexSet = new Set(currentRegexNodes.map((item) => item.id))

    const constraintsToAdd = preflightSummary.value.missingConstraintRefs.filter(
      (item) => !constraintSet.has(item.id)
    )
    const regexToAdd = preflightSummary.value.missingRegexRefs.filter(
      (item) => !regexSet.has(item.id)
    )

    if (constraintsToAdd.length === 0 && regexToAdd.length === 0) {
      return true
    }

    try {
      await putV2Manifest({
        ...manifest.value,
        constraints: [...currentConstraints, ...constraintsToAdd],
        regex_nodes: [...currentRegexNodes, ...regexToAdd],
      })

      success(
        t('common.fullValidation.mergeConstraints.successTitle'),
        t('common.fullValidation.mergeConstraints.successDesc', {
          count: constraintsToAdd.length + regexToAdd.length,
        })
      )

      await refreshPreflight()
      return true
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  /**
   * 执行校验任务
   * 调用后端 API，处理成功/失败/异常各终态，并更新 Store 统计信息
   * @param request - 校验任务请求
   */
  async function executeTask(request: ValidationTaskRequest): Promise<void> {
    setStageStatus('execute', 'running')

    try {
      const response = await validateValidationTask(request)
      result.value = response
      graphStore.setLastFullValidationSummary(response.summary)
      graphStore.setLastFullValidationStatistics(response.statistics || null)

      // 自动保存校验结果到历史（fire-and-forget，不阻塞 UI 通知）
      const projectPath = projectStore.currentPaths?.configPath

      if (response.error) {
        errorMessage.value = response.error
        warning(t('common.fullValidation.result.toastFail'), t('common.fullValidation.result.fail'))
      } else if (response.success) {
        success(t('common.fullValidation.result.toastPass'), t('common.fullValidation.result.pass'))
      } else {
        warning(t('common.fullValidation.result.toastFail'), t('common.fullValidation.result.fail'))
      }

      if (projectPath && response.summary) {
        const summaryWithPassRate = {
          ...response.summary,
          pass_rate: response.statistics?.pass_rate ?? 0,
          passed_count: response.statistics?.passed_count ?? 0,
          failed_count: response.statistics?.failed_count ?? 0,
          total_checks: response.statistics?.total_checks ?? 0,
        }
        saveValidationRun(projectPath, {
          duration_ms: response.summary.duration_ms ?? 0,
          summary: summaryWithPassRate as unknown as Record<string, unknown>,
          by_type: (response.statistics?.by_type ?? {}) as Record<string, Record<string, number>>,
          by_table: (response.statistics?.by_table ?? {}) as Record<string, Record<string, number>>,
          errors: (response.errors ?? []).map((e: any) => ({
            stage: e.stage ?? '',
            error_type: e.error_type ?? '',
            check_type: e.check_type ?? '',
            message: e.message ?? '',
            table: e.table ?? '',
            column: e.column ?? '',
            row_index: e.row_index,
            value: e.value ?? '',
          })),
          warnings: response.warnings ?? [],
        })
          .then(() => logger.debug('[ValidationTaskRunner] 校验结果已保存到历史'))
          .catch((histErr) =>
            logger.warn('[ValidationTaskRunner] 保存校验历史失败（不影响校验结果）:', histErr)
          )
      }

      // 更新进度和统计
      progress.value = 100
      processedStats.value = {
        filesLoaded: response.summary.files_loaded,
        filesTotal: response.summary.files_total,
        tablesLoaded: response.summary.tables_loaded,
        tablesTotal: manifest.value?.schemas?.length || response.summary.tables_loaded,
        errorsFound: response.summary.total_error_count,
      }

      setStageStatus('execute', 'success')
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
      setStageStatus('execute', 'error')
    }
  }

  /**
   * 运行完整校验任务流程
   *
   * 按顺序执行：加载设置 → 保存项目 → 运行前检查 → 执行校验。
   * 若发现缺失资源且策略为 ask，则暂停等待用户确认。
   */
  async function runTask(): Promise<void> {
    errorMessage.value = ''
    result.value = null
    resetStageStatuses()

    if (!projectStore.isProjectActive || !projectStore.currentPaths?.configPath) {
      errorMessage.value = t('common.fullValidation.project.missingConfigPath')
      setStageStatus('preflight', 'error')
      return
    }

    if (validationTaskStore.target.type === 'single_file') {
      errorMessage.value = t('common.fullValidation.task.unsupportedTarget')
      setStageStatus('execute', 'error')
      return
    }

    if (validationTaskStore.target.type === 'single_table' && !currentTableId.value) {
      errorMessage.value = t('common.fullValidation.task.scope.singleTableUnavailable')
      setStageStatus('execute', 'error')
      return
    }

    running.value = true
    progress.value = 0
    processedStats.value = { filesLoaded: 0, filesTotal: 0, tablesLoaded: 0, tablesTotal: 0, errorsFound: 0 }

    try {
      setStageStatus('load-settings', 'running')
      progress.value = 5
      await settingsStore.loadProjectSettings()
      setStageStatus('load-settings', 'success')
      progress.value = 10

      const request = buildTaskRequest()

      if (request.preflight_options?.save_before_run) {
        setStageStatus('save-project', 'running')
        const saved = await graphStore.saveProject()
        if (!saved) {
          errorMessage.value = t('common.fullValidation.run.saveFailed')
          setStageStatus('save-project', 'error')
          return
        }
        setStageStatus('save-project', 'success')
      } else {
        setStageStatus('save-project', 'skipped')
      }

      setStageStatus('preflight', 'running')
      await refreshPreflight()

      const hasMissingResources =
        preflightSummary.value.missingConstraintRefs.length > 0 ||
        preflightSummary.value.missingRegexRefs.length > 0

      if (hasMissingResources) {
        const strategy = request.preflight_options?.missing_resources_strategy || 'ask'
        if (strategy === 'ask') {
          pendingTaskRequest.value = request
          showMergeConfirm.value = true
          setStageStatus('preflight', 'attention')
          return
        }

        if (strategy === 'merge_then_run') {
          const merged = await mergeMissingResources()
          if (!merged) {
            setStageStatus('preflight', 'error')
            return
          }
        }
      }

      setStageStatus('preflight', 'success')
      progress.value = 25
      await executeTask(request)
    } finally {
      running.value = false
    }
  }

  /**
   * 用户确认合并缺失资源后继续运行校验
   * 先执行 mergeMissingResources，成功后继续执行 pending 的校验任务
   */
  async function confirmMergeAndRun(): Promise<void> {
    showMergeConfirm.value = false
    errorMessage.value = ''
    result.value = null
    running.value = true

    try {
      const merged = await mergeMissingResources()
      if (!merged) {
        setStageStatus('preflight', 'error')
        return
      }

      setStageStatus('preflight', 'success')
      if (pendingTaskRequest.value) {
        await executeTask(pendingTaskRequest.value)
      }
    } finally {
      pendingTaskRequest.value = null
      running.value = false
    }
  }

  /**
   * 直接运行校验（跳过缺失资源合并）
   * 用于用户选择"直接运行"策略时的执行路径
   */
  async function runDirectly(): Promise<void> {
    showMergeConfirm.value = false
    errorMessage.value = ''
    result.value = null
    running.value = true

    try {
      setStageStatus('preflight', 'attention')
      if (pendingTaskRequest.value) {
        await executeTask(pendingTaskRequest.value)
      }
    } finally {
      pendingTaskRequest.value = null
      running.value = false
    }
  }

  /**
   * 取消合并确认对话框
   * 清理 pending 状态并停止运行标记
   */
  function cancelMergePrompt(): void {
    showMergeConfirm.value = false
    pendingTaskRequest.value = null
    running.value = false
  }

  /**
   * 仅保存项目，不执行校验
   * 用于校验面板中的独立保存操作
   */
  async function saveProjectOnly(): Promise<void> {
    errorMessage.value = ''
    const saved = await graphStore.saveProject()
    if (!saved) {
      errorMessage.value = t('common.fullValidation.run.saveFailed')
    }
  }

  return {
    running,
    errorMessage,
    result,
    manifest,
    dataSources,
    projectConfigPath,
    resolvedDataDirectoryLabel,
    saveBeforeRun,
    missingResourcesStrategy,
    runtimeValidationSettings,
    defaultValidationSettings,
    hasRuntimeOverrides,
    taskStages,
    preflightSummary,
    preflightIssueCount,
    preflightStatusTone,
    currentTargetLabel,
    currentTableId,
    targetDescriptors,
    availableTableTargets,
    failedPreviewItems,
    resultHighlights,
    showMergeConfirm,
    progress,
    processedStats,
    initializeTask,
    refreshPreflight,
    resetRuntimeOverrides,
    selectTargetType,
    selectTableTarget,
    runTask,
    saveProjectOnly,
    confirmMergeAndRun,
    runDirectly,
    cancelMergePrompt,
  }
}

export default useValidationTaskRunner
