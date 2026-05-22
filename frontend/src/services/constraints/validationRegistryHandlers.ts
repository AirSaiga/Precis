/**
 * @file validationRegistryHandlers.ts
 * @description 约束验证处理器注册模块
 *
 * 功能概述：
 * - 为所有支持的约束类型注册验证处理器
 * - 每种约束类型包含 validate（校验逻辑）和 resetOnDisconnect（断开重置）
 * - 验证处理器通过调用后端 API 或本地逻辑执行实际数据校验
 *
 * 约束类型覆盖：
 * - notNull: 非空约束
 * - unique: 唯一性约束
 * - allowedValues: 允许值约束
 * - range: 区间约束
 * - charset: 字符集约束
 * - scripted: 脚本约束
 * - foreignKey: 外键约束
 * - conditional: 条件约束
 * - dateLogic: 日期逻辑约束
 *
 * 架构设计：
 * - 每个处理器通过 register() 自注册到 validationRegistryCore
 * - 验证流程统一：requireSource → 参数提取 → API 调用 → toResult 格式化
 * - 断开连接时统一使用 defaultReset 重置节点状态
 */

import {
  register,
  requireSource,
  toResult,
  getTargetValues,
  defaultReset,
  CONSTRAINT_TYPES,
  typeToMeta,
  kindToMeta,
  handlers,
} from './validationRegistryCore'
import type { ConstraintValidationContext, ConstraintValidationResult } from './types'
import type { Edge, Node } from '@vue-flow/core'
import {
  validateAllowedValues,
  validateCharset,
  validateConditional,
  validateForeignKey,
  validateRange,
  validateScripted,
  validateInline,
} from '@/api/validationApi'
import { validateNotNull } from '@/composables/nodes/constraints/useNotNull'
import { validateUnique } from '@/composables/nodes/constraints/useUnique'
import { getApiBaseUrl } from '@/core/services/httpClient'

// ============================================================================
// 约束验证处理器注册
// ============================================================================

/** 注册非空约束处理器 */
register({
  kind: 'notNull',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing

    // 行内数据校验（TransformOutput / ManualData）—— 委托后端执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'not_null',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '非空校验失败')],
          lastValidation: undefined,
        }
      }
      return toResult(response.data.error_rows || [], response.data.total_rows || 0, '值不能为空')
    }

    const result = await validateNotNull(
      String(ctx.sourceFilePath),
      ctx.columnName,
      ctx.sheetName,
      ctx.headerRow
    )
    return {
      status: result.errorCount > 0 ? 'error' : 'pass',
      validationErrors: result.errors.map((err) => `第 ${err.row + 1} 行: 值不能为空`),
      lastValidation: {
        totalRows: result.totalRows,
        errorCount: result.errorCount,
        matchCount: Math.max(0, result.totalRows - result.errorCount),
      },
    }
  },
  resetOnDisconnect: defaultReset,
})

/** 注册唯一性约束处理器 */
register({
  kind: 'unique',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing

    // 行内数据校验（TransformOutput / ManualData）—— 委托后端执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'unique',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '唯一性校验失败')],
          lastValidation: undefined,
        }
      }
      return toResult(response.data.error_rows || [], response.data.total_rows || 0, '值重复')
    }

    const result = await validateUnique(
      String(ctx.sourceFilePath),
      ctx.columnName,
      ctx.sheetName,
      ctx.headerRow
    )
    return {
      status: result.errorCount > 0 ? 'error' : 'pass',
      validationErrors: result.errors.map((err) => `第 ${err.row + 1} 行: 值 '${err.value}' 重复`),
      lastValidation: {
        totalRows: result.totalRows,
        errorCount: result.errorCount,
        matchCount: Math.max(0, result.totalRows - result.errorCount),
      },
    }
  },
  resetOnDisconnect: defaultReset,
})

/** 注册允许值约束处理器 */
register({
  kind: 'allowedValues',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const allowedValues = Array.from((nodeData.allowedValues || []) as unknown[])
      .map((v) => String(v).trim())
      .filter((v) => !!v && v !== '...')
    if (allowedValues.length === 0) {
      return {
        status: 'idle',
        validationErrors: ['请先配置允许值列表后再进行校验'],
        lastValidation: undefined,
      }
    }

    // 行内数据校验（TransformOutput / ManualData）—— 委托后端执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'allowed_values',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: { allowed_values: allowedValues },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '允许值校验失败')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '值不在允许值列表中'
      )
    }

    const response = await validateAllowedValues({
      validation_type: 'allowed_values',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: { allowed_values: allowedValues },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '允许值校验失败')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '值不在允许值列表中'
    )
  },
  resetOnDisconnect: defaultReset,
})

