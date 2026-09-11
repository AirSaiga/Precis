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
 * @fileoverview V2 校验任务目标类型：描述一次校验任务的范围
 * （全项目 / 单表 / 单文件）。
 */

/**
 * 校验任务目标类型。
 *
 * @values
 * - 'full_project': 校验整个项目
 * - 'single_table': 校验单个表
 * - 'single_file': 校验单个文件
 */
export type ValidationTaskTargetType = 'full_project' | 'single_table' | 'single_file'

/**
 * 校验任务目标。
 *
 * 描述一次校验任务的具体范围。
 */
export interface ValidationTaskTarget {
  /** 目标类型 */
  type: ValidationTaskTargetType
  /** 目标表 ID（当 type 为 'single_table' 时使用） */
  table_id?: string | null
  /** 目标文件路径（当 type 为 'single_file' 时使用） */
  file_path?: string | null
  /** 显示名称（用于 UI 展示） */
  display_name?: string | null
}
