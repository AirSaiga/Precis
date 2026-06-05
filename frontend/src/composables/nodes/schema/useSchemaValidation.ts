/**
 * @file useSchemaValidation.ts
 * @description Schema验证Composable - 负责Schema数据节点的约束验证逻辑
 *
 * 【业务场景】
 * Schema节点是数据质量治理的核心节点，用于定义数据的列结构及约束规则。
 * 本模块提供对Schema节点所定义的约束条件进行验证的能力，确保数据满足预定义的规则。
 *
 * 【数据流】
 * 1. 接收Schema节点配置（列定义、约束规则）
 * 2. 对每个列执行约束验证（支持notNull、unique、allowedValues三种约束）
 * 3. 汇总验证结果，通过emit和自定义事件两种方式通知上层组件
 * 4. 返回详细的验证结果（错误行、错误值、错误消息）
 *
 * 【模块职责】
 * - 提供Schema节点级别的全量验证（validateAllColumns）
 * - 提供单列验证能力（validateColumn）
 * - 支持多种约束类型的验证（notNull、unique、allowedValues）
 * - 统一管理验证结果的展示和通知
 *
 * 【与后端的交互】
 * - notNull和unique约束：通过@/composables/nodes/constraints模块在数据源文件上执行验证
 * - allowedValues约束：通过@/api/validationApi调用后端API进行验证
 *
 * 【设计考量】
 * - 使用异步验证以支持大文件处理
 * - 约束验证采用"快速失败"策略，每个约束独立执行
 * - 验证结果同时通过Vue组件事件和DOM自定义事件发送，兼容不同调用方
 */

import { logger } from '@/core/utils/logger'
import { eventBus } from '@/core/eventBus'
import { useI18n } from 'vue-i18n'
import type { SchemaNodeData } from '../types'
import { validateNotNull } from '@/composables/nodes/constraints/useNotNull'
import { validateUnique } from '@/composables/nodes/constraints/useUnique'

/**
 * Schema验证Composable - 负责Schema数据节点的约束验证逻辑
 *
 * @param props - 组件属性，包含节点ID和数据
 *   - id: Schema节点的唯一标识符，用于关联验证结果和具体节点
 *   - data: Schema节点的完整配置数据，包含列定义、约束规则、源文件路径等信息
 * @param emit - Vue的emit函数，用于向父组件通知验证结果
 *   - 'validationCompleted': 验证完成事件，包含节点ID和验证结果详情
 * @returns 包含验证方法的对象，供外部调用
 *
 * 【副作用】
 * - 函数内部会触发console.log输出验证进度和结果，用于调试和问题追踪
 * - 会触发Vue组件事件（emit）和DOM自定义事件（document.dispatchEvent），通知验证完成
 * - 验证过程中会向后端API发起请求（allowedValues验证）或读取本地文件（notNull/unique验证）
 */
