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
 * @file charsetHandler.ts
 * @description 字符集约束验证处理器
 */

import { defaultReset, register, requireSource, toResult } from '../validationRegistryCore'
import { validateCharset, validateInline } from '@/api/validationApi'

register({
  kind: 'charset',
  validate: async (ctx) => {
    const missing = requireSource(ctx)
    if (missing) return missing
    const nodeData = (ctx.constraintNode.data || {}) as Record<string, unknown>

    if (ctx.inlineRows && ctx.inlineRows.length > 0) {
      const response = await validateInline({
        validation_type: 'charset',
        target_column_name: ctx.columnName,
        rows: ctx.inlineRows,
        column_names: ctx.inlineColumnNames,
        column_data_type: ctx.columnDataType,
        validation_config: {
          charset_mode: (nodeData.charsetMode as 'ascii' | 'chinese' | undefined) || 'ascii',
        },
      })
      if (!response.success || !response.data) {
        return {
          status: 'error',
          validationErrors: [
            String(response.error || '\u5B57\u7B26\u96C6\u6821\u9A8C\u5931\u8D25'),
          ],
          lastValidation: undefined,
        }
      }
      return toResult(
        response.data.error_rows || [],
        response.data.total_rows || 0,
        '\u5B57\u7B26\u96C6\u4E0D\u7B26\u5408\u7EA6\u675F'
      )
    }

    const response = await validateCharset({
      validation_type: 'charset',
      target_column_name: ctx.columnName,
      source_file_path: String(ctx.sourceFilePath),
      sheet_name: ctx.sheetName,
      header_row: ctx.headerRow,
      column_data_type: ctx.columnDataType,
      json_path: ctx.jsonPath,
      json_format: ctx.jsonFormat,
      record_path: ctx.recordPath,
      validation_config: {
        charset_mode: (nodeData.charsetMode as 'ascii' | 'chinese' | undefined) || 'ascii',
      },
    })
    if (!response.success || !response.data) {
      return {
        status: 'error',
        validationErrors: [String(response.error || '\u5B57\u7B26\u96C6\u6821\u9A8C\u5931\u8D25')],
        lastValidation: undefined,
      }
    }
    return toResult(
      response.data.error_rows || [],
      response.data.total_rows || 0,
      '\u5B57\u7B26\u96C6\u4E0D\u7B26\u5408\u7EA6\u675F'
    )
  },
  resetOnDisconnect: defaultReset,
})