/** 注册区间约束处理器 */
register({
  kind: 'range',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>

    // 行内数据校验（TransformOutput / ManualData）—— 委托后端执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'range',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: {
          min_value: nodeData.minValue as number,
          max_value: nodeData.maxValue as number,
          boundary_mode:
            (nodeData.boundaryMode as 'inclusive' | 'exclusive' | undefined) || 'inclusive',
        },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '区间校验失败')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '值超出区间范围'
      )
    }

    const response = await validateRange({
      validation_type: 'range',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        min_value: nodeData.minValue as number,
        max_value: nodeData.maxValue as number,
        boundary_mode:
          (nodeData.boundaryMode as 'inclusive' | 'exclusive' | undefined) || 'inclusive',
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '区间校验失败')],
        lastValidation: undefined,
      }
    }
    return toResult(response.data.error_rows || [], response.data.total_rows || 0, '值超出区间范围')
  },
  resetOnDisconnect: defaultReset,
})

/** 注册字符集约束处理器 */
register({
  kind: 'charset',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>

    // 行内数据校验（TransformOutput / ManualData）—— 委托后端执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'charset',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: {
          charset_mode: (nodeData.charsetMode as 'ascii' | 'chinese' | undefined) || 'ascii',
        },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '字符集校验失败')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '字符集不符合约束'
      )
    }

    const response = await validateCharset({
      validation_type: 'charset',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        charset_mode: (nodeData.charsetMode as 'ascii' | 'chinese' | undefined) || 'ascii',
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '字符集校验失败')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '字符集不符合约束'
    )
  },
  resetOnDisconnect: defaultReset,
})

/** 注册脚本约束处理器 */
register({
  kind: 'scripted',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    // 行内数据校验（TransformOutput / ManualData）—— 委托后端沙箱执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const inlineScript = String(nodeData.script || '').trim()
      if (!inlineScript) {
        return {
          status: 'idle',
          validationErrors: ['请先配置脚本后再进行校验'],
          lastValidation: undefined,
        }
      }
      const response = await validateInline({
        validation_type: 'scripted',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: {
          script: inlineScript,
          script_name: String(nodeData.configName || 'custom_script'),
        },
        allow_unsafe_eval: true,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '脚本校验失败')],
          lastValidation: undefined,
        }
      }
      return toResult(response.data.error_rows || [], response.data.total_rows || 0, '脚本校验失败')
    }
    const script = String(nodeData.script || '').trim()
    if (!script) {
      return {
        status: 'idle',
        validationErrors: ['请先配置脚本后再进行校验'],
        lastValidation: undefined,
      }
    }
    const response = await validateScripted({
      validation_type: 'scripted',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        script,
        script_name: String(nodeData.configName || 'custom_script'),
      },
      allow_unsafe_eval: true,
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '脚本校验失败')],
        lastValidation: undefined,
      }
    }
    return toResult(response.data.error_rows || [], response.data.total_rows || 0, '脚本校验失败')
  },
  resetOnDisconnect: defaultReset,
})

/** 注册外键约束处理器 */
register({
  kind: 'foreignKey',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const targetNodeId =
      (nodeData.targetRef as Record<string, unknown> | undefined)?.nodeId ||
      (nodeData.config as Record<string, unknown> | undefined)?.targetNodeId
    const targetColumn = ((nodeData.config as Record<string, unknown> | undefined)?.targetColumn ||
      nodeData.targetColumn) as string
    if (!targetNodeId || !targetColumn) {
      return {
        status: 'idle',
        validationErrors: ['请选择目标列后再进行校验'],
        lastValidation: undefined,
      }
    }
    const targetNode = (
      (ctx as unknown as Record<string, unknown>).nodes as Node[] | undefined
    )?.find((n: Node) => n.id === targetNodeId)
    const targetValues = getTargetValues(targetNode, targetColumn)
    if (targetValues.length === 0) {
      return {
        status: 'missing',
        validationErrors: ['目标表缺少可用数据源或目标列不存在，无法提取参照值'],
        lastValidation: undefined,
      }
    }
    const targetTable =
      (((targetNode?.data || {}) as Record<string, unknown>)?.tableName as string) ||
      (nodeData.targetTable as string) ||
      'target'

    // 行内数据校验（TransformOutput / ManualData）—— 委托后端执行
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'foreign_key',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        validation_config: {
          target_table: targetTable,
          target_column: targetColumn as string,
          target_values: targetValues,
        },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [String(response.error || '外键校验失败')],
          lastValidation: undefined,
        }
      }
      const rows = response.data.error_rows || []
      const filtered = nodeData.allowNull
        ? rows.filter((err) => {
            const v = (err as unknown as Record<string, unknown>)?.cell_value
            return !(v === null || v === undefined || String(v).trim() === '')
          })
        : rows
      return toResult(filtered, response.data.total_rows || 0, '外键约束不满足')
    }

    const response = await validateForeignKey({
      validation_type: 'foreign_key',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        target_table: targetTable,
        target_column: targetColumn as string,
        target_values: targetValues,
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '外键校验失败')],
        lastValidation: undefined,
      }
    }
    const rows = response.data.error_rows || []
    const filtered = nodeData.allowNull
      ? rows.filter((err) => {
          const v = (err as unknown as Record<string, unknown>)?.cell_value
          return !(v === null || v === undefined || String(v).trim() === '')
        })
      : rows
    return toResult(filtered, response.data.total_rows || 0, '外键约束不满足')
  },
  resetOnDisconnect: defaultReset,
})

