/**
 * @file bindDataSource.ts
 * @description Schema 节点自动绑定数据源预览处理器（策略模式重构版）
 *
 * 核心约束：本函数在全局键盘事件监听器中执行，**不在 Vue setup 上下文中**。
 * 因此严禁调用 useVueFlow()、useI18n() 等 setup-only 的 composable。
 * 只允许使用：Pinia Store、模块级纯函数、全局状态工具。
 *
 * 重构要点：
 * - 使用 PreviewDataFetcher 统一获取预览数据
 * - 使用 ColumnGenerationStrategy 替代直接的列生成函数
 * - 保留 UI 编排逻辑（节点创建、对话框、校验触发）
 */

import { nextTick } from 'vue'
import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useProjectStore } from '@/stores/projectStore'
import { fetchPreviewDataFromPath } from '@/services/preview/fetchPreviewFromPath'
import { normalizePath, isAbsolutePath, ensureDirPath } from '@/core/utils/pathNormalization'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { tabularColumnGenerator } from '@/utils/nodes/columnGeneration/TabularColumnGenerator'
import { jsonColumnGenerator } from '@/utils/nodes/columnGeneration/JsonColumnGenerator'
import { previewDataFetcher } from '@/utils/nodes/preview/PreviewDataFetcher'
import { extractColumnNamesFromHeader, compareColumns } from '@/utils/nodes/schema/columnValidation'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'
import { i18n } from '@/i18n'
import { toastWarning } from '@/core/toast'
import type {
  SchemaNodeData,
  SourcePreviewNodeData,
  JsonSchemaNodeData,
  JsonSourcePreviewNodeData,
  CustomNodeData,
  CustomNode,
} from '@/types/graph'

interface ToastApiLike {
  info: (message: string) => void
}

function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

function dirname(filePath: string): string {
  return filePath.replace(/[/\\][^/\\]*$/, '')
}

function inferFileType(filePath: string): 'excel' | 'csv' | 'json' {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'xlsx' || ext === 'xls') return 'excel'
  if (ext === 'csv') return 'csv'
  if (ext === 'json') return 'json'
  return 'csv'
}

/**
 * 为选中的 Schema 节点自动绑定数据源预览
 */
