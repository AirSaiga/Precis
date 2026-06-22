/**
 * @file useSchemaConnectionHandler.ts
 * @description Schema 节点连接事件处理器
 *
 * 功能概述：
 * - 处理 SourcePreview 到 Schema 节点的连接事件
 * - 同步数据源元数据并断开旧连接
 * - 绑定数据源时尝试加载已有 V2 配置（恢复列定义 + 物化内嵌约束）
 * - 未找到配置时回退到智能列填充询问与自动生成列定义
 * - 管理虚拟锚点边的同步与滚动状态监听
 */

import { logger } from '@/core/utils/logger'
import { nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import type { Node, Edge } from '@vue-flow/core'
import type { SchemaColumn, SchemaNodeData } from '@/types/graph'
import type { TableSchemaFileV2 } from '@/types/projectV2'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { extractColumnNamesFromHeader, compareColumns } from '@/utils/nodes/schema/columnValidation'
import { useToast } from '@/composables/shared/useToast'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { getV2FullConfig } from '@/api/projectV2Api'
import { fromBackendType } from '@/services/builders'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'
import { eventBus } from '@/core/eventBus'
import { i18n } from '@/i18n'
import { useVirtualAnchorEdges } from './useVirtualAnchorEdges'
import { toastWarning } from '@/core/toast'

function convertColumnsFromConfig(columns: TableSchemaFileV2['columns']): SchemaColumn[] {
  return (columns || []).map((col) => ({
    id: col.id,
    columnName: col.name,
    dataType: fromBackendType(col.type),
    validationErrors: [],
    constraints: {},
  }))
}

function findMatchingSchema(
  schemas: Record<string, TableSchemaFileV2>,
  localPath: string,
  sheetName: string | undefined | null,
  configDir: string
): { id: string; schema: TableSchemaFileV2 } | null {
  const normLocal = normalizePath(localPath)
  const normSheet = (sheetName || '').trim().toLowerCase()

  // 第一轮：精确匹配（路径 + sheet）
  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    const normAbs = normalizePath(absPath)
    if (normAbs !== normLocal) continue

    const isExcel = /\.(xlsx|xls)$/i.test(srcPath)
    if (isExcel) {
      const schemaSheet = (schema.source?.sheet ?? schema.sheet ?? '').trim().toLowerCase()
      if (schemaSheet === normSheet) return { id, schema }
    } else {
      return { id, schema }
    }
  }

  // 第二轮：模糊匹配（仅路径，忽略 sheet，针对 Excel schema）
  // 用于处理以下场景：
  // 1. schema 配置中未明确指定 sheet 名称
  // 2. sourcePreview 的 currentSheet 为空，但 schema 配置中有 sheet 名称
  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue
    if (!/\.(xlsx|xls)$/i.test(srcPath)) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    const normAbs = normalizePath(absPath)
    if (normAbs !== normLocal) continue

    const schemaSheet = (schema.source?.sheet ?? schema.sheet ?? '').trim()
    // 接受未指定 sheet 的 schema，或当传入的 sheetName 为空时接受任何 sheet
    if (!schemaSheet || !sheetName) return { id, schema }
  }

  return null
}

