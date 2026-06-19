/**
 * @file useForeignKey.ts
 * @description 外键约束组合式函数
 *
 * 功能概述:
 * - 提供外键约束节点的业务逻辑封装
 * - 支持从 SourcePreview 或 Schema 节点提取目标参照值
 * - 通过后端 API 执行外键校验
 * - 管理校验状态（idle/pass/error/missing）和错误信息
 *
 * 架构设计:
 * - 基于 useConstraintBase 扩展外键特定功能
 * - 使用 graphStore 访问节点图数据
 * - 异步校验通过 validationApi 与后端通信
 *
 * 注：IndexedDB 模式已在 2026年3月移除
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { ForeignKeyConstraintNodeData } from '../types'
import { useGraphStore } from '@/stores/graphStore'
import { validateForeignKey } from '@/api/validationApi'
import { tryInlineValidation } from '@/composables/nodes/constraints/tryInlineValidation'
import { findJsonSchemaColumnById, extractJsonTargetValues } from '@/utils/nodes/json/columnFinder'

/**
 * 外键校验结果
 * @interface ValidationResult
 */
interface ValidationResult {
  /** 错误行数 */
  errorCount: number
  /** 总行数 */
  totalRows: number
  /** 详细错误列表 */
  errors: Array<{
    /** 行号（0-based） */
    row: number
    /** 单元格值 */
    value: unknown
    /** 错误信息 */
    message: string | undefined
  }>
}

/**
 * 外键约束组合式函数
 *
 * 封装外键约束节点的所有业务逻辑，包括：
 * - 目标值提取（从 SourcePreview 或 Schema 节点）
 * - 外键校验执行
 * - 错误格式化
 *
 * @param props - 组件属性，包含节点 ID 和数据
 * @param props.id - 节点唯一标识符
 * @param props.data - 外键约束节点数据
 * @param emit - Vue emit 函数，用于触发事件
 * @returns 外键约束相关方法和状态
 *
 * @example
 * ```ts
 * const { performValidation, formatForeignKeyErrors } = useForeignKey(
 *   { id: 'fk-1', data: foreignKeyData },
 *   emit
 * );
 * ```
 */
