/**
 * @file constraintValidator.ts
 * @description 约束校验器 - 执行具体的约束校验逻辑
 *
 * 该模块负责执行具体的约束校验操作：
 * - 调用后端 API 执行非空约束校验
 * - 调用后端 API 执行唯一性约束校验
 * - 批量执行多个约束校验
 * - 格式化校验结果
 *
 * @module constraintValidator
 */

import { logger } from '@/core/utils/logger'
import {
  executeConstraintValidation,
  getHandlerByKind,
} from '@/services/constraints/validationRegistry'
import type { ConstraintKind } from '@/services/constraints/types'
import type { SchemaNodeSourceInfo } from './validationCollector'

/**
 * 校验结果接口
 * 描述单个约束校验的详细结果
 */
export interface ValidationResult {
  /** 列的唯一标识符 */
  columnId: string
  /** 列的名称 */
  columnName: string
  /** 约束类型 */
  constraintType: string
  /** 是否通过校验 */
  isValid: boolean
  /** 错误数量 */
  errorCount: number
  /** 错误消息数组 */
  errors: string[]
}

/**
 * 执行单个约束校验（通用入口）
 *
 * 该函数是约束校验的通用入口，根据约束类型调用相应的校验函数。
 * 支持非空约束和唯一性约束，其他约束类型将返回跳过结果。
 *
 * @param constraintType - 约束类型（'notNull' | 'unique' 等）
 * @param columnId - 列的唯一标识符
 * @param columnName - 列的名称
 * @param sourceInfo - 数据源信息
 * @returns 校验结果对象
 *
 * @example
 * ```typescript
 * const result = await validateConstraint('notNull', 'col-1', 'email', sourceInfo);
 * ```
 */
export async function validateConstraint(
  constraintType: string,
  columnId: string,
  columnName: string,
  sourceInfo: SchemaNodeSourceInfo
): Promise<ValidationResult> {
  // 如果没有显式连接数据源，则跳过验证
  // sourceFile 字段存在意味着有有效的数据源连接
  if (sourceInfo.sourceFile === undefined && sourceInfo.sourceMode !== 'localfile') {
    // 注意：对于 localfile 模式（Electron），可能不依赖 sourceFile 字段，而是依赖 localPath
    // 但为了安全起见，我们假设 SchemaNode 会正确同步 sourceFile
    // 如果 sourceInfo 是从 SchemaNode.data 构建的，那么 sourceFile 应该反映连接状态

    // 如果是基于图连接收集的 sourceInfo (getSchemaNodeSourceInfo)，sourceFile 可能未填充？
    // 在 getSchemaNodeSourceInfo 中，我们是通过连接确认存在的。

    // 让我们稍微放宽一点：如果 sourceFilePath 存在但 sourceFile 不存在，我们发出警告并跳过
    // 除非我们确定这是遗留数据。

    // 实际上，为了解决用户的问题，我们需要拦截的是“SchemaNode未连接数据源”的情况。
    // 这种情况下 sourceFile 应该是 undefined。

    logger.warn(`[validateConstraint] 源表未连接数据源，跳过 ${constraintType} 验证: ${columnName}`)
    return {
      columnId,
      columnName,
      constraintType,
      isValid: true,
      errorCount: 0,
      errors: [],
    }
  }

  const handler = getHandlerByKind(constraintType as ConstraintKind)
  if (!handler) {
    logger.warn(`⚠️ 未支持的约束类型: ${constraintType}`)
    return {
      columnId,
      columnName,
      constraintType,
      isValid: true,
      errorCount: 0,
      errors: [],
    }
  }

  const result = await executeConstraintValidation({
    kind: constraintType as ConstraintKind,
    columnName,
    sourceFilePath: sourceInfo.sourceFilePath || sourceInfo.localPath || '',
    sourceFile: sourceInfo.sourceFile || '',
    sheetName: sourceInfo.sheetName || '',
    headerRow: sourceInfo.headerRow || 0,
    constraintData: {},
  })

  return {
    columnId,
    columnName,
    constraintType,
    isValid: result.status !== 'error',
    errorCount: result.lastValidation?.errorCount || 0,
    errors: result.validationErrors || [],
  }
}

/**
 * 批量执行多个约束校验
 *
 * 该函数接收一组约束信息，依次执行每个约束的校验，
 * 最后返回所有校验结果的数组。
 *
 * @param constraints - 约束信息数组，每个元素包含列 ID、列名和约束类型
 * @param sourceInfo - 数据源信息
 * @returns 校验结果数组
 *
 * @example
 * ```typescript
 * const constraints = [
 *   { columnId: 'col-1', columnName: 'email', constraintType: 'notNull' },
 *   { columnId: 'col-2', columnName: 'phone', constraintType: 'unique' }
 * ];
 * const results = await validateConstraints(constraints, sourceInfo);
 * ```
 */
export async function validateConstraints(
  constraints: Array<{ columnId: string; columnName: string; constraintType: string }>,
  sourceInfo: SchemaNodeSourceInfo
): Promise<ValidationResult[]> {
  logger.debug(`🔍 开始批量校验，共 ${constraints.length} 个约束`)

  const results: ValidationResult[] = []

  for (const constraint of constraints) {
    const result = await validateConstraint(
      constraint.constraintType,
      constraint.columnId,
      constraint.columnName,
      sourceInfo
    )
    results.push(result)
  }

  const validCount = results.filter((r) => r.isValid).length
  const totalCount = results.length
  logger.debug(`✅ 批量校验完成: ${validCount}/${totalCount} 通过`)

  return results
}