export async function bindDataSourceToSchema(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()
  const workspaceStore = useWorkspaceStore()
  const { showConfirm } = useGlobalConfirm()

  logger.debug('[bindDataSource] ========== 开始执行 ==========')

  // ---- 前置检查 ----
  if (!graphStore.selectedNodeId) {
    logger.debug('[bindDataSource] 未选中节点')
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  const schemaNode = graphStore.nodes.find((n) => n.id === graphStore.selectedNodeId)
  const supportedSchemaTypes = ['schema', 'jsonSchema'] as const
  if (
    !schemaNode ||
    !supportedSchemaTypes.includes(schemaNode.type as unknown as 'schema' | 'jsonSchema')
  ) {
    logger.debug('[bindDataSource] 选中节点不是 schema/jsonSchema 类型:', schemaNode?.type)
    return { success: false, message: 'shortcuts.feedback.schemaOnly' }
  }

  const isJsonSchema = schemaNode.type === 'jsonSchema'
  const schemaData = schemaNode.data as SchemaNodeData | JsonSchemaNodeData
  const localPath = schemaData.localPath

  if (!localPath) {
    logger.debug('[bindDataSource] Schema 未配置数据源路径')
    return { success: false, message: 'shortcuts.feedback.dataSourceNotConfigured' }
  }

  logger.debug('[bindDataSource] 目标 Schema:', schemaNode.id, 'localPath:', localPath)

  // ---- 检查是否已存在 SourcePreview → Schema 连接 ----
  const sourceTypes = ['sourcePreview', 'jsonSourcePreview'] as const
  const alreadyConnected = graphStore.edges.some(
    (e) =>
      e.target === schemaNode.id &&
      sourceTypes.includes(
        graphStore.nodes.find((n) => n.id === e.source)?.type as unknown as
          | 'sourcePreview'
          | 'jsonSourcePreview'
      )
  )
  if (alreadyConnected) {
    logger.debug('[bindDataSource] 已存在数据源连接')
    return { success: false, message: 'shortcuts.feedback.alreadyConnected' }
  }

  // ---- 根据 Schema 自身的 sourcePathMode 解析绝对路径 ----
  let resolvedLocalPath: string
  const sourcePathMode = schemaData.sourcePathMode || 'relative_file'
  if (sourcePathMode === 'absolute_file' && isAbsolutePath(localPath)) {
    resolvedLocalPath = normalizePath(localPath)
  } else if (isAbsolutePath(localPath)) {
    resolvedLocalPath = normalizePath(localPath)
  } else {
    const projectStore = useProjectStore()
    const rawProjectRoot =
      projectStore.currentPaths?.configPath || projectStore.currentPaths?.dataPath
    const projectRoot = rawProjectRoot ? ensureDirPath(rawProjectRoot) : ''
    if (projectRoot) {
      resolvedLocalPath = normalizePath(projectRoot + localPath.replace(/^[\/\\]+/, ''))
    } else {
      resolvedLocalPath = normalizePath(localPath)
    }
  }

  // ---- 调用后端获取文件预览数据 ----
  let previewData: Record<string, unknown>
  try {
    const jsonOptions = isJsonSchema
      ? {
          jsonPath: (schemaData as JsonSchemaNodeData).jsonPath,
          jsonFormat: (schemaData as JsonSchemaNodeData).format,
          recordPath: (schemaData as JsonSchemaNodeData).recordPath,
        }
      : undefined
    previewData = await fetchPreviewDataFromPath(
      resolvedLocalPath,
      65535,
      65535,
      schemaData.sheetName,
      jsonOptions
    )
    logger.debug('[bindDataSource] 预览数据获取成功')
  } catch (error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error)
    logger.error('[bindDataSource] 预览数据获取失败:', errorText)
    if (
      errorText.includes('404') &&
      (errorText.includes('工作表') ||
        errorText.includes('Worksheet') ||
        errorText.includes('sheet'))
    ) {
      return {
        success: false,
        message: i18n.global.t('canvas.nodeCanvas.sheetNotFound', {
          sheet: schemaData.sheetName,
        }),
      }
    }
    return { success: false, message: i18n.global.t('shortcuts.feedback.failed') }
  }

  // ---- 确保数据源已注册到资源树 ----
  const sourceList = workspaceStore.getDataSources()
  logger.debug('[bindDataSource] workspaceStore 数据源数量:', sourceList.length)

  let dataSource = workspaceStore.findDataSourceByPath(normalizePath(resolvedLocalPath))

  if (!dataSource) {
    logger.warn('[bindDataSource] 资源树中未找到匹配数据源，即将自动添加:', resolvedLocalPath)
    try {
      await workspaceStore.addDataSource(
        resolvedLocalPath,
        basename(resolvedLocalPath),
        inferFileType(resolvedLocalPath),
        'localfile',
        resolvedLocalPath,
        dirname(resolvedLocalPath)
      )
      dataSource = workspaceStore.findDataSourceByPath(resolvedLocalPath)

      const toastApi = (window as unknown as { $toast?: ToastApiLike }).$toast
      if (toastApi) {
        toastApi.info(
          i18n.global.t('canvas.nodeCanvas.externalDataAdded', {
            name: basename(resolvedLocalPath),
          })
        )
      }
    } catch (addError) {
      logger.error('[bindDataSource] 添加数据源到资源树失败:', addError)
    }
  }

  // ---- 校验 sheet 名称（仅 Excel） ----
  const actualSheets = (previewData.sheets as string[] | undefined) || undefined
  const currentSheetFromBackend = previewData.currentSheet as string | undefined
  const requestedSheet = schemaData.sheetName

  if (!isJsonSchema && actualSheets && actualSheets.length > 0 && requestedSheet) {
    const sheetMatch = actualSheets.some(
      (s) => s.toLowerCase().trim() === requestedSheet.toLowerCase().trim()
    )
    if (!sheetMatch) {
      const sheetList =
        actualSheets.length <= 5
          ? actualSheets.join(', ')
          : actualSheets.slice(0, 5).join(', ') + ` 等 ${actualSheets.length} 个`
      return {
        success: false,
        message: i18n.global.t('canvas.nodeCanvas.sheetNotFoundWithList', {
          sheet: requestedSheet,
          list: sheetList,
        }),
      }
    }
  }

  // ---- 构建并创建 SourcePreview 节点 ----
  const sourcePreviewNodeId = `${isJsonSchema ? 'json' : 'source'}-preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const fileType = dataSource?.type || inferFileType(resolvedLocalPath)
  const displayName =
    dataSource?.alias ||
    dataSource?.name ||
    basename(resolvedLocalPath).replace(/\.[^/.]+$/, '') ||
    'Table'
  const resolvedSheet = currentSheetFromBackend || schemaData.sheetName

  if (isJsonSchema) {
    const jsonSchemaData = schemaData as JsonSchemaNodeData
    const nodeData: JsonSourcePreviewNodeData = {
      id: sourcePreviewNodeId,
      configName: `JsonSource_${displayName}`,
      sourceName: displayName,
      fileName: basename(resolvedLocalPath),
      fileType: 'json',
      sourceType: 'json',
      format: jsonSchemaData.format || 'auto',
      jsonPath: jsonSchemaData.jsonPath || '',
      recordPath: jsonSchemaData.recordPath || '',
      rawData: (previewData.raw_data as unknown[]) || [],
      totalRows: (previewData.total_rows as number) || 0,
      totalCols: (previewData.total_cols as number) || 0,
      actualRowCount: (previewData.total_rows as number) || 0,
      actualColCount: (previewData.total_cols as number) || 0,
      previewRowCount: (previewData.previewRowCount as number) || 0,
      previewColCount: (previewData.previewColCount as number) || 0,
      fileSize: (dataSource?.size as number) || 0,
      lastModified: Date.now(),
      isPreviewNode: true,
      outputPortConnected: false,
      sourceMode: 'localfile',
      localPath: resolvedLocalPath,
      typeInference: (previewData.type_inference as Record<string, string>) || undefined,
      fieldCount: (previewData.field_count as number) || undefined,
      nestDepth: (previewData.nest_depth as number) || undefined,
    }

    addNodes([
      {
        id: sourcePreviewNodeId,
        type: 'jsonSourcePreview',
        position: { x: schemaNode.position.x - 450, y: schemaNode.position.y },
        data: nodeData,
      } as unknown as CustomNode,
    ])
  } else {
    const nodeData: SourcePreviewNodeData = {
      id: sourcePreviewNodeId,
      label: '数据源预览',
      sourceName: displayName,
      localPath: resolvedLocalPath,
      fileName: basename(resolvedLocalPath),
      fileType: fileType === 'csv' ? 'CSV' : fileType === 'json' ? 'JSON' : 'Excel',
      sourceType: fileType,
      data: (previewData.data as string[][]) || [],
      actualRowCount: (previewData.actualRowCount as number) || 0,
      actualColCount: (previewData.actualColCount as number) || 0,
      rowCount: (previewData.actualRowCount as number) || 0,
      colCount: (previewData.actualColCount as number) || 0,
      totalRows: (previewData.actualRowCount as number) || 0,
      totalCols: (previewData.actualColCount as number) || 0,
      previewRowCount: (previewData.previewRowCount as number) || 0,
      previewColCount: (previewData.previewColCount as number) || 0,
      sheets: (previewData.sheets as string[] | undefined) || undefined,
      currentSheet: resolvedSheet,
      fileSize: (dataSource?.size as number) || 0,
      lastModified: Date.now(),
      isPreviewNode: true,
      createdAt: Date.now(),
      outputPortConnected: false,
      headerRow: 0,
      sourceMode: 'localfile',
    }

    addNodes([
      {
        id: sourcePreviewNodeId,
        type: 'sourcePreview',
        position: { x: schemaNode.position.x - 450, y: schemaNode.position.y },
        data: nodeData,
      } as unknown as CustomNode,
    ])
  }

  await nextTick()

  // ---- 创建 SourcePreview → Schema 连接边 ----
  graphStore.createConnection(
    sourcePreviewNodeId,
    schemaNode.id,
    `${sourcePreviewNodeId}-output`,
    'target-left',
    {
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'var(--edge-data-source)', strokeWidth: 1.5 },
      label: 'Data Source',
    }
  )

  // ---- 断开旧的 SourcePreview → Schema 连接 ----
  const oldEdges = graphStore.edges.filter(
    (e) =>
      e.target === schemaNode.id &&
      e.source !== sourcePreviewNodeId &&
      sourceTypes.includes(
        graphStore.nodes.find((n) => n.id === e.source)?.type as unknown as
          | 'sourcePreview'
          | 'jsonSourcePreview'
      )
  )
  for (const edge of oldEdges) {
    graphStore.deleteConnection(edge.id)
  }

  // ---- 同步 Schema 节点的数据源元数据 ----
  const smartTableName = isJsonSchema ? displayName : resolvedSheet || displayName

  // 检测重复数据源
  if (
    graphStore.schemaSourceIndex?.isDuplicateSource(resolvedLocalPath, resolvedSheet, schemaNode.id)
  ) {
    const conflict = graphStore.schemaSourceIndex.getConflictForSource(
      resolvedLocalPath,
      resolvedSheet,
      schemaNode.id
    )
    const otherIds = conflict?.nodeIds.filter((id) => id !== schemaNode.id) || []
    toastWarning(
      i18n.global.t('canvas.nodeCanvas.duplicateSourceMessage', {
        source: basename(resolvedLocalPath),
        nodes: otherIds.join(', '),
      }),
      i18n.global.t('canvas.nodeCanvas.duplicateSourceTitle')
    )
  }

  if (isJsonSchema) {
    const jsonSchemaData = schemaData as JsonSchemaNodeData
    graphStore.updateNodeData(schemaNode.id, {
      ...schemaNode.data,
      tableName: smartTableName,
      sourceFile: basename(resolvedLocalPath),
      sourceFilePath: resolvedLocalPath,
      sourcePathMode: 'absolute_file',
      sourceType: 'json',
      headerRow: 0,
      sourceNodeId: sourcePreviewNodeId,
      sourceMode: 'localfile',
      localPath: resolvedLocalPath,
      jsonPath: jsonSchemaData.jsonPath || '',
      recordPath: jsonSchemaData.recordPath || '',
      format: jsonSchemaData.format || 'auto',
    } as Partial<CustomNodeData>)
    graphStore.schemaSourceIndex?.rebuild()
  } else {
    graphStore.updateNodeData(schemaNode.id, {
      ...schemaNode.data,
      tableName: smartTableName,
      sourceFile: basename(resolvedLocalPath),
      sourceFilePath: resolvedLocalPath,
      sourcePathMode: 'absolute_file',
      sourceType: fileType,
      headerRow: 0,
      sheetName: resolvedSheet,
      sourceNodeId: sourcePreviewNodeId,
      sourceMode: 'localfile',
      localPath: resolvedLocalPath,
    } as Partial<CustomNodeData>)
    graphStore.schemaSourceIndex?.rebuild()
  }

  // ---- 标记 SourcePreview 输出端口已连接 ----
  const sourceNodeData = graphStore.nodes.find((n) => n.id === sourcePreviewNodeId)?.data
  if (sourceNodeData) {
    graphStore.updateNodeData(sourcePreviewNodeId, {
      ...sourceNodeData,
      outputPortConnected: true,
    } as Partial<CustomNodeData>)
  }

  // ---- 智能列填充询问（策略模式） ----
  const unifiedPreview = await previewDataFetcher.fetch({
    type: 'node',
    node: graphStore.nodes.find((n) => n.id === sourcePreviewNodeId)!,
  })

  if (unifiedPreview) {
    const columnGenerator = isJsonSchema ? jsonColumnGenerator : tabularColumnGenerator
    const schemaColumns = schemaData.columns || []
    const sourceFields = unifiedPreview.fields || []

    try {
      const comparison = columnGenerator.compare(sourceFields, schemaColumns)

      if (comparison.schemaEmpty) {
        const userConfirmed = await showConfirm({
          title: i18n.global.t('canvas.nodeCanvas.smartFill.title'),
          message: i18n.global.t('canvas.nodeCanvas.smartFill.message', {
            sourceName: displayName,
            schemaName: smartTableName,
            currentColumnsCount: 0,
          }),
          confirmText: i18n.global.t('canvas.nodeCanvas.smartFill.confirm'),
          cancelText: i18n.global.t('common.cancel'),
        })
        if (userConfirmed) {
          const newColumns = columnGenerator.generate(unifiedPreview.rawData, schemaColumns)
          graphStore.updateNodeData(schemaNode.id, {
            ...schemaNode.data,
            columns: newColumns,
          } as Partial<CustomNodeData>)
          logger.debug(`[bindDataSource] 已生成 ${newColumns.length} 个列定义`)
        }
      } else if (comparison.needsAction) {
        const parts: string[] = []
        if (comparison.newInSource.length > 0) {
          const preview = comparison.newInSource.slice(0, 5).join(', ')
          const suffix =
            comparison.newInSource.length > 5
              ? i18n.global.t('canvas.nodeCanvas.smartFix.moreItems', {
                  count: comparison.newInSource.length,
                })
              : ''
          parts.push(
            i18n.global.t('canvas.nodeCanvas.smartFix.newInSource', {
              count: comparison.newInSource.length,
              columns: `${preview}${suffix}`,
            })
          )
        }
        if (comparison.staleInSchema.length > 0) {
          const preview = comparison.staleInSchema.slice(0, 5).join(', ')
          const suffix =
            comparison.staleInSchema.length > 5
              ? i18n.global.t('canvas.nodeCanvas.smartFix.moreItems', {
                  count: comparison.staleInSchema.length,
                })
              : ''
          parts.push(
            i18n.global.t('canvas.nodeCanvas.smartFix.staleInSchema', {
              count: comparison.staleInSchema.length,
              columns: `${preview}${suffix}`,
            })
          )
        }

        const result = await showConfirm({
          title: i18n.global.t('canvas.nodeCanvas.smartFix.title'),
          message: i18n.global.t('canvas.nodeCanvas.smartFix.message', {
            sourceName: displayName,
            schemaName: smartTableName,
            details: parts.join('\n'),
          }),
          confirmText: i18n.global.t('canvas.nodeCanvas.smartFix.confirm'),
          cancelText: i18n.global.t('common.cancel'),
          alternativeText: i18n.global.t('canvas.nodeCanvas.smartFix.skip'),
          type: 'warning',
        })

        if (result === true) {
          const newColumns = columnGenerator.generate(unifiedPreview.rawData, schemaColumns)
          graphStore.updateNodeData(schemaNode.id, {
            ...schemaNode.data,
            columns: newColumns,
          } as Partial<CustomNodeData>)
          logger.debug(`[bindDataSource] 智能修正完成，共 ${newColumns.length} 个列定义`)
        }
      } else {
        logger.debug('[bindDataSource] 列定义已匹配数据源，跳过智能填充')
      }
    } catch (dialogError) {
      logger.warn('[bindDataSource] 智能填充对话框异常:', dialogError)
    }
  }

  // ---- 触发校验 ----
  const updatedSchema = graphStore.nodes.find((n) => n.id === schemaNode.id)
  const hasColumns =
    ((updatedSchema?.data as SchemaNodeData | JsonSchemaNodeData)?.columns?.length || 0) > 0
  if (hasColumns) {
    triggerValidationForNode(
      schemaNode.id,
      graphStore.nodes,
      graphStore.edges,
      (nodeId: string, data: Record<string, unknown>) => graphStore.updateNodeData(nodeId, data)
    )
    logger.debug('[bindDataSource] 校验已触发')
  }

  // ---- 重新触发引用本 Schema 为目标的约束验证 ----
  await revalidateConstraintsReferencingSchema({
    schemaNodeId: schemaNode.id,
    nodes: graphStore.nodes,
    edges: graphStore.edges,
    updateNodeData: (nodeId: string, data: Record<string, unknown>) =>
      graphStore.updateNodeData(nodeId, data),
  })

  logger.debug('[bindDataSource] ========== 执行完成 ==========')
  return { success: true, message: 'shortcuts.feedback.bindDataSourceSuccess' }
}
