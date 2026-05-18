/**
 * @file useSchemaSourceManager.ts
 * @description Schema数据源连接管理
 * 负责Schema节点与数据源节点的连接状态管理、断开连接、列生成等组件级操作
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import { useNodeSourceManager } from '../shared/useNodeSourceManager'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import type { SchemaNodeData, SourcePreviewNodeData } from '@/types/graph'

export function useSchemaSourceManager(props: { id: string; data: SchemaNodeData }, emit: any) {
  const store = useGraphStore()

  // ============================================================================
  // Schema 特有方法
  // ============================================================================

  /**
   * 从表头数据生成列定义
   */
  const generateColumnsFromHeaderData = (
    headerData: any[],
    schemaNode: any,
    tableData?: any[][],
    headerRowIndex?: number
  ) => {
    if (!headerData || headerData.length === 0) {
      logger.warn('表头数据为空')
      return
    }

    let sampleDataRow: any[] | undefined
    if (tableData && typeof headerRowIndex === 'number' && headerRowIndex + 1 < tableData.length) {
      sampleDataRow = tableData[headerRowIndex + 1]
    }

    const columns = generateColumnsFromSource(
      headerData,
      schemaNode.data.columns || [],
      sampleDataRow,
      { forceReinferTypes: true }
    )

    const updatedSchemaData = {
      ...schemaNode.data,
      columns,
    }

    store.updateNodeData(schemaNode.id, updatedSchemaData)
    logger.debug(`✅ 智能列生成完成！共 ${columns.length} 列`)
  }

  /**
   * 安全更新 Schema 节点的表头变更
   */
  const updateSchemaNodeFromHeaderChangeSafe = (schemaNodeId: string, headerData: any[]) => {
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    const schemaNodeData = schemaNode.data as SchemaNodeData
    const sourceFile = schemaNodeData?.sourceFile
    const sourceFilePath = schemaNodeData?.sourceFilePath

    if (sourceFile && sourceFilePath) {
      const shouldRegenerate = confirm(
        `检测到表头已变更，是否基于新表头 "${headerData.join(', ')}" 重新生成列定义？`
      )

      if (shouldRegenerate) {
        generateColumnsFromHeaderData(headerData, schemaNode)
      }
    }
  }

  /**
   * 从工作表变更更新 Schema 节点
   */
  const updateSchemaNodeFromSheetChange = (schemaNodeId: string, sheetData: any) => {
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    if (!sheetData || !sheetData.data || sheetData.data.length === 0) {
      logger.warn('工作表数据为空')
      return
    }

    // 1. 准备元数据
    const sourceData = sheetData
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

    store.updateNodeData(schemaNodeId, updatedSchemaData)
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
      const oldColumnNames = existingColumns.map((col: any) => String(col.columnName).trim())
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
      if (targetNode) {
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
        (nodeId: string, data: any) => {
          store.updateNodeData(nodeId, data)
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
      const displayFileName = sourceData.sourceName || sourceData.fileName || 'Unknown'
      const smartTableName =
        sourceData.currentSheet ||
        sourceData.sourceName?.replace(/\.[^/.]+$/, '') ||
        sourceData.fileName?.replace(/\.[^/.]+$/, '') ||
        'Table'
      const displaySourcePath = sourceData.fileName || displayFileName
      return {
        tableName: smartTableName,
        sourceFile: displayFileName,
        sourceFilePath: displaySourcePath,
        sourceType: sourceData.sourceType,
        headerRow: sourceData.headerRow || 0,
        // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
        sheetName: sourceData.currentSheet,
        sourceMode: sourceData.sourceMode,
        localPath: sourceData.localPath,
      }
    },
    generateColumns: (sourceNode, existingColumns) => {
      const sourceData = sourceNode.data as SourcePreviewNodeData
      const tableData = sourceData.data
      if (!tableData || tableData.length === 0) {
        return existingColumns
      }
      const headerRowIndex = sourceData.headerRow ?? 0
      const headerRow = tableData[headerRowIndex]
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
      return headerRow.map((h: any) => String(h).trim())
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
    eventName: 'sourcePreviewDataChanged',
    onSourceDataChanged: (data) => updateSchemaNodeFromSheetChange(props.id, data),
    nodeLabel: 'Schema',
  })

  return {
    ...generic,
    generateColumnsFromHeaderData,
    updateSchemaNodeFromHeaderChangeSafe,
    updateSchemaNodeFromSheetChange,
  }
}