async function tryLoadExistingSchemaConfig(params: {
  schemaNodeId: string
  localPath: string | undefined
  sheetName: string | undefined | null
  configPath: string | undefined
  store: ReturnType<typeof useGraphStore>
  updateNodeInternals: (nodeIds?: string[]) => void
}): Promise<boolean> {
  const { schemaNodeId, localPath, sheetName, configPath, store, updateNodeInternals } = params

  if (!localPath || !configPath) return false

  const resolvedLocalPath = resolveRelativePath(localPath, configPath) ?? localPath

  let fullConfig: Awaited<ReturnType<typeof getV2FullConfig>>
  try {
    fullConfig = await getV2FullConfig(configPath)
  } catch {
    logger.debug('🔌 [tryLoadExistingSchemaConfig] 无法加载 V2 配置')
    return false
  }

  const schemas = fullConfig.schemas || {}
  const match = findMatchingSchema(schemas, resolvedLocalPath, sheetName, configPath)
  if (!match) {
    logger.debug(
      `🔌 [tryLoadExistingSchemaConfig] 未找到匹配的 schema (localPath=${localPath}, sheet=${sheetName})`
    )
    return false
  }

  const { id: tableId, schema: schemaFile } = match
  const cols = convertColumnsFromConfig(schemaFile.columns || [])

  store.updateNodeData(schemaNodeId, {
    columns: cols,
    saveState: 'saved',
  } as unknown as Record<string, unknown>)

  if (schemaNodeId !== tableId) {
    // 语义化 ID 方案：绑定后发现节点 ID 与文件 ID 不一致，
    // 说明是旧项目/旧数据，用 tableId 作为新节点 ID 保持一致性
    store.updateNodeData(schemaNodeId, {
      configName: tableId,
      saveState: 'modified',
    } as unknown as Record<string, unknown>)
    logger.warn(
      `[tryLoadExistingSchemaConfig] schema node ID ${schemaNodeId} differs from file ID ${tableId}, ` +
        `please resave project to align IDs.`
    )
  }

  // 检测重复数据源（绑定已有配置时）
  const sourcePath = schemaFile.source?.path
  const sourceSheet = schemaFile.source?.sheet ?? schemaFile.sheet
  if (
    sourcePath &&
    store.schemaSourceIndex?.isDuplicateSource(sourcePath, sourceSheet, schemaNodeId)
  ) {
    const conflict = store.schemaSourceIndex.getConflictForSource(
      sourcePath,
      sourceSheet,
      schemaNodeId
    )
    const otherIds = conflict?.nodeIds.filter((id) => id !== schemaNodeId) || []
    toastWarning(
      i18n.global.t('canvas.nodeCanvas.duplicateSourceMessage', {
        source: sourcePath,
        nodes: otherIds.join(', '),
      }),
      i18n.global.t('canvas.nodeCanvas.duplicateSourceTitle')
    )
  }
  store.schemaSourceIndex?.rebuild()

  // 列数据更新后必须刷新 schema 节点的 internals，
  // 否则 handle 不会重新生成，后续创建的边无法找到正确的 sourceHandle
  await nextTick()
  updateNodeInternals([schemaNodeId])

  const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
  if (!schemaNode) return true

  const schemaData = schemaNode.data as SchemaNodeData
  const colNameToId = new Map<string, string>(
    (schemaData.columns || []).map((c) => [c.columnName, c.id])
  )
  const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []

  if (embedded.length > 0) {
    const bufferedEdges: Array<{
      tableId: string
      constraintId: string
      columnId: string
    }> = []

    materializeV2EmbeddedConstraints({
      schemaNode: schemaNode as unknown as import('@/types/graph').CustomNode,
      schemaTableName: schemaData.tableName,
      embeddedConstraints: embedded as Parameters<
        typeof materializeV2EmbeddedConstraints
      >[0]['embeddedConstraints'],
      colNameToId,
      hasNode: (id: string) => store.nodes.some((n) => n.id === id),
      addNode: (node: import('@/types/graph').CustomNode) => addNodes(node),
      addConstraintEdge: (tId: string, cId: string, colId: string) => {
        bufferedEdges.push({ tableId: tId, constraintId: cId, columnId: colId })
      },
    })

    await nextTick()
    updateNodeInternals([schemaNodeId])
    for (const edge of bufferedEdges) {
      store.createConnection(
        edge.tableId,
        edge.constraintId,
        `source-right-${edge.columnId}`,
        `target-input-${edge.constraintId}`
      )
    }
  }

  logger.debug(
    `🔌 [tryLoadExistingSchemaConfig] 已从 V2 配置恢复 schema: ${cols.length} 列, ${embedded.length} 内嵌约束 (tableId=${tableId})`
  )
  return true
}

/**
 * Schema 节点连接事件处理器
 * 专门处理 SourcePreview（数据源预览）→ Schema（表）节点的全局连接事件
 * 负责响应连线动作，处理数据同步和智能填充等功能
 */
