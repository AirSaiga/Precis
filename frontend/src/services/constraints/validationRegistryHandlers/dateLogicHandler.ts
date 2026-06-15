/**
 * @file dateLogicHandler.ts
 * @description 日期逻辑约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateDateLogic, validateInline } from '@/api/validationApi'

register({
  kind: 'dateLogic',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
      const validationConfig: Record<string, unknown> = {
        logic_mode: nodeData.logicMode || 'compare',
      }
      if ((nodeData.logicMode || 'compare') === 'compare') {
        validationConfig.compare_op = nodeData.compareOp || 'gt'
        if (nodeData.referenceDate) validationConfig.reference_date = nodeData.referenceDate
        else validationConfig.reference_column = nodeData.referenceColumn
      } else {
        validationConfig.calculation_type = nodeData.calculationType || 'age'
        if (nodeData.targetType === 'value') validationConfig.target_value = nodeData.targetValue
        else validationConfig.target_column = nodeData.targetColumn
      }
      const response = await validateInline({
        validation_type: 'date_logic',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
        validation_config: validationConfig,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [
            String(response.error || '\u65E5\u671F\u903B\u8F91\u6821\u9A8C\u5931\u8D25'),
          ],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u65E5\u671F\u903B\u8F91\u7EA6\u675F\u51B2\u7A81'
      )
    }
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>
    const validationConfig: Record<string, unknown> = {
      logic_mode: nodeData.logicMode || 'compare',
    }
    if ((nodeData.logicMode || 'compare') === 'compare') {
      validationConfig.compare_op = nodeData.compareOp || 'gt'
      if (nodeData.referenceDate) validationConfig.reference_date = nodeData.referenceDate
      else validationConfig.reference_column = nodeData.referenceColumn
    } else {
      validationConfig.calculation_type = nodeData.calculationType || 'age'
      if (nodeData.targetType === 'value') validationConfig.target_value = nodeData.targetValue
      else validationConfig.target_column = nodeData.targetColumn
    }
    const request: Parameters<typeof validateDateLogic>[0] = {
      validation_type: 'date_logic' as const,
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      validation_config: validationConfig,
    }
    const response = await validateDateLogic(request)
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [
          String(response.error || '\u65E5\u671F\u903B\u8F91\u6821\u9A8C\u5931\u8D25'),
        ],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u65E5\u671F\u903B\u8F91\u7EA6\u675F\u51B2\u7A81'
    )
  },
  resetOnDisconnect: defaultReset,
})