export function useForeignKey(
  props: { id: string; data: ForeignKeyConstraintNodeData },
  emit: any
) {
  const base = useConstraintBase(props, emit)
  const store = useGraphStore()

  /**
   * 获取 Schema 节点的列名
   *
   * 根据节点 ID 和列 ID 从图 Store 中查找对应的列名
   *
   * @param schemaNodeId - Schema 节点 ID
   * @param columnId - 列 ID
   * @returns 列名，如果未找到返回 null
   */
  const getSchemaColumnName = (schemaNodeId: string, columnId: string) => {
    const node = store.nodes.find((n) => n.id === schemaNodeId)
    if (!node || (node.type !== 'schema' && node.type !== 'jsonSchema')) return null

    if (node.type === 'jsonSchema') {
      const columns = ((node.data as unknown as Record<string, unknown>).columns as import('@/types/graph').JsonSchemaColumn[]) || []
      const found = findJsonSchemaColumnById(columns, columnId)
      return found?.column.columnName || null
    }

    const columns = ((node.data as unknown as Record<string, unknown>).columns as unknown[]) || []
    const col = columns.find((c: any) => c.id === columnId) as Record<string, unknown> | undefined
    return (col?.columnName as string) || null
  }

  /**
   * 从 SourcePreview 节点数据中提取目标列的所有值
   *
   * 解析表格数据，提取指定列的非空唯一值（最多 50000 个）
   *
   * @param sourcePreviewData - SourcePreview 节点数据
   * @param targetColumnName - 目标列名
   * @returns 去重后的目标值数组
   *
   * @remarks
   * - 使用 Set 去重，避免重复值
   * - 限制最多提取 50000 个值，防止内存溢出
   * - 自动处理 null/undefined 值
   */
  const extractTargetValuesFromSourcePreview = (
    sourcePreviewData: any,
    targetColumnName: string
  ) => {
    const tableData: string[][] | undefined = sourcePreviewData?.data
    if (!tableData || tableData.length === 0) return []

    const headerRow = sourcePreviewData?.headerRow ?? 0
    const header = tableData[headerRow] || []
    const colIndex = header.indexOf(targetColumnName)

    if (colIndex === -1) return []

    const values = new Set<string>()
    for (let i = headerRow + 1; i < tableData.length; i++) {
      const row = tableData[i] || []
      const raw = row[colIndex]
      const v = raw === null || raw === undefined ? '' : String(raw).trim()
      if (v) values.add(v)
      if (values.size > 50000) break
    }
    return Array.from(values)
  }

  /**
   * 获取目标节点的参照值列表
   *
   * 根据目标节点类型（SourcePreview 或 Schema），
   * 提取用于外键校验的目标列值
   *
   * @param targetNode - 目标节点对象
   * @param targetColumnName - 目标列名
   * @returns 目标值数组，如果无法提取返回空数组
   *
   * @remarks
   * - 如果目标节点是 SourcePreview，直接从其数据中提取
   * - 如果目标节点是 Schema，先找到关联的 SourcePreview 节点再提取
   */
  const getTargetValues = (targetNode: any, targetColumnName: string) => {
    if (!targetNode || !targetColumnName) return []

    if (targetNode.type === 'sourcePreview') {
      return extractTargetValuesFromSourcePreview(targetNode.data, targetColumnName)
    }

    if (targetNode.type === 'jsonSourcePreview') {
      return extractJsonTargetValues(
        ((targetNode.data as unknown as Record<string, unknown>)?.rawData as unknown[]) || [],
        targetColumnName
      )
    }

    if (targetNode.type === 'schema') {
      const sourceNodeId = (targetNode.data as unknown as Record<string, unknown>).sourceNodeId
      const sourcePreviewNode = store.nodes.find((n) => n.id === sourceNodeId)
      if (sourcePreviewNode?.type === 'sourcePreview') {
        return extractTargetValuesFromSourcePreview(sourcePreviewNode.data, targetColumnName)
      }
    }

    if (targetNode.type === 'jsonSchema') {
      const sourceNodeId = (targetNode.data as unknown as Record<string, unknown>).sourceNodeId
      const sourcePreviewNode = store.nodes.find((n) => n.id === sourceNodeId)
      if (sourcePreviewNode?.type === 'jsonSourcePreview') {
        return extractJsonTargetValues(
          ((sourcePreviewNode.data as unknown as Record<string, unknown>)?.rawData as unknown[]) || [],
          targetColumnName
        )
      }
    }
    return []
  }

  /**
   * 获取目标表的显示名称
   *
   * @param targetNode - 目标节点对象
   * @returns 目标表名称，如果未找到返回节点数据中配置的 targetTable
   *
   * @remarks
   * - Schema 节点：使用 tableName
   * - SourcePreview 节点：使用 sourceName 或 fileName
   */
  const getTargetTableName = (targetNode: any) => {
    if (!targetNode) return props.data.targetTable || ''
    if (targetNode.type === 'schema' || targetNode.type === 'jsonSchema')
      return ((targetNode.data as unknown as Record<string, unknown>).tableName as string) || ''
    if (targetNode.type === 'sourcePreview' || targetNode.type === 'jsonSourcePreview')
      return (
        ((targetNode.data as unknown as Record<string, unknown>).sourceName as string) ||
        ((targetNode.data as unknown as Record<string, unknown>).fileName as string) ||
        ''
      )
    return props.data.targetTable || ''
  }

  /**
   * 执行外键校验
   *
   * 验证源列的值是否都存在于目标列中
   *
   * @returns 校验结果对象，包含错误数量、总行数和详细错误
   *
   * @remarks
   * 校验流程：
   * 1. 检查源节点和目标节点是否已连接
   * 2. 验证节点类型（源必须是 Schema）
   * 3. 提取源文件路径和目标参照值
   * 4. 调用后端 API 执行校验
   * 5. 根据结果更新节点校验状态
   *
   * 可能的校验状态：
   * - 'idle': 未连接数据源或未选择列
   * - 'missing': 缺少必要信息（节点、列不存在）
   * - 'pass': 校验通过
   * - 'error': 校验失败或发现错误数据
   *
   * @throws 不会抛出异常，所有错误都会被捕获并更新到节点状态
   */
  const performValidation = async (): Promise<ValidationResult> => {
    logger.debug('🔄 执行外键验证:', props.id)

    try {
      const emptyResult: ValidationResult = {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }

      const sourceNodeId = props.data.sourceRef?.nodeId || props.data.sourceInfo?.nodeId
      const targetNodeId = props.data.targetRef?.nodeId || props.data.config?.targetNodeId

      if (!sourceNodeId || !targetNodeId) {
        logger.warn('⚠️ 缺少连接信息，无法执行外键校验')
        store.updateNodeData(props.id, {
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
      const targetNode = store.nodes.find((n) => n.id === targetNodeId)

      if (!sourceNode || !targetNode) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['找不到源节点或目标节点'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      if (sourceNode.type === 'manualData' || sourceNode.type === 'transformOutput') {
        await tryInlineValidation(store, { nodeId: sourceNode.id, columnId: '0' }, props.id)
        return emptyResult
      }

      if (sourceNode.type !== 'schema' && sourceNode.type !== 'jsonSchema') {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['外键校验的源必须是 Schema 节点'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const sourceSchemaData = sourceNode.data as unknown as Record<string, unknown>
      const sourceFilePath = sourceSchemaData.sourceFilePath
      const localPath = sourceSchemaData.localPath
      const sheetName = sourceSchemaData.sheetName as string
      const headerRow = sourceSchemaData.headerRow as number

      if (!sourceSchemaData.sourceFile) {
        return emptyResult
      }

      if (!sourceFilePath) {
        return emptyResult
      }

      const actualFilePath = localPath || sourceFilePath

      const sourceColumnName = props.data.sourceRef
        ? getSchemaColumnName(props.data.sourceRef.nodeId, props.data.sourceRef.columnId)
        : props.data.sourceInfo?.column || props.data.sourceColumn

      if (!sourceColumnName) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['源列不存在或已删除，无法执行外键校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const targetColumnName = props.data.config?.targetColumn || props.data.targetColumn

      if (!targetColumnName) {
        store.updateNodeData(props.id, {
          validationStatus: 'idle',
          validationErrors: ['请选择目标列后再进行校验'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const targetValues = getTargetValues(targetNode, targetColumnName)
      if (targetValues.length === 0) {
        store.updateNodeData(props.id, {
          validationStatus: 'missing',
          validationErrors: ['目标表缺少可用数据源或目标列不存在，无法提取参照值'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const targetTableName = getTargetTableName(targetNode)
      const validationConfig = {
        target_table: targetTableName,
        target_column: targetColumnName,
        target_values: targetValues,
      }

      const response = await validateForeignKey({
        validation_type: 'foreign_key',
        target_column_name: sourceColumnName,
        source_file_path: String(actualFilePath),
        sheet_name: sheetName,
        header_row: headerRow,
        validation_config: validationConfig,
      })

      if (!response.success || !response.data) {
        store.updateNodeData(props.id, {
          validationStatus: 'error',
          validationErrors: response.error ? [String(response.error)] : ['外键校验失败'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      let errorRows = response.data.error_rows || []
      if (props.data.allowNull) {
        errorRows = errorRows.filter((err) => {
          const v = err?.cell_value
          if (v === null || v === undefined) return false
          return String(v).trim() !== ''
        })
      }

      const errorCount = errorRows.length
      const totalRows = response.data.total_rows || 0
      const matchCount = Math.max(0, totalRows - errorCount)

      const formattedErrors = errorRows.map((err: any) => ({
        row: err.row_index,
        value: err.cell_value,
        message: err.error_message,
      }))

      store.updateNodeData(props.id, {
        validationStatus: errorCount > 0 ? 'error' : 'pass',
        validationErrors: formatForeignKeyErrors(formattedErrors),
        lastValidation: {
          totalRows,
          errorCount,
          matchCount,
        },
      })

      return {
        errorCount,
        totalRows,
        errors: formattedErrors,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: [message],
        lastValidation: undefined,
      })
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }
  }

  /**
   * 格式化外键校验错误信息
   *
   * 将错误对象数组转换为可读的字符串数组
   *
   * @param errors - 错误对象数组，每个对象包含 row 和 message
   * @returns 格式化后的错误信息字符串数组
   *
   * @example
   * ```ts
   * const errors = [{ row: 5, message: '值不存在' }];
   * const formatted = formatForeignKeyErrors(errors);
   * // ['第 6 行: 值不存在']
   * ```
   */
  const formatForeignKeyErrors = (errors: any[]): string[] => {
    return errors.map((err) => `第 ${Number(err.row) + 1} 行: ${err.message}`)
  }

  return {
    ...base,
    performValidation,
    formatForeignKeyErrors,
  }
}
