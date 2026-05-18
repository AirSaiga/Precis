/**
 * @file useCharset.ts
 * @description 字符集约束组合式函数
 *
 * 功能概述:
 * - 提供字符集约束节点的业务逻辑封装
 * - 检测列数据是否符合指定字符集编码
 * - 通过后端 API 执行字符集校验
 *
 * 架构设计:
 * - 基于 useConstraintBase 基础约束功能扩展
 * - 使用 graphStore 管理节点状态和图数据
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { CharsetConstraintNodeData } from '@/types/constraints'
import { validateCharset as apiValidateCharset } from '@/api/validationApi'

export interface CharsetValidationResult {
  errorCount: number
  totalRows: number
  errors: Array<{
    row: number
    value: string
    message: string
  }>
}

export async function validateCharset(
  sourceFilePath: string,
  columnName: string,
  sheetName?: string,
  headerRow?: number
): Promise<CharsetValidationResult> {
  logger.debug('执行字符集验证:', columnName)

  try {
    const request = {
      validation_type: 'charset' as const,
      target_column_name: columnName,
      source_file_path: sourceFilePath,
      sheet_name: sheetName,
      header_row: headerRow,
    }

    const response = await apiValidateCharset(request)

    if (response.success && response.data) {
      return {
        errorCount: response.data.error_count,
        totalRows: response.data.total_rows,
        errors: response.data.error_rows.map((err: any) => ({
          row: err.row_index,
          value: err.cell_value,
          message: '字符集校验失败',
        })),
      }
    }

    return {
      errorCount: 0,
      totalRows: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('字符集验证失败:', error)
    throw error
  }
}

export function useCharset(props: { id: string; data: CharsetConstraintNodeData }, emit: any) {
  const base = useConstraintBase(props, emit)

  const performValidation = async () => {
    logger.debug('执行字符集验证:', props.id)

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

    return await validateCharset(
      actualFilePath,
      props.data.column,
      base.sourceInfo.value.sheetName,
      base.sourceInfo.value.headerRow
    )
  }

  const formatCharsetErrors = (errors: any[]): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 字符集校验失败`)
  }

  return {
    ...base,
    performValidation,
    formatCharsetErrors,
    validateCharset,
  }
}
