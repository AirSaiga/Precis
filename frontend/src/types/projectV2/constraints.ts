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
 * @fileoverview V2 约束类型：约束类型枚举、schema 内嵌约束项、独立约束文件
 * （*.constraint.yaml）与 manifest 引用。
 */

/**
 * 约束类型枚举。
 *
 * 对应后端支持的约束种类，用于 ConstraintItemV2 和 ConstraintFileV2 的 type 字段。
 *
 * @values
 * - 'NotNull': 非空约束
 * - 'Unique': 唯一约束
 * - 'AllowedValues': 允许值约束
 * - 'ForeignKey': 外键约束
 * - 'Conditional': 条件约束
 * - 'Scripted': 脚本约束
 * - 'Range': 区间约束
 * - 'Charset': 字符集约束
 * - 'DateLogic': 日期逻辑约束
 * - 'Composite': 复合约束
 */
export type ConstraintTypeV2 =
  | 'NotNull'
  | 'Unique'
  | 'AllowedValues'
  | 'ForeignKey'
  | 'Conditional'
  | 'Scripted'
  | 'Range'
  | 'Charset'
  | 'DateLogic'
  | 'Composite'

/**
 * 内嵌约束项定义。
 *
 * 可直接在 schema.yaml 的 constraints 字段中定义，无需单独创建约束文件。
 */
export interface ConstraintItemV2 {
  /** 约束 ID（同一表内必须唯一） */
  id: string

  /** 约束类型 */
  type: ConstraintTypeV2

  /** 是否启用 */
  enabled?: boolean

  /** 约束描述 */
  description?: string

  /** 目标列名（简化写法） */
  column?: string

  /** 目标列名列表（多列约束） */
  columns?: string[]

  /** 外键源表名 */
  from_table?: string

  /** 外键源列名 */
  from_column?: string

  /** 外键目标表名 */
  to_table?: string

  /** 外键目标列名 */
  to_column?: string

  /** 约束参数（如 allowed_values 等，因约束类型而异） */
  params?: Record<string, unknown>
}

/**
 * 约束资源引用。
 *
 * 用于在 project.precis.yaml 中索引约束文件。
 */
export interface ConstraintRefV2 {
  /** 约束唯一标识符 */
  id: string
  /** 约束文件路径（相对于项目目录） */
  path: string
}

/**
 * 约束配置文件结构（*.constraint.yaml）。
 */
export interface ConstraintFileV2 {
  /** 配置版本号 */
  version: number
  /** 约束唯一标识符 */
  id: string
  /** 约束类型 */
  type: ConstraintTypeV2
  /** 是否启用 */
  enabled: boolean
  /** 约束描述（可选） */
  description?: string
  /** 引用配置（如表 ID、列 ID 等） */
  refs: Record<string, unknown>
  /** 约束参数（因类型而异） */
  params: Record<string, unknown>
  /** 上游数据流节点 ID（优先于 Schema 引用） */
  input_from_node?: string
}

/**
 * 内嵌约束示例（直接在 schema.yaml 中定义）：
 *
 * constraints:
 *   - id: email_notnull
 *     type: NotNull
 *     column: email
 *   - id: gender_allowed
 *     type: AllowedValues
 *     column: gender
 *     params:
 *       allowed_values: [男, 女]
 *   - id: username_unique
 *     type: Unique
 *     columns: [username]
 *
 * 独立文件示例（constraints/users_email_notnull.constraint.yaml）：
 *
 * version: 2
 * id: users_email_notnull
 * type: NotNull
 * enabled: true
 * description: 用户邮箱不能为空
 * refs:
 *   table_id: users
 *   column_id: email
 * params: {}
 */
