/**
 * @file columnGeneration.ts
 * @description 智能列生成工具函数
 * @deprecated 迁移至 columnGeneration/TabularColumnGenerator.ts
 */

import type { SchemaColumn, DataType } from '@/types/graph'
import { inferDataType } from './typeInference'
/**
 * 智能列生成工具函数
 *
 * 统一处理从数据源生成 Schema 列定义的逻辑
 * 核心策略：Merge/Update (合并/更新)
 * 1. 源数据中存在的列：优先复用 Schema 中已有的同名列（保留 ID、约束、类型），否则创建新列
 * 2. 源数据中不存在的列：保留（视为用户添加的计算列或正则提取列），但过滤掉未修改的默认 column_1
 */

interface GenerateColumnsOptions {
  /**
   * 是否跳过 column_1 的过滤检查
   * 默认 false (执行过滤)
   */
  skipColumn1Filter?: boolean
  /**
   * 是否强制重新推断类型
   * 默认 false (保留现有列的类型)
   * 当为 true 时，即使是已存在的列也会根据样本数据重新推断类型
   */
  forceReinferTypes?: boolean
}

/**
 * 从源数据生成列定义
 * @param sourceHeaderRow 表头行数据 (列名数组)
 * @param existingColumns 现有的列定义数组
 * @param sampleDataRow 样本数据行 (用于类型推断)
 * @param options 配置选项
 * @returns 新生成的列定义数组
 */
export function generateColumnsFromSource(
  sourceHeaderRow: unknown[],
  existingColumns: unknown[] = [],
  sampleDataRow?: unknown[],
  options: GenerateColumnsOptions = {}
): SchemaColumn[] {
  if (!sourceHeaderRow) return []

  // 1. 构建列名到原列定义的映射，用于快速查找
  const originalColumnMap = new Map<string, SchemaColumn>()
  existingColumns.forEach((raw) => {
    const col = raw as Partial<SchemaColumn>
    if (col.columnName) {
      originalColumnMap.set(col.columnName.trim(), col as SchemaColumn)
    }
  })

  // 2. 获取源数据的列名列表
  const sourceColumnNames = sourceHeaderRow.map((header, index) => {
    const headerText = String(header).trim()
    return headerText || `column_${index + 1}`
  })

  const columns: SchemaColumn[] = []
  const processedColumnNames = new Set<string>()

  // 3. 第一遍：处理源数据中的列
  sourceColumnNames.forEach((columnName: string, index: number) => {
    processedColumnNames.add(columnName)

    // 检查原 Schema 中是否存在同名列
    const existingColumn = originalColumnMap.get(columnName)

    // 推断数据类型（如果需要）
    let inferredDataType: DataType | undefined
    if (sampleDataRow && sampleDataRow[index] !== undefined) {
      inferredDataType = inferDataType(sampleDataRow[index])
    }

    if (existingColumn) {
      // 列名匹配，保留原有定义（包括 ID、约束）
      // 但如果 forceReinferTypes 为 true，则使用重新推断的类型
      // logger.debug(`  ✅ 保留原有列定义: ${columnName} (id: ${existingColumn.id})`);

      // 确定最终的数据类型
      let finalDataType: DataType
      if (options.forceReinferTypes && inferredDataType) {
        // 强制重新推断类型
        finalDataType = inferredDataType
      } else {
        // 保留原有类型，如果没有则使用推断的类型，默认为 String
        finalDataType = existingColumn.dataType || inferredDataType || 'String'
      }

      columns.push({
        ...existingColumn,
        dataType: finalDataType,
      })
    } else {
      // 新列，生成新定义
      // logger.debug(`  🆕 新增列: ${columnName}`);

      // 推断数据类型
      const dataType: DataType = inferredDataType || 'String'

      columns.push({
        id: columnName, // 新列使用列名作为 ID
        columnName: columnName,
        dataType: dataType,
        expressionType: 'none',
        constraints: {},
        validationErrors: [],
      })
    }
  })

  // 4. 第二遍：保留源数据中没有但 Schema 中有的列（来自其他节点，如 Regex）
  existingColumns.forEach((raw) => {
    const col = raw as Partial<SchemaColumn>
    const colName = String(col.columnName ?? '').trim()

    // 如果该列已经在第一遍（源数据）中处理过，跳过
    if (processedColumnNames.has(colName)) {
      return
    }

    // 策略更新：
    // 只有明确标记为衍生列（implicit/explicit）或已绑定（isBound）的列才会被保留。
    // 普通列（expressionType 为 none 或 undefined）被视为旧源的残留，将被丢弃。
    // 这解决了切换源时旧列残留的问题，同时也自动过滤了默认的 column_1。
    const isDerived = col.expressionType === 'implicit' || col.expressionType === 'explicit'
    const isBound = col.isBound === true
    const isExtracted = !!col.extractedConfig

    if (isDerived || isBound || isExtracted) {
      columns.push(col as SchemaColumn)
    }
  })

  return columns
}
