/**
 * @file TabularColumnGenerator.ts
 * @description Excel/CSV 表格数据列生成策略
 *
 * 从二维数组表头生成 SchemaColumn 定义，支持类型推断和列合并。
 */

import { logger } from '@/core/utils/logger'
import { inferDataType } from '../schema/typeInference'
import type { ColumnGenerationStrategy, ColumnComparisonResult } from './types'

interface TabularGenerateOptions {
  /** 是否强制重新推断类型 */
  forceReinferTypes?: boolean
  /** 是否跳过 column_1 过滤 */
  skipColumn1Filter?: boolean
}

/** 可比较的列定义（兼容 SchemaColumn） */
interface ComparableColumn {
  columnName: string
  dataType?: string
  expressionType?: string
  isBound?: boolean
  extractedConfig?: unknown
  id?: string
  constraints?: Record<string, unknown>
  validationErrors?: string[]
}

export class TabularColumnGenerator implements ColumnGenerationStrategy {
  /**
   * 从表格数据生成列定义
   *
   * @param rawData - 二维数组 [headerRow, ...dataRows] 或单个 headerRow
   * @param existingColumns - 现有列定义
   * @returns 新生成的列定义
   */
  generate(rawData: unknown, existingColumns: unknown[]): unknown[] {
    let headerRow: unknown[]
    let sampleDataRow: unknown[] | undefined

    if (Array.isArray(rawData) && rawData.length > 0) {
      if (Array.isArray(rawData[0])) {
        // rawData 是 string[][] 格式
        const rows = rawData as unknown[][]
        headerRow = rows[0] ?? []
        sampleDataRow = rows.length > 1 ? rows[1] : undefined
      } else {
        // rawData 是单个 headerRow
        headerRow = rawData as unknown[]
      }
    } else {
      return []
    }

    if (!headerRow || headerRow.length === 0) return []

    const existingCols = existingColumns as ComparableColumn[]
    const options: TabularGenerateOptions = { forceReinferTypes: true }

    // 构建列名到原列定义的映射
    const originalColumnMap = new Map<string, ComparableColumn>()
    existingCols.forEach((col) => {
      originalColumnMap.set(String(col.columnName).trim(), col)
    })

    // 获取源数据列名
    const sourceColumnNames = headerRow.map((header, index) => {
      const headerText = String(header).trim()
      return headerText || `column_${index + 1}`
    })

    const columns: ComparableColumn[] = []
    const processedColumnNames = new Set<string>()

    // 处理源数据中的列
    sourceColumnNames.forEach((columnName, index) => {
      processedColumnNames.add(columnName)

      const existingColumn = originalColumnMap.get(columnName)
      let inferredDataType: string | undefined

      if (sampleDataRow && sampleDataRow[index] !== undefined) {
        inferredDataType = inferDataType(sampleDataRow[index])
      }

      if (existingColumn) {
        let finalDataType: string
        if (options.forceReinferTypes && inferredDataType) {
          finalDataType = inferredDataType
        } else {
          finalDataType = existingColumn.dataType || inferredDataType || 'String'
        }

        columns.push({
          ...existingColumn,
          dataType: finalDataType,
        })
      } else {
        columns.push({
          id: columnName,
          columnName: columnName,
          dataType: inferredDataType || 'String',
          expressionType: 'none',
          constraints: {},
          validationErrors: [],
        })
      }
    })

    // 保留源数据中没有但 Schema 中有的衍生列
    existingCols.forEach((col) => {
      const colName = String(col.columnName).trim()
      if (processedColumnNames.has(colName)) return

      const isDerived = col.expressionType === 'implicit' || col.expressionType === 'explicit'
      const isBound = col.isBound === true
      const isExtracted = !!col.extractedConfig

      if (isDerived || isBound || isExtracted) {
        columns.push(col)
      }
    })

    return columns
  }

  /**
   * 双向比较数据源列名与 Schema 列定义
   */
  compare(sourceFields: string[], existingColumns: unknown[]): ColumnComparisonResult {
    const schemaCols = existingColumns as ComparableColumn[]
    const schemaEmpty = schemaCols.length === 0

    if (schemaEmpty) {
      return { schemaEmpty: true, newInSource: [], staleInSchema: [], isMatch: false, needsAction: true }
    }

    const sourceSet = new Set(sourceFields)
    const schemaNameSet = new Set(schemaCols.map((c) => c.columnName.trim()))

    const newInSource = sourceFields.filter((name) => !schemaNameSet.has(name))

    const staleInSchema = schemaCols
      .filter((col) => {
        if (sourceSet.has(col.columnName.trim())) return false
        const isDerived = col.expressionType === 'implicit' || col.expressionType === 'explicit'
        const isBound = col.isBound === true
        const isExtracted = !!col.extractedConfig
        return !(isDerived || isBound || isExtracted)
      })
      .map((c) => c.columnName.trim())

    const isMatch = newInSource.length === 0

    return {
      schemaEmpty: false,
      newInSource,
      staleInSchema,
      isMatch,
      needsAction: !isMatch,
    }
  }

  /**
   * 从预览数据中提取源字段（表头）
   */
  extractSourceFields(previewData: Record<string, unknown>): string[] | undefined {
    const data = previewData.data as unknown[][] | undefined
    if (!data || data.length === 0) return undefined

    const headerRow = data[0]
    if (!headerRow || headerRow.length === 0) return undefined

    return headerRow.map((h) => String(h).trim())
  }
}

/** 默认实例 */
export const tabularColumnGenerator = new TabularColumnGenerator()
