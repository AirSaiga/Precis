/**
 * @file useRange.ts
 * @description 区间约束组合式函数
 *
 * 功能概述:
 * - 提供区间约束节点的业务逻辑封装
 * - 支持数值范围和日期范围的校验
 * - 通过后端 API 执行区间校验
 *
 * 架构设计:
 * - 基于 useConstraintBase 基础约束功能扩展
 * - 使用 graphStore 管理节点状态和图数据
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { RangeConstraintNodeData } from '@/types/constraints'
import { validateRange as apiValidateRange, type ValidationErrorRow } from '@/api/validationApi'

export interface RangeValidationResult {
  errorCount: number
  totalRows: number
  errors: Array<{
    row: number
    value: string
    message: string
  }>
}

export async function validateRange(
  sourceFilePath: string,
  columnName: string,
  sheetName?: string,
  headerRow?: number,
  columnDataType?: string
): Promise<RangeValidationResult> {
  logger.debug('执行区间验证:', columnName)

  try {
    const request = {
      validation_type: 'range' as const,
      target_column_name: columnName,
      source_file_path: sourceFilePath,
      sheet_name: sheetName,
      header_row: headerRow,
      column_data_type: columnDataType,
    }

    const response = await apiValidateRange(request)

    if (response.success && response.data) {
      return {
        errorCount: response.data.error_count,
        totalRows: response.data.total_rows,
        errors: response.data.error_rows.map((err: ValidationErrorRow) => ({
          row: err.row_index,
          value: err.cell_value,
          message: '数值不在允许范围内',
        })),
      }
    }

    return {
      errorCount: 0,
      totalRows: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('区间验证失败:', error)
    throw error
  }
}

type ConstraintNodeEmit = {
  (
    event: 'schemaConnected',
    payload: { nodeId: string; schemaNodeId: string; columnId: string; columnName: string }
  ): void
  (event: 'schemaDisconnected', payload: { nodeId: string }): void
  (event: 'validationCompleted', payload: { nodeId: string; result: unknown }): void
  (event: 'validationErrors', payload: { nodeId: string; errors: unknown[] }): void
  (event: 'configUpdated', payload: { nodeId: string; config: Record<string, unknown> }): void
}

export function useRange(
  props: { id: string; data: RangeConstraintNodeData },
  emit: ConstraintNodeEmit
) {
  const base = useConstraintBase(props, emit)

  const performValidation = async () => {
    logger.debug('执行区间验证:', props.id)

    if (!base.sourceInfo.value) {
      logger.warn('未连接 Schema，无法执行验证')
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }

    if (!base.sourceInfo.value.sourceFile) {
      logger.warn('源表未连接数据源，跳过验证')
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }

    const { localPath, sourceFilePath } = base.sourceInfo.value
    const actualFilePath = localPath || sourceFilePath

    return await validateRange(
      actualFilePath,
      props.data.column,
      base.sourceInfo.value.sheetName,
      base.sourceInfo.value.headerRow,
      base.sourceInfo.value.columnDataType
    )
  }

  const formatRangeErrors = (errors: Array<{ row: number }>): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 数值不在允许范围内`)
  }

  return {
    ...base,
    performValidation,
    formatRangeErrors,
    validateRange,
  }
}