/** 注册条件约束处理器 */
register({
  kind: 'conditional',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    // 行内数据源暂不支持条件校验（需多列 IF/THEN 参照）
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      return {
        status: 'idle',
        validationErrors: ['行内数据源暂不支持条件约束校验，请使用文件数据源'],
        lastValidation: undefined,
      }
    }
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const ifConditions = Array.isArray(nodeData.ifConditions)
      ? (nodeData.ifConditions as unknown[])
      : []
    const hasIf =
      ifConditions.length > 0 || !!(nodeData.ifRef as Record<string, unknown> | undefined)?.columnId
    const hasThen = !!(nodeData.thenRef as Record<string, unknown> | undefined)?.columnId
    if (!hasIf || !hasThen) {
      return { status: 'idle', validationErrors: [], lastValidation: undefined }
    }
    const schemaColumns = (((ctx.schemaNode.data || {}) as Record<string, unknown>).columns ||
      []) as unknown[]
    const thenColumnName = (
      schemaColumns.find(
        (c) =>
          (c as Record<string, unknown>).id ===
          (nodeData.thenRef as Record<string, unknown>)?.columnId
      ) as Record<string, unknown>
    )?.columnName as string | undefined
    if (!thenColumnName) {
      return {
        status: 'missing',
        validationErrors: ['IF/THEN 列不存在或已删除'],
        lastValidation: undefined,
      }
    }
    const normalizedIf = (
      ifConditions.length > 0
        ? ifConditions
        : [
            {
              ref: nodeData.ifRef,
              operator: 'eq',
              value: nodeData.ifValue,
            },
          ]
    )
      .map((c: any) => ({
        if_column: (
          schemaColumns.find((x: any) => x.id === c?.ref?.columnId) as
            | Record<string, unknown>
            | undefined
        )?.columnName as string,
        operator: c?.operator,
        value: c?.value,
        values: Array.isArray(c?.values) ? c.values : undefined,
      }))
      .filter((c: any) => !!c.if_column)
    if (normalizedIf.length === 0) {
      return {
        status: 'missing',
        validationErrors: ['IF/THEN 列不存在或已删除'],
        lastValidation: undefined,
      }
    }
    const response = await validateConditional({
      validation_type: 'conditional',
      target_column_name: thenColumnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: {
        if_logic: (nodeData.ifLogic as 'and' | 'or' | undefined) || 'and',
        if_conditions: normalizedIf,
        if_column: normalizedIf[0]?.if_column,
        if_value: normalizedIf[0]?.value,
        then_column: thenColumnName,
        then_condition: nodeData.thenConditionConfig as string | Record<string, unknown>,
        then_condition_config: nodeData.thenConditionConfig as string | Record<string, unknown>,
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '条件约束校验失败')],
        lastValidation: undefined,
      }
    }
    return toResult(response.data.error_rows || [], response.data.total_rows || 0, '不满足条件')
  },
  resetOnDisconnect: defaultReset,
})

/** 注册日期逻辑约束处理器 */
register({
  kind: 'dateLogic',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    // 行内数据源暂不支持日期逻辑校验（需后端日期解析）
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      return {
        status: 'idle',
        validationErrors: ['行内数据源暂不支持日期逻辑校验，请使用文件数据源'],
        lastValidation: undefined,
      }
    }
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const validationConfig: Record<string, unknown> = {
      logic_mode: nodeData.logicMode || 'compare',
    }
    if ((nodeData.logicMode || 'compare') === 'compare') {
      validationConfig.compare_op = nodeData.compareOp || 'gt'
      if (nodeData.referenceType === 'date')
        validationConfig.reference_date = nodeData.referenceDate
      else validationConfig.reference_column = nodeData.referenceColumn
    } else {
      validationConfig.calculation_type = nodeData.calculationType || 'age'
      if (nodeData.targetType === 'value') validationConfig.target_value = nodeData.targetValue
      else validationConfig.target_column = nodeData.targetColumn
    }
    const request = {
      validation_type: 'date_logic',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: validationConfig,
    }
    const res = await fetch(`${getApiBaseUrl()}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const response = await res.json()
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '日期逻辑校验失败')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '日期逻辑约束冲突'
    )
  },
  resetOnDisconnect: defaultReset,
})
