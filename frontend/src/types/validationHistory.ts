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
 * 校验历史记录类型定义
 *
 * 对应后端 ValidationRunRecord / ValidationHistoryStore 的数据结构。
 */

export interface ValidationRunSummary {
  total_checks: number
  passed_count: number
  failed_count: number
  pass_rate: number
  tables_loaded: number
  total_error_count: number
}

export interface ValidationRunRecord {
  id: string
  timestamp: string
  duration_ms: number
  scope: string
  summary: ValidationRunSummary
  by_type: Record<string, { total: number; passed: number; failed: number }>
  by_table: Record<string, { total: number; passed: number; failed: number }>
  errors: Array<{
    stage: string
    error_type: string
    check_type: string
    message: string
    table?: string
    column?: string
    row_index?: number
    value?: string
  }>
  warnings: string[]
}

export interface ValidationHistoryList {
  total: number
  limit: number
  offset: number
  items: ValidationRunRecord[]
}

export interface ValidationHistoryStats {
  total_runs: number
  trend: Array<{
    id: string
    timestamp: string
    pass_rate: number
    total_checks: number
    failed_count: number
  }>
  latest: {
    pass_rate: number
    total_checks: number
    passed_count: number
    failed_count: number
    timestamp: string | null
  }
}
