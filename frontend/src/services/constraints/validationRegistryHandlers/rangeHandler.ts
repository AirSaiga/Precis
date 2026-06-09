/**
 * @file rangeHandler.ts
 * @description 区间约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateInline, validateRange } from '@/api/validationApi'

register({
  kind: 'range',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>

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
          validationErrors: [String(response.error || '\u533A\u95F4\u6821\u9A8C\u5931\u8D25')],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u503C\u8D85\u51FA\u533A\u95F4\u8303\u56F4'
      )
    }

    const response = await validateRange({
      validation_type: 'range',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      column_data_type: ctx.columnDataType,
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
        validationErrors: [String(response.error || '\u533A\u95F4\u6821\u9A8C\u5931\u8D25')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u503C\u8D85\u51FA\u533A\u95F4\u8303\u56F4'
    )
  },
  resetOnDisconnect: defaultReset,
})