export function useSchemaValidation(props: { id: string; data: SchemaNodeData }, emit: any) {
  const { t } = useI18n()

  /**
   * 获取实际的数据源文件路径
   *
   * 【功能说明】
   * Schema节点支持两种数据源模式：本地文件模式（localfile）和普通文件模式。
   * 本函数根据当前配置确定实际用于验证的源文件路径。
   *
   * 【业务逻辑说明】
   * 当sourceMode为'localfile'时，说明用户选择了本地文件，此时应使用localPath作为源路径；
   * 否则使用sourceFilePath作为源路径。这种设计支持用户在配置Schema时指定不同的数据来源。
   *
   * 【返回值说明】
   * 返回一个字符串，表示要验证的数据源文件的完整路径。
   *
   * 【可能的副作用】
   * 无明显副作用，仅做数据获取和条件判断。
   */
  const getEffectiveSourcePath = () => {
    if (props.data.sourceMode === 'localfile' && props.data.localPath) {
      return String(props.data.localPath)
    }
    return String(props.data.sourceFilePath || '')
  }

  /**
   * 验证Schema节点定义的所有列
   *
   * 【功能说明】
   * 这是Schema节点的全量验证入口函数，对节点中定义的所有列执行约束验证。
   * 它遍历每一列，收集每列的验证结果，并汇总生成最终的验证报告。
   *
   * 【业务逻辑说明】
   * 验证是按照列的顺序串行执行的，这样可以确保错误报告的顺序与列定义顺序一致，
   * 便于用户理解和定位问题。每个列的验证结果包含错误数量和具体错误详情。
   *
   * 【返回值说明】
   * 返回一个Promise，resolve时返回一个数组，数组每个元素对应一列的验证结果。
   * 每个验证结果包含：columnId（列ID）、columnName（列名）、errorCount（错误数量）、errors（错误详情数组）。
   *
   * 【可能的副作用】
   * - 触发console.log输出验证进度和结果
   * - 调用showValidationResults函数，触发Vue emit事件和DOM自定义事件
   * - 对每一列调用validateColumn，可能触发文件读取或API请求
   * - 验证过程中的错误会被捕获并重新抛出
   */
  const validateAllColumns = async () => {
    logger.debug('🔄 开始验证所有列:', props.id)

    try {
      const results: Array<{
        columnId: string
        columnName: string
        errorCount: number
        errors: Array<{ row: number; value: string; message: string }>
      }> = []

      for (const column of props.data.columns) {
        const result = await validateColumn(column.id)
        results.push(result)
      }

      const totalErrors = results.reduce((sum, result) => sum + result.errorCount, 0)

      logger.debug(`✅ 验证完成，共 ${totalErrors} 个错误`)

      showValidationResults({
        totalColumns: props.data.columns.length,
        totalErrors: totalErrors,
        results: results,
      })

      return results
    } catch (error) {
      logger.error('验证所有列失败:', error)
      throw error
    }
  }

  /**
   * 验证单个列的所有约束规则
   *
   * 【功能说明】
   * 对指定列执行所有已配置的约束验证。目前支持三种约束类型：
   * 1. notNull（非空约束）：检查该列是否存在空值
   * 2. unique（唯一性约束）：检查该列是否存在重复值
   * 3. allowedValues（允许值约束）：检查该列的值是否都在预定义的允许值列表中
   *
   * 【参数说明】
   * @param columnId - 要验证的列的唯一标识符
   *
   * 【业务逻辑说明】
   * 约束验证采用"叠加"策略，即每种约束的验证结果独立累加。
   * 这意味着即使某一行的值违反了notNull约束，该行仍会被检查是否违反unique约束。
   * 这种设计可以一次性发现所有类型的质量问题，减少用户反复验证的次数。
   *
   * 【返回值说明】
   * 返回一个Promise，resolve时返回一个对象，包含：
   * - columnId: 列的ID
   * - columnName: 列的名称
   * - errorCount: 该列的总错误数（所有约束类型错误的总和）
   * - errors: 错误详情数组，每个元素包含row（行号）、value（错误值）、message（错误消息）
   *
   * 【可能的副作用】
   * - 触发console.log输出验证进度
   * - 根据配置的约束类型，调用不同的验证函数：
   *   - notNull: 调用validateNotNull，可能读取源数据文件
   *   - unique: 调用validateUnique，可能读取源数据文件
   *   - allowedValues: 调用validateAllowedValues，发起API请求
   */
  const validateColumn = async (columnId: string) => {
    logger.debug('🔄 验证列:', columnId)

    try {
      const column = props.data.columns.find((col) => col.id === columnId)
      if (!column) {
        throw new Error(`列 ${columnId} 不存在`)
      }

      const result = {
        columnId: columnId,
        columnName: column.columnName,
        errorCount: 0,
        errors: [] as Array<{ row: number; value: string; message: string }>,
      }

      const constraints = (column.constraints ?? {}) as {
        notNull?: unknown
        unique?: unknown
        allowedValues?: unknown
      }

      if (constraints.notNull) {
        const notNullResult = await validateNotNull(
          getEffectiveSourcePath(),
          column.columnName,
          props.data.sheetName,
          props.data.headerRow
        )
        result.errorCount += notNullResult.errorCount
        result.errors.push(...notNullResult.errors)
      }

      if (constraints.unique) {
        const uniqueResult = await validateUnique(
          getEffectiveSourcePath(),
          column.columnName,
          props.data.sheetName,
          props.data.headerRow
        )
        result.errorCount += uniqueResult.errorCount
        result.errors.push(...uniqueResult.errors)
      }

      if (constraints.allowedValues && Array.isArray(constraints.allowedValues) && constraints.allowedValues.length > 0) {
        const allowedValuesResult = await validateAllowedValues(column)
        result.errorCount += allowedValuesResult.errorCount
        result.errors.push(...allowedValuesResult.errors)
      }

      logger.debug(`✅ 列 ${column.columnName} 验证完成，错误数: ${result.errorCount}`)

      return result
    } catch (error) {
      logger.error('验证列失败:', error)
      throw error
    }
  }

  /**
   * 验证列的允许值约束
   *
   * 【功能说明】
   * 允许值约束用于限制某列的值必须来自预定义的允许值列表。
   * 例如：性别列只能接受"男"、"女"、"其他"三个值。
   * 本函数通过调用后端API来检查数据源文件中该列的所有值是否符合约束。
   *
   * 【参数说明】
   * @param column - 列定义对象，包含列名和允许值列表（constraints.allowedValues）
   *
   * 【业务逻辑说明】
   * 该函数支持两种数据源模式：
   * 1. 普通文件模式（默认）：通过@/api/validationApi调用后端验证接口
   * 2. IndexedDB模式（isUuidMode=true）：从本地存储读取文件并通过FormData上传验证
   *
   * 允许值列表可能以数组或Set的形式存储，函数内部会统一转换为数组处理。
   * 这是因为列约束配置可能来自不同的序列化和反序列化过程。
   *
   * 【返回值说明】
   * 返回一个Promise，resolve时返回一个对象，包含：
   * - errorCount: 违反约束的错误数量
   * - errors: 错误详情数组，每个元素包含：
   *   - row: 违反约束的行号（0-based）
   *   - value: 违反约束的单元格值
   *   - message: 错误消息，说明"值必须是以下之一: xxx"
   *
   * 【可能的副作用】
   * - 触发console.log输出验证进度
   * - 根据isUuidMode的值，可能：
   *   - 从IndexedDB读取文件（getFile）
   *   - 发起HTTP POST请求到后端验证接口
   * - 验证失败时返回空结果而非抛出异常，这是一种容错设计，避免单个约束验证失败导致整体验证中断
   */
  const validateAllowedValues = async (column: any) => {
    logger.debug('🔄 验证允许值约束:', column.columnName)

    try {
      const sourceFilePath = getEffectiveSourcePath()

      const request = {
        validation_type: 'allowed_values' as const,
        target_column_name: column.columnName,
        source_file_path: sourceFilePath,
        sheet_name: props.data.sheetName,
        header_row: 0,
        validation_config: {
          allowed_values: Array.isArray(column.constraints.allowedValues)
            ? column.constraints.allowedValues
            : Array.from(column.constraints.allowedValues),
        },
      }

      const response = await validateAllowedValues(request)

      if (response.success && response.data) {
        return {
          errorCount: response.data.error_count,
          errors: response.data.error_rows.map((err: any) => ({
            row: err.row_index,
            value: err.cell_value,
            message: `值必须是以下之一: ${column.constraints.allowedValues.join(', ')}`,
          })),
        }
      }

      return {
        errorCount: 0,
        errors: [],
      }
    } catch (error) {
      logger.error('验证允许值约束失败:', error)
      return {
        errorCount: 0,
        errors: [],
      }
    }
  }

  /**
   * 展示验证结果并通知相关方
   *
   * 【功能说明】
   * 当验证完成后，需要将验证结果通知给需要知道的组件或模块。
   * 本函数负责统一处理验证结果的通知分发。
   *
   * 【参数说明】
   * @param results - 验证结果对象，包含：
   *   - totalColumns: 总列数
   *   - totalErrors: 总错误数
   *   - results: 每列的详细验证结果数组
   *
   * 【业务逻辑说明】
   * 验证结果通过两种机制分发：
   * 1. Vue组件事件（emit）：通过Vue的emit机制向父组件传递数据，这是Vue生态中最常用的组件通信方式
   * 2. DOM自定义事件（document.dispatchEvent）：通过浏览器原生事件机制广播验证结果，
   *    这种方式允许非父子关系的组件或模块订阅验证结果，提供了更松耦合的通信方式
   *
   * 【返回值说明】
   * 无返回值
   *
   * 【可能的副作用】
   * - 触发console.log输出验证结果（用于调试）
   * - 触发Vue的'validationCompleted'事件，父组件可以监听该事件处理验证结果
   * - 触发名为'schemaValidationCompleted'的DOM自定义事件，任何监听该事件的脚本都能收到通知
   * - 事件中包含nodeId，用于标识验证结果属于哪个Schema节点
   */
  const showValidationResults = (results: any) => {
    logger.debug('📊 验证结果:', results)

    emit('validationCompleted', {
      nodeId: props.id,
      results: results,
    })

    eventBus.emit('schemaValidationCompleted', { nodeId: props.id, results: results })
  }

  return {
    validateAllColumns,
    validateColumn,
    validateAllowedValues,
    showValidationResults,
    validateNotNull,
    validateUnique,
  }
}
