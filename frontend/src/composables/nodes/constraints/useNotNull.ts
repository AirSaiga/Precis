/**
 * @file useNotNull.ts
 * @description 非空约束
 * 负责非空约束的特定逻辑
 * 提供非空约束节点的验证方法和数据处理功能
 *
 * 注：IndexedDB 模式已在 2026年3月移除
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { NotNullConstraintNodeData } from '../types'
import { validateNotNull as apiValidateNotNull } from '@/api/validationApi'

/**
 * 非空验证结果类型
 * 定义非空约束验证返回的数据结构
 */
export interface NotNullValidationResult {
  /** 检测到的空值数量 */
  errorCount: number
  /** 总行数 */
  totalRows: number
  /** 错误详情数组 */
  errors: Array<{
    /** 行号 */
    row: number
    /** 空值 */
    value: string
    /** 错误消息 */
    message: string
  }>
}

/**
 * 执行非空约束校验（独立函数）
 * 根据文件路径判断数据存储模式并调用相应的验证方法执行校验
 *
 * 架构变更（2026年3月）：
 * - 移除了 IndexedDB 模式支持
 * - 现在只支持本地文件路径模式
 *
 * @param sourceFilePath - 源文件路径
 * @param columnName - 要校验的列名
 * @param sheetName - 工作表名称（可选）
 * @param headerRow - 表头行索引（可选，默认为 0）
 * @returns 包含校验结果的 NotNullValidationResult 对象
 */
export async function validateNotNull(
  sourceFilePath: string,
  columnName: string,
  sheetName?: string,
  headerRow?: number,
  jsonOptions?: { jsonPath?: string; jsonFormat?: string; recordPath?: string; columnDataType?: string }
): Promise<NotNullValidationResult> {
  logger.debug('🔄 执行非空验证:', columnName)

  try {
    const request = {
      validation_type: 'not_null' as const,
      target_column_name: columnName,
      source_file_path: sourceFilePath,
      sheet_name: sheetName,
      header_row: headerRow,
      column_data_type: jsonOptions?.columnDataType,
      json_path: jsonOptions?.jsonPath,
      json_format: jsonOptions?.jsonFormat,
      record_path: jsonOptions?.recordPath,
    }

    const response = await apiValidateNotNull(request)

    if (response.success && response.data) {
      return {
        errorCount: response.data.error_count,
        totalRows: response.data.total_rows,
        errors: response.data.error_rows.map((err: any) => ({
          row: err.row_index,
          value: err.cell_value,
          message: '值不能为空',
        })),
      }
    }

    return {
      errorCount: 0,
      totalRows: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('非空验证失败:', error)
    throw error
  }
}

/**
 * 非空约束 Composable
 * @param props - 组件属性
 * @param props.id - 节点唯一标识符
 * @param props.data - 节点数据
 * @param emit - Vue的emit函数，用于通知父组件
 * @returns 非空约束相关的方法和状态
 */
export function useNotNull(props: { id: string; data: NotNullConstraintNodeData }, emit: any) {
  const base = useConstraintBase(props, emit)

  /**
   * 执行非空约束验证
   *
   * 前置检查：
   * 1. 检查是否已连接 Schema
   * 2. 检查是否显式连接了数据源（通过 sourceFile 字段判断）
   *    避免出现"UI显示无源，但残留的 sourceFilePath 导致校验运行"的幽灵数据问题
   *
   * 架构变更（2026年3月）：
   * - 移除了 IndexedDB 模式的分支判断
   * - 现在只使用本地文件路径模式
   *
   * @returns 包含 errorCount, totalRows, errors 的验证结果
   */
  const performValidation = async () => {
    logger.debug('🔄 执行非空验证:', props.id)

    if (!base.sourceInfo.value) {
      logger.warn('未连接 Schema，无法执行验证')
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }

    // 新增：检查是否显式连接了数据源（通过 sourceFile 字段判断）
    // 避免出现"UI显示无源，但残留的 sourceFilePath 导致校验运行"的幽灵数据问题
    if (!base.sourceInfo.value.sourceFile) {
      logger.warn('源表未连接数据源，跳过验证')
      return {
        errorCount: 0,
        totalRows: 0,
        errors: [],
      }
    }

    // 获取实际文件路径
    const { localPath, sourceFilePath } = base.sourceInfo.value
    const actualFilePath = localPath || sourceFilePath

    return await validateNotNull(
      actualFilePath,
      props.data.column,
      base.sourceInfo.value.sheetName,
      base.sourceInfo.value.headerRow
    )
  }

  /**
   * 格式化非空错误信息
   * @param errors - 错误列表
   * @returns 格式化后的错误信息数组
   */
  const formatNotNullErrors = (errors: any[]): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 值不能为空`)
  }

  return {
    ...base,
    performValidation,
    formatNotNullErrors,
    validateNotNull,
  }
}
