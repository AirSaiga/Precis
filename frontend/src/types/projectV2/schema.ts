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
 * @fileoverview V2 Schema 类型：列规格、Schema 文件结构（*.schema.yaml）、
 * manifest 引用与保存模式/冲突信息。
 */

import type { SourceSpecV2 } from './dataSources'
import type { ConstraintItemV2 } from './constraints'

/**
 * Schema 内部配置（L3 - 前端内部使用）。
 */
export interface SchemaInternalV2 {
  /** 是否展开列详情面板 */
  expand: boolean
  /** 脚本检查配置列表 */
  script_checks: Array<Record<string, unknown>>
}

/**
 * 后端列类型。
 *
 * 可以是简单的字符串类型名，也可以是对象配置（如表达式列、提取列）。
 */
export type BackendColumnTypeV2 = string | Record<string, unknown>

/**
 * 列规格定义。
 *
 * 描述 Schema 中单个列的结构和属性。
 */
export interface ColumnSpecV2 {
  /** 列唯一标识符 */
  id: string
  /** 列名称 */
  name: string
  /** 列数据类型（字符串或对象配置） */
  type: BackendColumnTypeV2
  /** 是否为主键 */
  primary_key?: boolean
  /** 是否允许为空（对应后端 ColumnSpec.nullable） */
  nullable?: boolean
  /** 是否展开列详情（UI 状态） */
  expand?: boolean
  /** JSON 列的 JSONPath 路径 */
  json_path?: string
  /** JSON 嵌套子列（树形结构） */
  children?: ColumnSpecV2[]
}

/**
 * Schema 配置文件结构（*.schema.yaml）。
 *
 * 定义数据表的完整结构，包括数据源引用、列定义和内嵌约束。
 */
export interface TableSchemaFileV2 {
  /** L1 - 核心：配置版本（固定为 2） */
  version: number

  /** L1 - 核心：表唯一标识符 */
  id: string

  /** L1 - 核心：表名称 */
  name: string

  /** L1 - 核心：数据源规格描述 */
  source?: SourceSpecV2

  /** L2 - 可选：Excel Sheet 名称（后端也支持顶层 sheet 字段） */
  sheet?: string

  /** L1 - 核心：列定义列表 */
  columns: ColumnSpecV2[]

  /** L1 - 内嵌约束列表（可直接在 schema.yaml 中定义） */
  constraints?: ConstraintItemV2[]

  /** 脚本检查配置列表 */
  script_checks?: unknown[]

  /** L3 - 内部：前端专用配置 */
  _internal?: SchemaInternalV2
}

/**
 * Schema 资源引用。
 *
 * 用于在 project.precis.yaml 中索引 Schema 文件。
 */
export interface SchemaRefV2 {
  /** Schema 唯一标识符 */
  id: string
  /** Schema 文件路径（相对于项目目录） */
  path: string
}

/**
 * Schema 保存模式。
 *
 * @values
 * - 'create': 创建新文件（文件必须不存在）
 * - 'merge': 合并到现有文件（保留现有字段，覆盖冲突字段）
 * - 'overwrite': 覆盖现有文件（完全替换）
 */
export type SchemaSaveMode = 'create' | 'merge' | 'overwrite'

/**
 * Schema 冲突信息。
 *
 * 在保存 Schema 时检测到的冲突详情，用于前端展示差异对比。
 */
export interface SchemaConflictInfo {
  /** 文件是否已存在 */
  exists: boolean
  /** 现有文件路径 */
  file_path: string
  /** 是否存在字段冲突 */
  has_conflict: boolean
  /** 冲突字段列表 */
  conflict_fields: string[]
  /** 现有 Schema 内容（用于对比） */
  existing_schema?: Record<string, unknown>
  /** 新 Schema 内容（用于对比） */
  new_schema?: Record<string, unknown>
}
