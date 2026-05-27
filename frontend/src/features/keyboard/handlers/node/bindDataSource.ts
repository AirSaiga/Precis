/**
 * @file bindDataSource.ts
 * @description Schema 节点自动绑定数据源预览处理器
 *
 * 核心约束：本函数在全局键盘事件监听器中执行，**不在 Vue setup 上下文中**。
 * 因此严禁调用 useVueFlow()、useI18n() 等 setup-only 的 composable。
 * 只允许使用：Pinia Store、模块级纯函数、全局状态工具。
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useProjectStore } from '@/stores/projectStore'
import { fetchPreviewDataFromPath } from '@/composables/nodes/sourcePreview/usePreviewCreation'
import { normalizePath, isAbsolutePath, ensureDirPath } from '@/core/utils/pathNormalization'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { extractColumnNamesFromHeader, compareColumns } from '@/utils/nodes/schema/columnValidation'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { revalidateConstraintsReferencingSchema } from '@/services/constraints/validationRegistryCore'
import type { SchemaNodeData, SourcePreviewNodeData } from '@/types/graph'

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
 *
 * 逻辑流程：
 * 1. 从 Schema 节点读取配置文件中的 localPath
 * 2. 在 workspaceStore（资源树）中查找该路径
 * 3. 若未找到 → 自动添加到资源树，并 toast 提示用户
 * 4. 创建 SourcePreview 节点并连接到 Schema
 * 5. 同步元数据、询问智能列填充、触发校验
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
  if (!schemaNode || schemaNode.type !== 'schema') {
    logger.debug('[bindDataSource] 选中节点不是 schema 类型:', schemaNode?.type)
    return { success: false, message: 'shortcuts.feedback.schemaOnly' }
  }

  const schemaData = schemaNode.data as SchemaNodeData
  const localPath = schemaData.localPath

  if (!localPath) {
    logger.debug('[bindDataSource] Schema 未配置数据源路径')
    return { success: false, message: 'shortcuts.feedback.dataSourceNotConfigured' }
  }

  logger.debug('[bindDataSource] 目标 Schema:', schemaNode.id, 'localPath:', localPath)
  logger.debug('[bindDataSource] schemaData.sheetName:', schemaData.sheetName)

  // ---- 检查是否已存在 SourcePreview → Schema 连接 ----
  const alreadyConnected = graphStore.edges.some(
    (e) =>
      e.target === schemaNode.id &&
      graphStore.nodes.find((n) => n.id === e.source)?.type === 'sourcePreview'
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
    // localPath 已经是绝对路径（V2 导入时已解析），直接使用
    resolvedLocalPath = normalizePath(localPath)
  } else {
    // relative_file 且路径实际为相对 -> 基于项目根目录解析
    const projectStore = useProjectStore()
    const rawProjectRoot = projectStore.currentPaths?.configPath || projectStore.currentPaths?.dataPath
    const projectRoot = rawProjectRoot ? ensureDirPath(rawProjectRoot) : ''
    if (projectRoot) {
      resolvedLocalPath = normalizePath(
        projectRoot + localPath.replace(/^[\/\\]+/, '')
      )
    } else {
      resolvedLocalPath = normalizePath(localPath)
    }
  }

  // ---- 调用后端获取文件预览数据（同时验证文件存在性） ----
  let previewData: Record<string, unknown>
  try {
    previewData = await fetchPreviewDataFromPath(resolvedLocalPath, 65535, 65535, schemaData.sheetName)
    logger.debug('[bindDataSource] 预览数据获取成功')
  } catch (error: any) {
    const errorText = String(error?.message || error)
    logger.error('[bindDataSource] 预览数据获取失败:', errorText)
    if (
      errorText.includes('404') &&
      (errorText.includes('工作表') || errorText.includes('Worksheet') || errorText.includes('sheet'))
    ) {
      return {
        success: false,
        message: `Sheet "${schemaData.sheetName}" 不存在于目标文件中，请在 Schema 属性面板中修正工作表名称`,
      }
    }
    return { success: false, message: 'shortcuts.feedback.failed' }
  }

  // ---- 预览成功后，确保数据源已注册到资源树（此时文件已确认存在） ----
  const sourceList = workspaceStore.getDataSources()
  logger.debug('[bindDataSource] 查找数据源，resolvedLocalPath:', resolvedLocalPath)
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

      if ((window as any).$toast) {
        ;(window as any).$toast.info('已新增外部数据', basename(resolvedLocalPath))
      }
    } catch (addError) {
      logger.error('[bindDataSource] 添加数据源到资源树失败:', addError)
    }
  } else {
    logger.debug('[bindDataSource] 资源树中已存在:', dataSource.name)
  }

  // ---- 校验 Schema 配置的 sheetName 与数据文件实际拥有的 sheets 是否匹配 ----
  // 严格校验：sheet 不匹配时直接报错，禁止静默降级绑定到其他工作表
  const actualSheets = (previewData.sheets as string[] | undefined) || undefined
  const currentSheetFromBackend = previewData.currentSheet as string | undefined
  const requestedSheet = schemaData.sheetName

  if (actualSheets && actualSheets.length > 0 && requestedSheet) {
    // Excel 文件：校验配置的 sheetName 是否存在于文件的 sheet 列表中
    const sheetMatch = actualSheets.some(
      (s) => s.toLowerCase().trim() === requestedSheet.toLowerCase().trim()
    )
    if (!sheetMatch) {
      logger.warn(
        '[bindDataSource] Sheet 不匹配: Schema 配置 "',
        requestedSheet,
        '", 文件拥有的 sheets:',
        actualSheets
      )
      const sheetList = actualSheets.length <= 5
        ? actualSheets.join(', ')
        : actualSheets.slice(0, 5).join(', ') + ` 等 ${actualSheets.length} 个`
      return {
        success: false,
        message: `Sheet "${requestedSheet}" 不存在于目标文件中。文件拥有的工作表: ${sheetList}。请在 Schema 属性面板中修正工作表名称`,
      }
    }
  } else if (actualSheets && actualSheets.length > 0 && !requestedSheet) {
    // Excel 文件但 Schema 未配置 sheetName：文件有多个 sheet 时给出提示
    if (actualSheets.length > 1) {
      logger.warn(
        '[bindDataSource] Schema 未指定 sheetName，文件拥有多个 sheet:',
        actualSheets
      )
    }
  }

  // ---- 构建并创建 SourcePreview 节点 ----
  const sourcePreviewNodeId = `source-preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const fileType = dataSource?.type || inferFileType(resolvedLocalPath)
  const displayName =
    dataSource?.alias || dataSource?.name || basename(resolvedLocalPath).replace(/\.[^/.]+$/, '') || 'Table'

  // currentSheetFromBackend 已在上方校验块中声明，此处直接使用
  const resolvedSheet = currentSheetFromBackend || schemaData.sheetName
  logger.debug(
    '[bindDataSource] 使用工作表:',
    resolvedSheet,
    'backend返回:',
    currentSheetFromBackend,
    'schema原配置:',
    schemaData.sheetName
  )

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

  graphStore.nodes.push({
    id: sourcePreviewNodeId,
    type: 'sourcePreview',
    position: { x: schemaNode.position.x - 450, y: schemaNode.position.y },
    data: nodeData,
    selected: false,
    dragging: false,
  } as any)

  logger.debug('[bindDataSource] SourcePreview 节点已创建:', sourcePreviewNodeId)

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
  logger.debug('[bindDataSource] 连接边已创建')

  // ---- 断开旧的 SourcePreview → Schema 连接（一个 Schema 只能连一个数据源）----
  const oldEdges = graphStore.edges.filter(
    (e) =>
      e.target === schemaNode.id &&
      e.source !== sourcePreviewNodeId &&
      graphStore.nodes.find((n) => n.id === e.source)?.type === 'sourcePreview'
  )
  for (const edge of oldEdges) {
    graphStore.deleteConnection(edge.id)
  }
  if (oldEdges.length > 0) {
    logger.debug('[bindDataSource] 已断开旧连接:', oldEdges.length)
  }

  // ---- 同步 Schema 节点的数据源元数据 ----
  const smartTableName = nodeData.currentSheet || displayName

  graphStore.updateNodeData(schemaNode.id, {
    ...schemaNode.data,
    tableName: smartTableName,
    sourceFile: basename(resolvedLocalPath),
    sourceFilePath: resolvedLocalPath,
    sourcePathMode: 'absolute_file',
    sourceType: fileType,
    headerRow: 0,
    // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
    sheetName: nodeData.currentSheet,
    sourceNodeId: sourcePreviewNodeId,
    sourceMode: 'localfile',
    localPath: resolvedLocalPath,
  })
  logger.debug('[bindDataSource] Schema 元数据已同步')

  // ---- 标记 SourcePreview 输出端口已连接 ----
  graphStore.updateNodeData(sourcePreviewNodeId, {
    ...nodeData,
    outputPortConnected: true,
  })

  // ---- 智能列填充询问（三分支决策：空列生成 / 不匹配修正 / 完全匹配跳过） ----
  const tableData = nodeData.data
  const schemaColumns = schemaData.columns || []

  if (tableData && tableData.length > 0) {
    try {
      const headerRow = tableData[0]
      const sampleDataRow = tableData.length > 1 ? tableData[1] : undefined
      const sourceColumnNames = extractColumnNamesFromHeader(headerRow)
      const comparison = compareColumns(sourceColumnNames, schemaColumns)

      if (comparison.schemaEmpty) {
        // ── Case A: Schema 无列定义 → 弹"生成"对话框 ──
        const userConfirmed = await showConfirm({
          title: '智能列填充',
          message: `是否根据数据源 "${nodeData.sourceName}" 的表头自动生成 "${smartTableName}" 的列定义？`,
          confirmText: '生成列定义',
          cancelText: '取消',
        })
        if (userConfirmed) {
          const columns = generateColumnsFromSource(headerRow, schemaColumns, sampleDataRow, {
            forceReinferTypes: true,
          })
          graphStore.updateNodeData(schemaNode.id, { ...schemaNode.data, columns })
          logger.debug(`[bindDataSource] 已生成 ${columns.length} 个列定义`)
        }
      } else if (comparison.needsAction) {
        // ── Case B: 列不匹配 → 弹"修正"对话框（三按钮） ──
        const parts: string[] = []
        if (comparison.newInSource.length > 0) {
          const preview = comparison.newInSource.slice(0, 5).join(', ')
          const suffix = comparison.newInSource.length > 5 ? ` 等 ${comparison.newInSource.length} 个` : ''
          parts.push(`数据源有 ${comparison.newInSource.length} 个新列未在 Schema 中定义（${preview}${suffix}）`)
        }
        if (comparison.staleInSchema.length > 0) {
          const preview = comparison.staleInSchema.slice(0, 5).join(', ')
          const suffix = comparison.staleInSchema.length > 5 ? ` 等 ${comparison.staleInSchema.length} 个` : ''
          parts.push(`Schema 有 ${comparison.staleInSchema.length} 个非衍生列不在数据源中（${preview}${suffix}）`)
        }

        const result = await showConfirm({
          title: '列定义修正',
          message: `数据源 "${nodeData.sourceName}" 与 "${smartTableName}" 的列定义不一致：\n\n${parts.join('；')}。\n\n是否执行智能修正？`,
          confirmText: '智能修正',
          cancelText: '取消',
          alternativeText: '跳过',
          type: 'warning',
        })

        if (result === true) {
          const columns = generateColumnsFromSource(headerRow, schemaColumns, sampleDataRow, {
            forceReinferTypes: true,
          })
          graphStore.updateNodeData(schemaNode.id, { ...schemaNode.data, columns })
          logger.debug(`[bindDataSource] 智能修正完成，共 ${columns.length} 个列定义`)
        }
      } else {
        // ── Case C: 列完全匹配 → 静默跳过 ──
        logger.debug('[bindDataSource] 列定义已匹配数据源，跳过智能填充')
      }
    } catch (dialogError) {
      logger.warn('[bindDataSource] 智能填充对话框异常:', dialogError)
    }
  }

  // ---- 触发校验 ----
  const updatedSchema = graphStore.nodes.find((n) => n.id === schemaNode.id)
  const hasColumns = ((updatedSchema?.data as SchemaNodeData)?.columns?.length || 0) > 0
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
  // 通用机制：任何约束类型只要注册了 targetRefResolver，都会自动被触发
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
