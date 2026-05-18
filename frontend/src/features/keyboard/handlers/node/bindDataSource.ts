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
import { fetchPreviewDataFromPath } from '@/composables/nodes/sourcePreview/usePreviewCreation'
import { normalizePath } from '@/core/utils/pathNormalization'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
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

  // ---- 在资源树中查找，若不存在则自动添加 ----
  // 【诊断日志】记录 workspaceStore 中所有数据源路径，帮助排查路径不匹配问题
  const sourceList = workspaceStore.getDataSources()
  logger.debug('[bindDataSource] 查找数据源，localPath:', localPath)
  logger.debug('[bindDataSource] workspaceStore 数据源数量:', sourceList.length)
  logger.debug(
    '[bindDataSource] workspaceStore 所有路径:',
    sourceList.map((ds: any) => ({ fileId: ds.fileId, localPath: ds.localPath, name: ds.name }))
  )

  // 使用标准化后的路径进行查找
  let dataSource = workspaceStore.findDataSourceByPath(normalizePath(localPath))

  if (!dataSource) {
    logger.warn('[bindDataSource] 资源树中未找到匹配数据源，即将自动添加:', localPath)
    try {
      await workspaceStore.addDataSource(
        localPath,
        basename(localPath),
        inferFileType(localPath),
        'localfile',
        localPath,
        dirname(localPath)
      )
      dataSource = workspaceStore.findDataSourceByPath(localPath)

      // 通过全局 toast 提示用户（避免使用 setup-only 的 useToast）
      if ((window as any).$toast) {
        ;(window as any).$toast.info('已新增外部数据', basename(localPath))
      }
    } catch (addError) {
      logger.error('[bindDataSource] 添加数据源到资源树失败:', addError)
      // 添加失败不影响后续流程，继续尝试直接读取文件
    }
  } else {
    logger.debug('[bindDataSource] 资源树中已存在:', dataSource.name)
  }

  // ---- 调用后端获取文件预览数据 ----
  let previewData: Record<string, unknown>
  try {
    previewData = await fetchPreviewDataFromPath(localPath, 65535, 65535, schemaData.sheetName)
    logger.debug('[bindDataSource] 预览数据获取成功')
  } catch (error) {
    logger.error('[bindDataSource] 预览数据获取失败:', error)
    return { success: false, message: 'shortcuts.feedback.failed' }
  }

  // ---- 构建并创建 SourcePreview 节点 ----
  const sourcePreviewNodeId = `source-preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const fileType = dataSource?.type || inferFileType(localPath)
  const displayName =
    dataSource?.alias || dataSource?.name || basename(localPath).replace(/\.[^/.]+$/, '') || 'Table'

  // fetchPreviewDataFromPath 已内部转换 snake_case -> camelCase
  const currentSheetFromBackend = previewData.currentSheet as string | undefined
  const resolvedSheet = schemaData.sheetName || currentSheetFromBackend
  logger.debug(
    '[bindDataSource] 使用工作表:',
    resolvedSheet,
    'backend返回:',
    currentSheetFromBackend
  )

  const nodeData: SourcePreviewNodeData = {
    id: sourcePreviewNodeId,
    label: '数据源预览',
    sourceName: displayName,
    localPath: localPath,
    fileName: basename(localPath),
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
    sourceFile: basename(localPath),
    sourceFilePath: localPath,
    sourcePathMode: 'absolute_file',
    sourceType: fileType,
    headerRow: 0,
    // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
    sheetName: nodeData.currentSheet,
    sourceNodeId: sourcePreviewNodeId,
    sourceMode: 'localfile',
    localPath: localPath,
  })
  logger.debug('[bindDataSource] Schema 元数据已同步')

  // ---- 标记 SourcePreview 输出端口已连接 ----
  graphStore.updateNodeData(sourcePreviewNodeId, {
    ...nodeData,
    outputPortConnected: true,
  })

  // ---- 智能列填充询问 ----
  const tableData = nodeData.data
  const schemaColumns = schemaData.columns || []

  if (tableData && tableData.length > 0) {
    try {
      const userConfirmed = await showConfirm({
        title: '智能列填充',
        message: `是否根据数据源 "${nodeData.sourceName}" 的表头自动生成 "${smartTableName}" 的列定义？\n\n当前已有 ${schemaColumns.length} 个列定义。`,
        confirmText: '生成列定义',
        cancelText: '取消',
      })

      if (userConfirmed) {
        const headerRow = tableData[0]
        const sampleDataRow = tableData.length > 1 ? tableData[1] : undefined
        const columns = generateColumnsFromSource(headerRow, schemaColumns, sampleDataRow, {
          forceReinferTypes: true,
        })
        graphStore.updateNodeData(schemaNode.id, { ...schemaNode.data, columns })
        logger.debug(`[bindDataSource] 已生成 ${columns.length} 个列定义`)
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

  logger.debug('[bindDataSource] ========== 执行完成 ==========')
  return { success: true, message: 'shortcuts.feedback.bindDataSourceSuccess' }
}
