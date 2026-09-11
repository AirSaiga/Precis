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
 * @fileoverview V2 Transform 类型：转换操作类型枚举、Transform 文件
 * （*.transform.yaml）与 manifest 引用。
 */

/**
 * Transform 类型枚举。
 *
 * 定义所有支持的数据转换操作类型。
 *
 * 分类说明：
 * - 字符串操作：StringSplit, Strip, UpperCase, LowerCase, Replace, Concat, Substring
 * - 正则操作：RegexExtract
 * - 数学计算：MathExpr, Digits, WeightedSum, Modulo
 * - 日期处理：DateFormat
 * - 查找替换：Lookup, MapValue
 * - 数据清洗：FilterRows, FillNA, DropDuplicates, CastType
 * - 聚合排序：Aggregate, SortRows
 * - 条件赋值：ConditionalAssign
 */
export type TransformTypeV2 =
  | 'StringSplit'
  | 'RegexExtract'
  | 'MathExpr'
  | 'DateFormat'
  | 'Lookup'
  | 'Strip'
  | 'UpperCase'
  | 'LowerCase'
  | 'Replace'
  | 'FilterRows'
  | 'FillNA'
  | 'DropDuplicates'
  | 'CastType'
  | 'Concat'
  | 'Substring'
  | 'Aggregate'
  | 'ConditionalAssign'
  | 'SortRows'
  // 原子化校验操作
  | 'Digits'
  | 'WeightedSum'
  | 'Modulo'
  | 'MapValue'

/**
 * Transform 资源引用。
 *
 * 用于在 project.precis.yaml 中索引 Transform 文件。
 */
export interface TransformRefV2 {
  /** Transform 唯一标识符 */
  id: string
  /** Transform 文件路径（相对于项目目录） */
  path: string
}

/**
 * Transform 配置文件结构（*.transform.yaml）。
 */
export interface TransformFileV2 {
  /** 配置版本号 */
  version: number
  /** Transform 唯一标识符 */
  id: string
  /** Transform 名称（可选） */
  name?: string
  /** Transform 类型 */
  type: TransformTypeV2
  /** 是否启用 */
  enabled: boolean
  /** Transform 描述（可选） */
  description?: string
  /** 上游数据流节点 ID */
  input_from_node?: string
  /** 上游节点中的目标列名 */
  input_column?: string
  /** 转换参数（因类型而异） */
  params: Record<string, unknown>
  /** 转换后产生的列名列表 */
  output_columns: string[]
}
