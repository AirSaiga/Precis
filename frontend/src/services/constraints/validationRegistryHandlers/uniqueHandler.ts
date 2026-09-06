/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @file uniqueHandler.ts
 * @description 唯一性约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateInline } from '@/api/validationApi'
import { validateUnique } from '../validators/unique'

register({
  kind: 'unique',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'unique',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [
            String(response.error || '\u552F\u4E00\u6027\u6821\u9A8C\u5931\u8D25'),
          ],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u503C\u91CD\u590D'
      )
    }

    const result = await validateUnique(
      String(ctx.sourceFilePath),
      ctx.columnName,
      ctx.sheetName,
      ctx.headerRow,
      {
        jsonPath: ctx.jsonPath,
        jsonFormat: ctx.jsonFormat,
        recordPath: ctx.recordPath,
        columnDataType: ctx.columnDataType,
      }
    )
    // 文件路径模式：后端业务失败（200 + success:false，如数据文件不存在）必须报 error，
    // 不能落入下方"零错误=通过"判定（假通过修复）
    if (result.requestFailed) {
      return {
        status: 'error',
        validationErrors: [result.errorMessage || '\u552F\u4E00\u6027\u6821\u9A8C\u5931\u8D25'],
        lastValidation: undefined,
      }
    }
    return {
      status: result.errorCount > 0 ? 'error' : 'pass',
      validationErrors: result.errors.map(
        (err) => `\u7B2C ${err.row + 1} \u884C: \u503C '${err.value}' \u91CD\u590D`
      ),
      lastValidation: {
        totalRows: result.totalRows,
        errorCount: result.errorCount,
        matchCount: Math.max(0, result.totalRows - result.errorCount),
      },
    }
  },
  resetOnDisconnect: defaultReset,
})
