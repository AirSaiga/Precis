/**
 * @file useSchemaSourceManager.ts
 * @description Schema数据源连接管理
 * 负责Schema节点与数据源节点的连接状态管理、断开连接、列生成等组件级操作
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useI18n } from 'vue-i18n'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { useNodeSourceManager } from '../shared/useNodeSourceManager'
import { syncSchemaResources } from '@/services/schemaResourceSync'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import type { SchemaNodeData, SourcePreviewNodeData } from '@/types/graph'
import type { CustomNode, SchemaColumn } from '@/types/nodes'
import type { AnyRecord } from '@/types/utility'

export function useSchemaSourceManager(
  props: { id: string; data: SchemaNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
  const store = useGraphStore()
  const projectStore = useProjectStore()
  const { showConfirm } = useGlobalConfirm()
  const { t } = useI18n()

  // ============================================================================
  // Schema 特有方法
  // ============================================================================

  /**
   * 从表头数据生成列定义
   */
  const generateColumnsFromHeaderData = (
    headerData: unknown[],
    schemaNode: CustomNode,
    tableData?: unknown[][],
    headerRowIndex?: number
  ) => {
    if (!headerData || headerData.length === 0) {
      logger.warn('表头数据为空')
      return
    }

    let sampleDataRow: unknown[] | undefined
    if (tableData && typeof headerRowIndex === 'number' && headerRowIndex + 1 < tableData.length) {
      sampleDataRow = tableData[headerRowIndex + 1]
    }

    const schemaData = schemaNode.data as SchemaNodeData
    const columns = generateColumnsFromSource(headerData, schemaData.columns || [], sampleDataRow, {
      forceReinferTypes: true,
    })

    const updatedSchemaData = {
      ...schemaData,
      columns,
    }

    store.updateNodeData(schemaNode.id, updatedSchemaData as unknown as Partial<SchemaNodeData>)
    logger.debug(`✅ 智能列生成完成！共 ${columns.length} 列`)
  }

  /**
   * 安全更新 Schema 节点的表头变更
   */
  const updateSchemaNodeFromHeaderChangeSafe = async (
    schemaNodeId: string,
    headerData: unknown[]
  ) => {
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    const schemaNodeData = schemaNode.data as SchemaNodeData
    const sourceFile = schemaNodeData?.sourceFile
    const sourceFilePath = schemaNodeData?.sourceFilePath

    if (sourceFile && sourceFilePath) {
      const shouldRegenerate = await showConfirm({
        title: t('common.confirmDialog.title'),
        message: `检测到表头已变更，是否基于新表头 "${headerData.join(', ')}" 重新生成列定义？`,
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
        type: 'warning',
      })

      if (shouldRegenerate) {
        generateColumnsFromHeaderData(headerData, schemaNode)
      }
    }
  }

  /**
   * 从工作表变更更新 Schema 节点
   */
  const updateSchemaNodeFromSheetChange = (schemaNodeId: string, sheetData: AnyRecord) => {
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    const sourceData = sheetData as unknown as SourcePreviewNodeData

    if (!sourceData.data || sourceData.data.length === 0) {
      logger.warn('工作表数据为空')
      return
    }

    // 1. 准备元数据
    const displayFileName = sourceData.sourceName || sourceData.fileName || 'Unknown'
    const smartTableName =
      sourceData.currentSheet ||
      sourceData.sourceName?.replace(/\.[^/.]+$/, '') ||
      sourceData.fileName?.replace(/\.[^/.]+$/, '') ||
      'Table'
    const displaySourcePath = sourceData.fileName || displayFileName

    // 2. 更新 Schema 节点元数据
    const updatedSchemaData = {
      ...schemaNode.data,
      tableName: smartTableName,
      sourceFile: displayFileName,
      sourceFilePath: displaySourcePath,
      sourceType: sourceData.sourceType,
      headerRow: sourceData.headerRow || 0,
      // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
      sheetName: sourceData.currentSheet,
    }

    store.updateNodeData(schemaNodeId, updatedSchemaData as unknown as Partial<SchemaNodeData>)
    logger.debug(`✅ Schema "${smartTableName}" 已更新`)

    // 3. 智能列生成判断逻辑
    const headerRowIndex = sourceData.headerRow || 0
    const headerData = sourceData.data?.[headerRowIndex]

    const currentSheetName = (schemaNode.data as SchemaNodeData).sheetName
    const newSheetName = sourceData.currentSheet

    let shouldRegenerateColumns = false
    let regenerateReason = ''

    if (!headerData) {
      regenerateReason = '表头数据为空'
    } else if (!currentSheetName) {
      regenerateReason = '首次连接，跳过自动生成'
    } else if (currentSheetName !== newSheetName) {
      shouldRegenerateColumns = true
      regenerateReason = `Sheet名称变更: ${currentSheetName} → ${newSheetName}`
    } else {
      const existingColumns = (schemaNode.data as SchemaNodeData).columns || []
      const oldColumnNames = existingColumns.map((col: SchemaColumn) =>
        String(col.columnName).trim()
      )
      const newColumnNames = (headerData as unknown[]).map((cell) => String(cell).trim())

      const columnCountChanged = oldColumnNames.length !== newColumnNames.length
      const columnNamesChanged = oldColumnNames.some(
        (name: string, idx: number) => idx >= newColumnNames.length || name !== newColumnNames[idx]
      )

      if (columnCountChanged || columnNamesChanged) {
        shouldRegenerateColumns = true
        regenerateReason = `列结构变化: ${oldColumnNames.length}列 → ${newColumnNames.length}列`
      } else {
        regenerateReason = '列结构无变化'
      }
    }

    if (shouldRegenerateColumns) {
      logger.debug('🔄 自动重新生成列定义...', { reason: regenerateReason })
      const targetNode = store.nodes.find((n) => n.id === schemaNodeId)
      if (targetNode && headerData) {
        generateColumnsFromHeaderData(headerData, targetNode, sourceData.data, headerRowIndex)
      }
    } else {
      logger.debug('ℹ️ 跳过自动生成列定义:', regenerateReason)
    }

    // Sheet 切换后自动触发校验，确保数据源正确性实时校正
    if (currentSheetName && currentSheetName !== newSheetName) {
      logger.debug('🔄 Sheet 发生变更，触发自动校验:', {
        schemaNodeId,
        from: currentSheetName,
        to: newSheetName,
      })
      triggerValidationForNode(
        schemaNodeId,
        Array.from(store.nodes),
        Array.from(store.edges),
        (nodeId: string, data: AnyRecord) => {
          store.updateNodeData(nodeId, data as unknown as Partial<SchemaNodeData>)
        }
      )
    }
  }

  // ============================================================================
  // 调用通用数据源管理
  // ============================================================================

  const generic = useNodeSourceManager<SchemaNodeData>(props, emit, {
    sourceNodeType: 'sourcePreview',
    schemaNodePrefix: 'schema-',
    extractMetadata: (_sourceNodeId, sourceData) => {
      const previewData = sourceData as unknown as SourcePreviewNodeData
      const displayFileName = previewData.sourceName || previewData.fileName || 'Unknown'
      const smartTableName =
        previewData.currentSheet ||
        previewData.sourceName?.replace(/\.[^/.]+$/, '') ||
        previewData.fileName?.replace(/\.[^/.]+$/, '') ||
        'Table'
      const displaySourcePath = previewData.fileName || displayFileName
      return {
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: displaySourcePath,
        sourceType: previewData.sourceType,
        headerRow: previewData.headerRow || 0,
        // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
        sheetName: previewData.currentSheet,
        sourceMode: previewData.sourceMode,
        localPath: previewData.localPath,
      }
    },
    generateColumns: (sourceNode, existingColumns) => {
      const sourceData = sourceNode.data as SourcePreviewNodeData
      const tableData = sourceData.data
      if (!tableData || tableData.length === 0) {
        return existingColumns
      }
      const headerRowIndex = sourceData.headerRow ?? 0
      const headerRow = tableData[headerRowIndex] ?? []
      const sampleDataRow =
        headerRowIndex + 1 < tableData.length ? tableData[headerRowIndex + 1] : undefined
      return generateColumnsFromSource(headerRow, existingColumns, sampleDataRow, {
        forceReinferTypes: true,
      })
    },
    getSourceFields: (sourceNode) => {
      const sourceData = sourceNode.data as SourcePreviewNodeData
      const tableData = sourceData.data
      if (!tableData || tableData.length === 0) return undefined
      const headerRowIndex = sourceData.headerRow ?? 0
      const headerRow = tableData[headerRowIndex]
      if (!headerRow) return undefined
      return headerRow.map((h: unknown) => String(h).trim())
    },
    disconnectFields: [
      'sourceFile',
      'sourceFilePath',
      'sourceType',
      'headerRow',
      'sheetName',
      'sourceMode',
      'localPath',
    ],
    onSourceDataChanged: (data) => updateSchemaNodeFromSheetChange(props.id, data),
    nodeLabel: 'Schema',
    onSourceConnected: () => syncSchemaResources(props.id, { graphStore: store, projectStore }),
  })

  return {
    ...generic,
    generateColumnsFromHeaderData,
    updateSchemaNodeFromHeaderChangeSafe,
    updateSchemaNodeFromSheetChange,
  }
}
