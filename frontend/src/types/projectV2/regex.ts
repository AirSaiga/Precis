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
 * @fileoverview V2 Regex 类型：源引用、模式注册表引用、前端内部配置、
 * Regex 节点文件（*.regex.yaml）与 manifest 引用。
 */

/**
 * Regex 源引用。
 *
 * 用于 Regex 节点引用 Schema 中的特定列作为数据源。
 */
export interface RegexSourceRefV2 {
  /** 源表 ID */
  table_id: string
  /** 源列 ID */
  column_id: string
}

/**
 * 模式注册表类型。
 *
 * 当前仅支持 'patterns' 一种注册表。
 */
export type PatternRegistryTypeV2 = 'patterns'

/**
 * 模式引用定义。
 *
 * 用于 Regex 节点引用已注册的正则表达式模式。
 */
export interface PatternRefV2 {
  /** 注册表类型 */
  registry: PatternRegistryTypeV2
  /** 模式名称 */
  pattern_name: string
  /** 别名（可选），用于在节点中显示替代名称 */
  as_alias?: string
}

/**
 * Regex 节点内部配置（L3 - 前端内部使用）。
 *
 * 存储 Regex 节点的前端专用内部配置，不直接暴露给用户编辑。
 */
export interface RegexNodeInternalV2 {
  /** 正则参数列表 */
  parameters: Array<Record<string, unknown>>
  /** 正则规则列表 */
  rules: Array<Record<string, unknown>>
  /** 源引用信息 */
  source_ref?: RegexSourceRefV2
  /** 正则标志位（如 'g', 'i', 'm' 等） */
  flags: string
  /** 是否区分大小写 */
  case_sensitive: boolean
}

/**
 * Regex 节点资源引用。
 *
 * 用于在 project.precis.yaml 中索引 Regex 节点文件。
 */
export interface RegexNodeRefV2 {
  /** Regex 节点唯一标识符 */
  id: string
  /** Regex 节点文件路径（相对于项目目录） */
  path: string
}

/**
 * Regex 节点配置文件结构（*.regex.yaml）。
 *
 * 定义正则表达式节点的完整配置，支持直接编写正则或引用已注册的模式。
 */
export interface RegexNodeFileV2 {
  /** L1 - 核心：节点名称（展示用） */
  name: string

  /** L1 - 核心：功能描述 */
  description?: string

  /** L1 - 核心：直接编写正则表达式（与 uses_pattern 二选一） */
  pattern?: string

  /** L1 - 核心：引用已注册的表达式模式（与 pattern 二选一） */
  uses_pattern?: PatternRefV2

  /** L2 - 可选：对引用表达式的覆盖配置 */
  pattern_overrides?: Record<string, unknown>

  /**
   * L2 - 可选：匹配模式
   * @values
   * - 'full': 全匹配模式
   * - 'partial': 部分匹配模式
   * - 'extract': 提取模式（生成派生列）
   */
  match_mode: 'full' | 'partial' | 'extract'

  /** L2 - 可选：是否启用 */
  enabled: boolean

  /** 是否区分大小写 */
  case_sensitive?: boolean
  /** 正则标志位（如 'g', 'i', 'm' 等） */
  flags?: string
  /** 参数列表（前端内部使用） */
  parameters?: unknown[]
  /** 规则列表（前端内部使用） */
  rules?: unknown[]

  /** 数据流输入接口：上游数据流节点 ID */
  input_from_node?: string
  /** 数据流输入接口：上游节点中的目标列名 */
  input_column?: string

  /** Extract 模式专用：捕获组定义（名称与组索引映射） */
  capture_groups?: Array<{ name: string; group_index: number }>
  /** Extract 模式专用：输出列名列表 */
  output_columns?: string[]

  /** 源引用信息，指向 Schema 中的特定列 */
  source_ref?: RegexSourceRefV2
  /** 源列名称（显示用） */
  source_column_name?: string

  /** L3 - 内部：配置版本（程序生成） */
  version: number

  /** L3 - 内部：节点唯一标识符（程序生成） */
  id: string

  /** L3 - 内部：前端专用配置 */
  _internal?: RegexNodeInternalV2
}