export function useSchemaConnectionHandler() {
  // 国际化支持
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const toast = useToast()
  const success = toast.success
  const showError = toast.error
  const info = toast.info

  // 从 VueFlow 获取边的操作方法
  // getConnectedEdges: 获取连接指定节点的边
  // updateNodeInternals: 更新节点内部状态（重新生成 handle）
  const { getConnectedEdges, updateNodeInternals } = useVueFlow()
  // 获取全局图存储，用于访问和修改节点/边数据
  const store = useGraphStore()

  // 处理 SourcePreview 节点到 Schema 节点的连接
  // 这是数据源与表建立关联的核心方法
  //
  // 处理流程详细说明：
  // 1. 【断开旧连接】一个 Schema 只能连接一个数据源，如果之前连接了其他源，必须先断开。
  // 2. 【更新元数据】将数据源的文件名、路径、Sheet名等信息同步到 Schema 节点上。
  // 3. 【状态反馈】显示 Toast 提示连接成功，并在源节点上标记"已连接"。
  // 4. 【智能填充】延迟触发对话框，询问用户是否自动生成列定义。
  //
  // 注意：由于预览文件现在存储在 IndexedDB 中，filePath 存储的是 fileId 而非文件路径
  // @param sourcePreviewNodeId - 数据源预览节点 ID
  // @param schemaNodeId - Schema 节点 ID
  const handleSourceToSchemaConnection = async (
    sourcePreviewNodeId: string,
    schemaNodeId: string
  ) => {
    const sourcePreviewNode = store.nodes.find((n) => n.id === sourcePreviewNodeId)
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!sourcePreviewNode || !schemaNode) return

    try {
      // 记录方法开始执行的日志
      logger.debug('🔌 [handleSourceToSchemaConnection] 开始处理连接')
      // 输出当前 Schema 节点的列定义数量，用于调试
      logger.debug(
        '  - schemaNode 当前列定义数量:',
        ((schemaNode?.data as Record<string, unknown>)?.columns as unknown[])?.length || 0
      )
      logger.debug(
        '  - schemaNode 当前列定义:',
        (schemaNode?.data as Record<string, unknown>)?.columns
      )

      // ========== 步骤 0：检查是否需要断开旧的数据源连接 ==========
      // 一个 SchemaNode 只能连接一个 SourcePreviewNode，如果已有连接则需要断开

      // 从源节点中提取数据源数据
      const sourceData = sourcePreviewNode.data as Record<string, unknown>

      // 查找目标 SchemaNode 是否已有来自其他 SourcePreviewNode 的连接
      const existingEdges = store.edges.filter(
        (edge) =>
          edge.target === schemaNodeId &&
          edge.source !== sourcePreviewNodeId &&
          store.nodes.find((n) => n.id === edge.source)?.type === 'sourcePreview'
      )

      // 如果存在旧连接，需要先断开
      if (existingEdges.length > 0) {
        logger.debug(`🔄 断开目标SchemaNode的旧数据源连接，数量: ${existingEdges.length}`)

        // 遍历所有旧连接并删除
        for (const edge of existingEdges) {
          const oldSourceNode = store.nodes.find((n) => n.id === edge.source)
          if (oldSourceNode) {
            logger.debug(
              `  - 断开与 "${(oldSourceNode.data as Record<string, unknown>)?.sourceName || (oldSourceNode.data as Record<string, unknown>)?.fileName || oldSourceNode.id}" 的连接`
            )
          }
          store.deleteConnection(edge.id)
        }

        // 显示提示消息，告知用户已断开旧连接
        const displayFileName =
          (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'
        info(t('canvas.nodeCanvas.disconnectedOldSource', { sourceName: displayFileName }))
      }

      // ========== 步骤 1：更新 SchemaNode 的数据源信息 ==========
      // 记录更新前的列定义数量
      logger.debug('🔌 [handleSourceToSchemaConnection] 准备更新 SchemaNode 数据')
      logger.debug(
        '  - 更新前列定义数量:',
        ((schemaNode?.data as Record<string, unknown>)?.columns as unknown[])?.length || 0
      )

      // 获取显示用的文件名（人类可读的名称）
      const displayFileName =
        (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'

      // 生成表名
      const smartTableName =
        (sourceData.currentSheet as string) ||
        ((sourceData.sourceName as string) || (sourceData.fileName as string) || 'Table').replace(
          /\.[^/.]+$/,
          ''
        )

      // 来源路径（用于 schema 节点显示）
      const displaySourcePath = (sourceData.fileName as string) || displayFileName

      // 构建要更新的 Schema 节点数据对象
      const updatedSchemaData = {
        ...schemaNode.data,
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: displaySourcePath,
        sourceType: sourceData.sourceType,
        headerRow: (sourceData.headerRow as number) || 0,
        sheetName: (sourceData.currentSheet as string) || undefined,
        sourceNodeId: sourcePreviewNodeId,
        sourceMode: sourceData.sourceMode,
        localPath: sourceData.localPath,
      }

      // 调用 store 方法更新节点数据
      store.updateNodeData(schemaNodeId, updatedSchemaData)

      // 记录更新完成日志
      logger.debug('🔌 [handleSourceToSchemaConnection] 已更新 SchemaNode 元数据')
      const currentColumns =
        ((schemaNode?.data as Record<string, unknown>)?.columns as unknown[]) || []
      logger.debug('  - 当前列定义数量:', currentColumns.length)

      // ========== 步骤 2：显示成功提示 ==========
      const schemaName = smartTableName
      success(
        t('canvas.nodeCanvas.connectionSuccess', {
          source: displayFileName,
          target: schemaName,
        })
      )

      // ========== 步骤 3：标记连接状态 ==========
      // 标记源节点的输出端口已连接
      store.updateNodeData(sourcePreviewNodeId, {
        ...sourceData,
        outputPortConnected: true,
      })

      logger.debug('🔌 [handleSourceToSchemaConnection] 连接处理完成，准备恢复配置或弹出确认对话框')

      const schemaNodeIdForDialog = schemaNodeId
      const sourceNodeIdForDialog = sourcePreviewNodeId
      const projectStore = useProjectStore()
      const configPath = projectStore.currentPaths?.configPath

      // ========== 步骤 4：尝试加载已有 V2 配置 ==========
      const loadedFromConfig = await tryLoadExistingSchemaConfig({
        schemaNodeId,
        localPath: sourceData.localPath as string | undefined,
        sheetName: updatedSchemaData.sheetName,
        configPath,
        store,
        updateNodeInternals,
      })
      if (!loadedFromConfig) {
        // 未找到已有配置，回退到智能填充对话框
        await nextTick()
        const latestSchemaNode = store.nodes.find((n) => n.id === schemaNodeIdForDialog)
        const latestSourceNode = store.nodes.find((n) => n.id === sourceNodeIdForDialog)

        if (latestSchemaNode && latestSourceNode) {
          const sourceDataSnapshot = JSON.parse(JSON.stringify(latestSourceNode.data)) as Record<
            string,
            unknown
          >
          const schemaDataSnapshot = JSON.parse(JSON.stringify(latestSchemaNode.data)) as Record<
            string,
            unknown
          >

          await showSmartFillDialog(
            { id: sourceNodeIdForDialog, data: sourceDataSnapshot },
            { id: schemaNodeIdForDialog, data: schemaDataSnapshot }
          )
        }
      }

      // ========== 步骤 5：触发校验 ==========
      const currentSchemaNode = store.nodes.find((n) => n.id === schemaNodeIdForDialog)
      const hasColumns =
        (((currentSchemaNode?.data as Record<string, unknown>)?.columns as unknown[])?.length ||
          0) > 0
      if (currentSchemaNode && hasColumns) {
        triggerValidationForNode(
          schemaNodeIdForDialog,
          store.nodes,
          store.edges,
          (nodeId: string, data: Record<string, unknown>) => store.updateNodeData(nodeId, data)
        )
      }

      await revalidateConstraintsReferencingSchema({
        schemaNodeId: schemaNodeIdForDialog,
        nodes: store.nodes,
        edges: store.edges,
        updateNodeData: (nodeId: string, data: Record<string, unknown>) =>
          store.updateNodeData(nodeId, data),
      })
      // 配置已从 V2 恢复时不再 emit sourcePreviewDataChanged，
      // 避免 useSchemaSourceManager 的 updateSchemaNodeFromSheetChange 用 header 重新生成列覆盖
      if (!loadedFromConfig) {
        eventBus.emit('sourcePreviewDataChanged', {
          nodeId: sourceNodeIdForDialog,
          data: (store.nodes.find((n) => n.id === sourceNodeIdForDialog)?.data ?? {}) as Record<
            string,
            unknown
          >,
        })
      }
    } catch (error) {
      // 捕获并记录错误，显示失败提示
      logger.error('处理 SourcePreview 到 Schema 连线失败:', error)
      showError(t('canvas.nodeCanvas.connectionFailed'))
    }
  }

  /**
   * 显示智能填充询问对话框
   * 询问用户是否要根据数据源自动生成列定义
   * 使用同步的 confirm 对话框，确保用户必须明确选择后才会执行列生成
   *
   * 设计考量：使用同步对话框可以避免异步代码执行顺序问题
   * 同时让用户对列生成操作有完全的控制权
   * @param source - 数据源节点，格式为 { id: string; data: Record<string, unknown> }
   * @param schema - Schema 节点，格式为 { id: string; data: Record<string, unknown> }
   */
  const showSmartFillDialog = async (
    source: { id: string; data: Record<string, unknown> } | Record<string, unknown>,
    schema?: { id: string; data: Record<string, unknown> } | Record<string, unknown>
  ) => {
    // 兼容性处理：支持旧格式（完整节点对象）
    const sourceData = ('data' in source ? source.data : source) as Record<string, unknown>
    const schemaData = (schema && 'data' in schema ? schema.data : schema) as Record<
      string,
      unknown
    >

    // 从节点数据中提取显示名称，用于对话框展示
    const sourceName =
      (sourceData.sourceName as string) || (sourceData.fileName as string) || 'Unknown'
    const schemaName = (schemaData.tableName as string) || 'Schema'

    // 提取数据源列名用于比较
    const tableData = sourceData.data as unknown[][]
    if (!tableData || tableData.length === 0) return

    const headerRowIndex = (sourceData.headerRow as number) ?? 0
    const headerRow = tableData[headerRowIndex]
    if (!headerRow) return

    const schemaColumns = ((schemaData.columns as unknown[]) || []) as {
      columnName: string
      expressionType?: string
      isBound?: boolean
      extractedConfig?: unknown
    }[]
    const sourceColumnNames = extractColumnNamesFromHeader(headerRow)
    const comparison = compareColumns(sourceColumnNames, schemaColumns)

    logger.debug('🎯 [showSmartFillDialog] 列比较结果:', comparison)

    if (comparison.schemaEmpty) {
      // ── Case A: Schema 无列定义 → 弹"生成"对话框 ──
      const userConfirmed = await showConfirm({
        title: t('canvas.nodeCanvas.smartFill.title'),
        message: t('canvas.nodeCanvas.smartFill.message', {
          sourceName,
          schemaName,
          currentColumnsCount: 0,
        }),
        confirmText: t('canvas.nodeCanvas.smartFill.confirm'),
        cancelText: t('common.cancel'),
      })

      logger.debug('🎯 [showSmartFillDialog] 用户选择:', userConfirmed ? '✅ 确认生成' : '❌ 取消')

      if (userConfirmed) {
        generateColumnsFromDataSource(
          source as unknown as { id: string; data: Record<string, unknown> },
          schema as unknown as { id: string; data: Record<string, unknown> }
        )
      }
    } else if (comparison.needsAction) {
      // ── Case B: 列不匹配 → 弹"修正"对话框（三按钮） ──
      const parts: string[] = []
      if (comparison.newInSource.length > 0) {
        const preview = comparison.newInSource.slice(0, 5).join(', ')
        const suffix =
          comparison.newInSource.length > 5
            ? t('canvas.nodeCanvas.smartFix.moreItems', {
                count: comparison.newInSource.length,
              })
            : ''
        parts.push(
          t('canvas.nodeCanvas.smartFix.newInSource', {
            count: comparison.newInSource.length,
            columns: `${preview}${suffix}`,
          })
        )
      }
      if (comparison.staleInSchema.length > 0) {
        const preview = comparison.staleInSchema.slice(0, 5).join(', ')
        const suffix =
          comparison.staleInSchema.length > 5
            ? t('canvas.nodeCanvas.smartFix.moreItems', {
                count: comparison.staleInSchema.length,
              })
            : ''
        parts.push(
          t('canvas.nodeCanvas.smartFix.staleInSchema', {
            count: comparison.staleInSchema.length,
            columns: `${preview}${suffix}`,
          })
        )
      }

      const result = await showConfirm({
        title: t('canvas.nodeCanvas.smartFix.title'),
        message: t('canvas.nodeCanvas.smartFix.message', {
          sourceName,
          schemaName,
          details: parts.join('\n'),
        }),
        confirmText: t('canvas.nodeCanvas.smartFix.confirm'),
        cancelText: t('common.cancel'),
        alternativeText: t('canvas.nodeCanvas.smartFix.skip'),
        type: 'warning',
      })

      logger.debug(
        '🎯 [showSmartFillDialog] 用户选择:',
        result === true ? '✅ 智能修正' : '❌ 跳过/取消'
      )

      if (result === true) {
        generateColumnsFromDataSource(
          source as unknown as { id: string; data: Record<string, unknown> },
          schema as unknown as { id: string; data: Record<string, unknown> }
        )
      }
    } else {
      // ── Case C: 列完全匹配 → 静默跳过 ──
      logger.debug('🎯 [showSmartFillDialog] 列定义已匹配数据源，跳过智能填充')
    }
  }

  /**
   * 检查数据源列名与 Schema 定义是否匹配
   * 如果 Schema 中定义的列在数据源中不存在，弹出警告提示
   * @param sourcePreviewNode - 数据源预览节点
   * @param schemaNode - Schema 节点
   */
  const checkColumnMismatch = async (
    sourcePreviewNode: { data: Record<string, unknown> },
    schemaNode: { data: Record<string, unknown> }
  ) => {
    const sourceData = sourcePreviewNode.data
    const tableData = sourceData.data as unknown[][]
    if (!tableData || tableData.length === 0) return

    const headerRowIndex = (sourceData.headerRow as number) ?? 0
    const headerRow = tableData[headerRowIndex]
    if (!headerRow) return

    // 获取源数据列名（转为字符串并去除空白）
    const sourceColumns = (headerRow as unknown[]).map((h) => String(h).trim())
    // 获取 Schema 现有列名
    const schemaColumns = (schemaNode.data as Record<string, unknown>).columns || []

    if ((schemaColumns as unknown[]).length === 0) return

    // 找出缺失的列
    const missingColumns = (schemaColumns as unknown[])
      .map((c) => (c as Record<string, unknown>).columnName as string)
      .filter((name) => !sourceColumns.includes(name))

    if (missingColumns.length > 0) {
      const missingCount = missingColumns.length
      const previewMissing = missingColumns.slice(0, 5).join(', ')
      const suffix = missingColumns.length > 5 ? '...' : ''

      logger.warn(`⚠️ 列不匹配警告: 缺少 ${missingCount} 列`, missingColumns)

      await showConfirm({
        title: t('canvas.nodeCanvas.columnMismatch.title'),
        message: t('canvas.nodeCanvas.columnMismatch.message', {
          schemaCount: (schemaColumns as unknown[]).length,
          missingCount: missingCount,
          missingColumns: `${previewMissing}${suffix}`,
        }),
        confirmText: t('canvas.nodeCanvas.columnMismatch.confirm'),
        cancelText: t('common.cancel'),
      })
    }
  }

  /**
   * 从数据源自动生成列定义
   *
   * 核心功能：
   * 1. 【表头读取】读取数据源的第一行（或指定行）作为列名
   * 2. 【类型推断】分析数据样例，自动识别 Integer/Float/Date/Boolean/String
   * 3. 【约束保留】如果新列名与旧列名一致，自动继承旧列的约束配置（如非空、唯一性等）
   * 4. 【连接迁移】如果列ID发生变化，自动更新连接到这些列的 Edge，保持连线不丢失
   *
   * @param sourcePreviewNode - 数据源预览节点
   * @param schemaNode - Schema 节点
   */
  const generateColumnsFromDataSource = (
    sourcePreviewNode: { id: string; data: Record<string, unknown> },
    schemaNode: { id: string; data: Record<string, unknown> }
  ) => {
    try {
      // 记录开始生成列定义的日志
      logger.debug('🎯 [generateColumnsFromDataSource] 开始生成列定义！')
      logger.debug('  - sourceNodeId:', sourcePreviewNode.id)
      logger.debug('  - schemaNodeId:', schemaNode.id)
      logger.debug(
        '  - 生成前列定义数量:',
        ((schemaNode.data as Record<string, unknown>)?.columns as unknown[])?.length || 0
      )

      // 从源节点提取数据
      const sourceData = sourcePreviewNode.data
      const tableData = sourceData.data as unknown[][]

      // 检查数据是否存在
      if (!tableData || tableData.length === 0) {
        showError(
          t('canvas.nodeCanvas.dataSourceEmpty'),
          t('canvas.nodeCanvas.columnsGenerationFailed')
        )
        return
      }

      // ========== 准备阶段：保存旧状态 ==========
      // 保存原有列数据和约束连接
      const originalColumns =
        ((schemaNode.data as Record<string, unknown>).columns as unknown[]) || []

      // 获取与当前 Schema 节点相关的所有约束连接
      const relatedEdges = getConnectedEdges([schemaNode as unknown as Node])

      // 获取表头行数据
      const headerRowIndex = (sourceData.headerRow as number) ?? 0
      const headerRow = tableData[headerRowIndex]

      if (!headerRow) {
        showError(
          t('canvas.nodeCanvas.headerRowMissing'),
          t('canvas.nodeCanvas.columnsGenerationFailed')
        )
        return
      }

      logger.debug('📊 表头数据:', headerRow)
      logger.debug('📈 样例数据行:', tableData[(headerRowIndex as number) + 1])

      // 获取样本数据行（下一行）
      const sampleDataRow =
        (headerRowIndex as number) + 1 < tableData.length
          ? tableData[(headerRowIndex as number) + 1]
          : undefined

      // 调用统一的列生成工具
      // 这里会智能处理：
      // 1. 保留现有列的 ID 和约束（如果列名匹配）
      // 2. 移除默认的未修改 column_1
      // 3. 保留用户添加的额外列（计算列等）
      // 4. forceReinferTypes: true 表示强制重新推断所有列的类型
      const columns = generateColumnsFromSource(headerRow, originalColumns, sampleDataRow, {
        forceReinferTypes: true,
      })

      logger.debug('生成的列定义:', columns)

      // ========== 应用阶段：更新 Store ==========
      // 更新 Schema 节点的列数据
      const updatedSchemaData = {
        ...schemaNode.data,
        columns: columns,
      }

      logger.debug('更新 Schema 节点数据:', updatedSchemaData)

      store.updateNodeData(schemaNode.id, updatedSchemaData)

      success(t('canvas.nodeCanvas.columnsGenerated', { count: columns.length }))
    } catch (error) {
      logger.error('自动生成列定义失败:', error)
      showError(t('canvas.nodeCanvas.columnsGenerationFailed'), t('common.error'))
    }
  }

  const { syncVirtualAnchorEdges, watchVirtualAnchorState } = useVirtualAnchorEdges()

  return {
    handleSourceToSchemaConnection,
    showSmartFillDialog,
    generateColumnsFromDataSource,
    syncVirtualAnchorEdges,
    watchVirtualAnchorState,
  }
}
