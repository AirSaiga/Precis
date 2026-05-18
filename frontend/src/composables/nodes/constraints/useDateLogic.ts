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

export async function validateDateLogic(
  sourceFilePath: string,
  columnName: string,
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

export function useDateLogic(props: { id: string; data: DateLogicConstraintNodeData }, emit: any) {
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
      base.sourceInfo.value.sheetName,
      base.sourceInfo.value.headerRow
    )
  }

  const formatDateLogicErrors = (errors: any[]): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 日期逻辑校验失败`)
  }

  return {
    ...base,
    performValidation,
    formatDateLogicErrors,
    validateDateLogic,
  }
}
