/**
 * @file useUnique.ts
 * @description 唯一性约束逻辑
 * 负责唯一性约束的校验逻辑和特定功能
 * 提供唯一性约束节点的验证方法和数据处理功能
 *
 * 注：IndexedDB 模式已在 2026年3月移除
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { UniqueConstraintNodeData } from '../types'
import { validateUnique as apiValidateUnique } from '@/api/validationApi'

/**
 * 唯一性验证结果类型
 * 定义唯一性约束验证返回的数据结构
 */
export interface UniqueValidationResult {
  errorCount: number // 检测到的重复值数量
  totalRows: number // 总行数
  errors: Array<{
    // 错误详情数组
    row: number // 行号
    value: string // 重复的值
    message: string // 错误消息
  }>
}

/**
 * 执行唯一性约束校验（独立函数）
 * 根据文件路径判断数据存储模式（IndexedDB 或文件系统）
 * 调用相应的验证方法执行校验
 *
 * 架构变更（2026年3月）：
 * - 移除了 IndexedDB 模式支持
 * - 现在只支持本地文件路径模式
 *
 * @param sourceFilePath - 源文件路径
 * @param columnName - 要校验的列名
 * @param sheetName - 工作表名称（可选）
 * @param headerRow - 表头行索引（可选，默认为 0）
 * @returns 包含校验结果的 UniqueValidationResult 对象
 */
export async function validateUnique(
  sourceFilePath: string,
  columnName: string,
  sheetName?: string,
  headerRow?: number,
  jsonOptions?: { jsonPath?: string; jsonFormat?: string; recordPath?: string; columnDataType?: string }
): Promise<UniqueValidationResult> {
  // 记录开始执行唯一性验证的日志
  logger.debug('🔄 执行唯一性验证:', columnName)

  try {
    // 从文件系统读取并执行校验

    const request = {
      validation_type: 'unique' as const,
      target_column_name: columnName,
      source_file_path: sourceFilePath,
      sheet_name: sheetName,
      header_row: headerRow,
      column_data_type: jsonOptions?.columnDataType,
      json_path: jsonOptions?.jsonPath,
      json_format: jsonOptions?.jsonFormat,
      record_path: jsonOptions?.recordPath,
    }

    const response = await apiValidateUnique(request)

    if (response.success && response.data) {
      return {
        errorCount: response.data.error_count,
        totalRows: response.data.total_rows,
        errors: response.data.error_rows.map((err: any) => ({
          row: err.row_index,
          value: err.cell_value,
          message: '值必须唯一',
        })),
      }
    }

    return {
      errorCount: 0,
      totalRows: 0,
      errors: [],
    }
  } catch (error) {
    logger.error('唯一性验证失败:', error)
    throw error
  }
}

/**
 * 唯一性约束
 * @param props - 组件属性
 * @param props.id - 节点唯一标识符
 * @param props.data - 节点数据
 * @param emit - Vue的emit函数，用于通知父组件
 * @returns 唯一性约束相关的方法和状态
 */
export function useUnique(props: { id: string; data: UniqueConstraintNodeData }, emit: any) {
  const base = useConstraintBase(props, emit)

  /**
   * 执行唯一性约束验证
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
    logger.debug('🔄 执行唯一性验证:', props.id)

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

    const { localPath, sourceFilePath } = base.sourceInfo.value
    const actualFilePath = localPath || sourceFilePath

    return await validateUnique(
      actualFilePath,
      props.data.column,
      base.sourceInfo.value.sheetName,
      base.sourceInfo.value.headerRow
    )
  }

  /**
   * 格式化唯一性错误信息
   * @param errors - 错误列表
   * @returns 格式化后的错误信息数组
   */
  const formatUniqueErrors = (errors: any[]): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 值 "${err.value}" 重复`)
  }

  return {
    ...base,
    performValidation,
    formatUniqueErrors,
    validateUnique,
  }
}
