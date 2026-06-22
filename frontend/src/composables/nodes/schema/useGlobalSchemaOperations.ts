/**
 * @file useGlobalSchemaOperations.ts
 * @description 全局 Schema 操作
 * 提供在画布级别使用的 Schema 操作方法
 * 封装通用的 Schema 节点操作逻辑，供其他模块调用
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useI18n } from 'vue-i18n'
import { useVueFlow } from '@vue-flow/core'
import { generateColumnsFromSource } from '@/utils/nodes/schema/columnGeneration'
import type { SchemaNodeData } from '@/types/graph'

/**
 * 全局 Schema 操作
 * 提供跨组件、跨模块的 Schema 节点操作接口
 * 包括列生成、表头更新、工作表切换等功能
 * @returns 包含各种 Schema 操作方法的对象
 */
export function useGlobalSchemaOperations() {
  // 获取全局图存储，用于访问和修改节点数据
  const store = useGraphStore()
  const { showConfirm } = useGlobalConfirm()
  const { t } = useI18n()
  // 从 VueFlow 获取节点和边的操作方法
  // getConnectedEdges: 获取连接到指定节点的边
  // findNode: 根据 ID 查找节点
  const { getConnectedEdges, findNode } = useVueFlow()

  /**
   * 从表头数据生成列定义
   * 读取表头行数据，为每个列生成列定义对象
   * 根据数据样本推断列的数据类型
   *
   * 处理流程：
   * 1. 验证输入参数的有效性
   * 2. 遍历表头数据，为每个列生成定义
   * 3. 根据数据样本推断数据类型
   * 4. 更新 Schema 节点数据
   *
   * @param headerData - 表头数据数组，每个元素代表一列的名称
   * @param schemaNodeId - 要更新列定义的 Schema 节点 ID
   * @param tableData - 完整表格数据，用于数据类型推断（可选）
   * @param headerRowIndex - 表头行索引，指示哪一行是表头（可选，默认为 0）
   */
  const generateColumnsFromHeaderData = (
    headerData: unknown[],
    schemaNodeId: string,
    tableData?: unknown[][],
    headerRowIndex?: number
  ) => {
    // 在 store 的 nodes 数组中查找目标 Schema 节点
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)

    // 如果未找到节点，记录警告日志并返回
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    // 检查表头数据是否有效
    if (!headerData || headerData.length === 0) {
      logger.warn('表头数据为空')
      return
    }

    // 获取样本数据行（下一行）
    let sampleDataRow: unknown[] | undefined
    if (tableData && typeof headerRowIndex === 'number' && headerRowIndex + 1 < tableData.length) {
      sampleDataRow = tableData[headerRowIndex + 1]
    }

    // 调用统一的列生成工具
    // forceReinferTypes: true 表示强制重新推断所有列的类型
    const schemaData = schemaNode.data as unknown as SchemaNodeData
    const columns = generateColumnsFromSource(headerData, schemaData.columns || [], sampleDataRow, {
      forceReinferTypes: true,
    })

    const updatedSchemaData = {
      ...schemaData,
      columns: columns,
    }

    store.updateNodeData(schemaNodeId, updatedSchemaData)
    logger.debug(`✅ [Global] 智能列生成完成！共 ${columns.length} 列`)
  }

  /**
   * 安全更新 Schema 节点的表头变更
   * 当用户修改表头时，询问是否重新生成列定义
   * 如果用户确认，则调用 generateColumnsFromHeaderData 生成新列定义
   *
   * 设计考量：
   * - 使用异步 confirm 对话框确保用户必须明确选择
   * - 避免意外覆盖用户已配置的列约束
   *
   * @param schemaNodeId - Schema 节点 ID
   * @param headerData - 新的表头数据数组
   */
  const updateSchemaNodeFromHeaderChangeSafe = async (
    schemaNodeId: string,
    headerData: unknown[]
  ) => {
    // 查找目标 Schema 节点
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    // 检查节点是否已连接数据源
    const sData = schemaNode.data as unknown as SchemaNodeData
    const sourceFile = sData.sourceFile
    const sourceFilePath = sData.sourceFilePath

    // 如果已连接数据源，询问用户是否重新生成列定义
    if (sourceFile && sourceFilePath) {
      const shouldRegenerate = await showConfirm({
        title: t('common.confirmDialog.title'),
        message: `检测到表头已变更，是否基于新表头 "${headerData.join(', ')}" 重新生成列定义？`,
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
        type: 'warning',
      })

      // 如果用户确认，重新生成列定义
      if (shouldRegenerate) {
        generateColumnsFromHeaderData(headerData, schemaNodeId)
      }
    }
  }

  /**
   * 从工作表变更更新 Schema 节点
   * 当用户切换 Excel 工作表时，更新 Schema 节点的元数据
   *
   * @param schemaNodeId - Schema 节点 ID
   * @param sheetData - 工作表数据对象，包含新工作表的信息
   */
  const updateSchemaNodeFromSheetChange = (
    schemaNodeId: string,
    sheetData: Record<string, unknown>
  ) => {
    // 查找目标 Schema 节点
    const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) {
      logger.warn(`Schema 节点 ${schemaNodeId} 不存在`)
      return
    }

    // 检查工作表数据是否有效
    if (!sheetData || !Array.isArray(sheetData.data) || sheetData.data.length === 0) {
      logger.warn('工作表数据为空')
      return
    }

    // 提取工作表数据
    const sourceData = sheetData
    // 生成表名：优先使用当前工作表名，否则使用文件名去掉扩展名
    const currentSheet = typeof sourceData.currentSheet === 'string' ? sourceData.currentSheet : ''
    const fileName = typeof sourceData.fileName === 'string' ? sourceData.fileName : ''
    const smartTableName = currentSheet || fileName.replace(/\.[^/.]+$/, '') || 'Table'

    // 构建更新后的 Schema 数据对象
    const updatedSchemaData = {
      ...schemaNode.data, // 保留现有数据
      tableName: smartTableName, // 更新表名
      sourceFile: fileName, // 更新源文件名
      sourceFilePath: typeof sourceData.localPath === 'string' ? sourceData.localPath : undefined, // 更新源文件路径
      sourceType: sourceData.sourceType, // 更新源类型
      headerRow: typeof sourceData.headerRow === 'number' ? sourceData.headerRow : 0, // 更新表头行号
      // 仅使用实际的工作表名称；若缺失则保持 undefined，绝不回退到文件名
      sheetName: currentSheet || undefined, // 更新工作表名
    }

    // 更新节点数据
    store.updateNodeData(schemaNodeId, updatedSchemaData)

    // 记录更新成功日志
    logger.debug(`✅ Schema "${smartTableName}" 已更新`)
  }

  /**
   * 查找已连接的 Schema 节点
   * 根据源节点 ID 查找所有连接到该节点的 Schema 节点
   *
   * @param sourceNodeId - 数据源节点 ID
   * @returns 已连接的 Schema 节点数组
   */
  const findConnectedSchemaNodes = (sourceNodeId: string) => {
    // 使用 findNode 查找源节点
    const sourceNode = findNode(sourceNodeId)
    if (!sourceNode) {
      // 如果未找到源节点，返回空数组
      return []
    }

    const connectedEdges = getConnectedEdges([sourceNode])

    const schemaNodeIds = connectedEdges
      .filter((edge) => edge.target.startsWith('schema-'))
      .map((edge) => edge.target)

    const schemaNodes = store.nodes.filter((node) => schemaNodeIds.includes(node.id))

    return schemaNodes
  }

  return {
    generateColumnsFromHeaderData,
    updateSchemaNodeFromHeaderChangeSafe,
    updateSchemaNodeFromSheetChange,
    findConnectedSchemaNodes,
  }
}
