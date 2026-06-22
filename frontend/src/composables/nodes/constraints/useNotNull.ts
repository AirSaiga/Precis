/**
 * @file useNotNull.ts
 * @description 非空约束
 * 负责非空约束的特定逻辑
 * 提供非空约束节点的验证方法和数据处理功能
 *
 * 注：IndexedDB 模式已在 2026年3月移除
 * 注：validateNotNull 纯函数已下沉到 services/constraints/validators/notNull，
 *     本文件保留导出以维持现有调用方的兼容性。
 */

import { logger } from '@/core/utils/logger'
import { useConstraintBase } from './useConstraintBase'
import type { NotNullConstraintNodeData } from '../types'
import {
  validateNotNull,
  type NotNullValidationResult,
} from '@/services/constraints/validators/notNull'

export type { NotNullValidationResult }
export { validateNotNull }

/**
 * 非空约束 Composable
 * @param props - 组件属性
 * @param props.id - 节点唯一标识符
 * @param props.data - 节点数据
 * @param emit - Vue的emit函数，用于通知父组件
 * @returns 非空约束相关的方法和状态
 */
export function useNotNull(
  props: { id: string; data: NotNullConstraintNodeData },
  emit: (event: string, ...args: unknown[]) => void
) {
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
  const formatNotNullErrors = (errors: Array<{ row: number }>): string[] => {
    return errors.map((err) => `第 ${err.row + 1} 行: 值不能为空`)
  }

  return {
    ...base,
    performValidation,
    formatNotNullErrors,
    validateNotNull,
  }
}
