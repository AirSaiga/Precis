/**
 * @file useDateLogic.ts
 * @description 日期逻辑约束组合式函数
 *
 * 功能概述:
 * - 提供日期逻辑约束节点的业务逻辑封装
 * - 支持日期比较和日期计算校验
 * - 通过后端 API 执行日期逻辑校验
 *
 * 架构设计:
 * - 基于 useConstraintBase 基础约束功能扩展
 * - 使用 graphStore 管理节点状态和图数据
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { DateLogicConstraintNodeData } from '@/types/constraints'

export interface DateLogicValidationResult {
  errorCount: number
  totalRows: number
  errors: Array<{
    row: number
    value: string
    message: string
  }>
}

/**
 * 根据节点数据构造 validation_config（camelCase → snake_case）。
 * 与 dateLogicHandler.ts 保持一致的映射逻辑。
 */
function buildValidationConfig(data: DateLogicConstraintNodeData): Record<string, unknown> {
  const config: Record<string, unknown> = {
    logic_mode: data.logicMode || 'compare',
  }

  if ((data.logicMode || 'compare') === 'compare') {
    config.compare_op = data.compareOp || 'gt'
    if (data.compareOp === 'range') {
      if (data.referenceDate) config.reference_date = data.referenceDate
      else config.reference_column = data.referenceColumn
      if (data.referenceDateEnd) config.reference_date_end = data.referenceDateEnd
      else config.reference_column_end = data.referenceColumnEnd
    } else {
      if (data.referenceDate) config.reference_date = data.referenceDate
      else config.reference_column = data.referenceColumn
    }
  } else {
    config.calculation_type = data.calculationType || 'age'
    // targetType 决定目标是固定值还是列（类型中为隐式字段，与 handler 对齐）
    const nodeData = data as unknown as Record<string, unknown>
    if (nodeData.targetType === 'value') config.target_value = data.targetValue
    else config.target_column = data.targetColumn
  }

  return config
}

export async function validateDateLogic(
  sourceFilePath: string,
  columnName: string,
  nodeData: DateLogicConstraintNodeData,
  sheetName?: string,
  headerRow?: number
): Promise<DateLogicValidationResult> {
  logger.debug('执行日期逻辑验证:', columnName)

  try {
    const validationApi = await import('@/api/validationApi')
    const apiValidateDateLogic = (validationApi as Record<string, unknown>)?.validateDateLogic as
      | ((
          req: Record<string, unknown>
        ) => Promise<{ success: boolean; data?: Record<string, unknown> }>)
      | undefined

    if (!apiValidateDateLogic) {
      logger.warn('日期逻辑验证 API 尚未实现')
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }

    const request = {
      validation_type: 'date_logic' as const,
      target_column_name: columnName,
      source_file_path: sourceFilePath,
      sheet_name: sheetName,
      header_row: headerRow,
      // 补全 validation_config，否则后端缺少 compare_op/reference_date 等参数，
      // 会落到默认分支返回 ConstraintConfigError 而非逐行校验结果
      validation_config: buildValidationConfig(nodeData),
    }

    const response = await apiValidateDateLogic(request)

    if (response.success && response.data) {
      const data = response.data as Record<string, unknown>
      return {
        errorCount: data.error_count as number,
        totalRows: data.total_rows as number,
        errors:
          (data.error_rows as Array<Record<string, unknown>>)?.map((err) => ({
            row: err.row_index as number,
            value: err.cell_value as string,
            message: '日期逻辑校验失败',
          })) ?? [],
      }
    }

    return {
      errorCount: 0,
      totalRows: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('日期逻辑验证失败:', error)
    throw error
  }
}

export function useDateLogic(
  props: { id: string; data: DateLogicConstraintNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
  const base = useConstraintBase(props, emit)

  const performValidation = async () => {
    logger.debug('执行日期逻辑验证:', props.id)

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

    return await validateDateLogic(
      actualFilePath,
      props.data.column,
      props.data,
      base.sourceInfo.value.sheetName,
      base.sourceInfo.value.headerRow
    )
  }

  const formatDateLogicErrors = (errors: Array<{ row: number }>): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 日期逻辑校验失败`)
  }

  return {
    ...base,
    performValidation,
    formatDateLogicErrors,
    validateDateLogic,
  }
}
