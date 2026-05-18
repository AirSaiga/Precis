/**
 * @file useColumnGeneration.ts
 * @description 列生成
 * 负责列生成、类型推断（Schema节点的特定功能）
 */

import { logger } from '@/core/utils/logger'
import { useI18n } from 'vue-i18n'
import type { DataType, SchemaColumn } from '../types'
import { inferDataType, inferColumnType } from '@/utils/nodes/schema/typeInference'

/**
 * 列生成
 * @param props - 组件属性
 * @returns 列生成相关的方法
 */
export function useColumnGeneration(props: { data: any }) {
  const { t } = useI18n()

  // 使用统一的类型推断工具
  // inferDataType 和 inferColumnType 已从 utils/typeInference 导入

  /**
   * 推断列数据类型
   * @param columnData - 列数据数组
   * @returns 推断的数据类型
   */
  const inferColumnTypes = (columnData: any[]): DataType => {
    return inferColumnType(columnData)
  }

  /**
   * 从表头生成列定义
   * @param headerData - 表头数据数组
   * @param tableData - 完整表格数据（用于类型推断）
   * @param headerRowIndex - 表头行索引
   * @returns 列定义数组
   */
  const generateColumnsFromHeader = (
    headerData: any[],
    tableData?: any[][],
    headerRowIndex?: number
  ): SchemaColumn[] => {
    if (!headerData || headerData.length === 0) {
      logger.error('表头数据为空')
      return []
    }

    const columns = headerData.map((header: any, index: number) => {
      const headerText = String(header).trim()
      const columnName = headerText || `column_${index + 1}`

      let dataType: DataType = 'String'

      if (tableData && typeof headerRowIndex === 'number') {
        if (headerRowIndex + 1 < tableData.length) {
          const sampleData = tableData[headerRowIndex + 1]
          if (sampleData && sampleData[index] !== undefined) {
            dataType = inferDataType(sampleData[index])
          }
        }
      }

      return {
        id: columnName,
        columnName: columnName,
        dataType: dataType,
        expressionType: 'none' as const,
        isBound: false,
        constraints: {},
        validationErrors: [],
      }
    })

    return columns
  }

  /**
   * 从数据源生成列定义
   * @param sourceData - 数据源数据
   * @returns 列定义数组
   */
  const generateColumnsFromSource = (sourceData: any): SchemaColumn[] => {
    if (!sourceData || !sourceData.data || sourceData.data.length === 0) {
      logger.error('数据源为空')
      return []
    }

    const headerRowIndex = sourceData.headerRow ?? 0
    const headerRow = sourceData.data[headerRowIndex]

    if (!headerRow) {
      logger.error('表头行数据不存在')
      return []
    }

    return generateColumnsFromHeader(headerRow, sourceData.data, headerRowIndex)
  }

  /**
   * 合并列定义
   * @param existingColumns - 现有列定义
   * @param newColumns - 新列定义
   * @returns 合并后的列定义
   */
  const mergeColumns = (
    existingColumns: SchemaColumn[],
    newColumns: SchemaColumn[]
  ): SchemaColumn[] => {
    const mergedColumns: SchemaColumn[] = []

    newColumns.forEach((newColumn) => {
      const existingColumn = existingColumns.find((col) => col.columnName === newColumn.columnName)

      if (existingColumn) {
        mergedColumns.push({
          ...newColumn,
          id: existingColumn.id,
          expressionType: existingColumn.expressionType,
          constraints: existingColumn.constraints,
          validationErrors: existingColumn.validationErrors,
        })
      } else {
        mergedColumns.push(newColumn)
      }
    })

    return mergedColumns
  }

  return {
    inferDataType,
    inferColumnTypes,
    generateColumnsFromHeader,
    generateColumnsFromSource,
    mergeColumns,
  }
}
