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
 * @fileoverview V2 数据源类型：路径模式、JSON/CSV/Excel 格式选项、数据源规格
 * 与 manifest 中的数据源引用。
 */

/**
 * 数据源路径模式。
 *
 * @values
 * - 'relative_file': 相对项目目录的文件路径
 * - 'absolute_file': 本地文件系统的绝对路径
 */
export type SourceModeV2 = 'relative_file' | 'absolute_file'

/**
 * JSON 格式选项（对应后端 JSONOptions）。
 *
 * 用于配置 pandas read_json 的解析行为。
 */
export interface JSONOptionsV2 {
  /**
   * JSON 格式变体
   * @values
   * - 'auto': 自动检测
   * - 'array': JSON 数组格式
   * - 'lines': JSON Lines 格式
   * - 'object': JSON 对象格式
   */
  format?: 'array' | 'lines' | 'object'
  /** JSONPath 表达式，用于从嵌套 JSON 中提取数据 */
  json_path?: string
  /** record_path，用于 pandas read_json 的 record_path 参数 */
  record_path?: string
  /** 元数据前缀，用于区分元数据列 */
  meta_prefix?: string
  /** 分隔符（用于 lines 格式） */
  sep?: string
  /** 列数据类型映射 */
  dtype?: Record<string, string>
}

/**
 * CSV 格式选项。
 *
 * 用于配置 pandas read_csv 的解析行为。
 */
export interface CSVOptionsV2 {
  /** 字段分隔符 */
  delimiter?: string
  /** 引号字符 */
  quotechar?: string
  /** 转义字符 */
  escapechar?: string
  /** 文件编码 */
  encoding?: string
  /** 跳过的行数 */
  skip_rows?: number
  /**
   * 遇到坏行时的处理方式
   * @values
   * - 'error': 抛出错误
   * - 'warn': 发出警告并跳过
   * - 'skip': 静默跳过
   */
  on_bad_lines?: 'error' | 'warn' | 'skip'
}

/**
 * Excel 格式选项。
 *
 * 用于配置 pandas read_excel 的解析行为。
 */
export interface ExcelOptionsV2 {
  /**
   * Excel 解析引擎
   * @values
   * - 'openpyxl': 现代 Excel 格式（.xlsx）
   * - 'xlrd': 旧版 Excel 格式（.xls）
   */
  engine?: 'openpyxl' | 'xlrd'
  /** 是否启用数据类型推断 */
  dtype_inference?: boolean
}

/**
 * 格式选项联合类型。
 *
 * 根据数据源类型选择对应的格式选项配置。
 */
export type FormatOptionsV2 = JSONOptionsV2 | CSVOptionsV2 | ExcelOptionsV2

/**
 * 数据源规格定义。
 *
 * 描述 Schema 所引用的外部数据源文件的位置和解析方式。
 */
export interface SourceSpecV2 {
  /** 路径模式：相对路径或绝对路径 */
  mode: SourceModeV2
  /** 文件路径 */
  path: string
  /** Excel Sheet 名称（仅 Excel 有效） */
  sheet?: string
  /** 表头所在行索引（0-based） */
  header_row: number
  /** 格式特定选项（JSON/CSV/Excel） */
  options?: FormatOptionsV2
}

/**
 * 数据源资源引用。
 *
 * 用于在 project.precis.yaml 中索引外部数据源。
 */
export interface DataSourceRefV2 {
  /** 数据源唯一标识符 */
  id: string
  /** 数据源目录路径 */
  path: string
  /** 路径模式: 'relative'（相对项目目录）或 'absolute'（绝对路径） */
  mode: 'relative' | 'absolute'
  /** 数据源描述（可选） */
  description?: string
}
