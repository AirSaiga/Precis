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
 * @fileoverview V2 ManualData 类型：内联数据节点的 manifest 引用与
 * manual_data/{id}.yaml 文件内容。
 */

/**
 * ManualData 节点引用（manifest 中的 manual_data 列表项）。
 */
export interface ManualDataRefV2 {
  /** ManualData 节点唯一标识符 */
  id: string
  /** ManualData 文件路径（相对于项目目录） */
  path: string
}

/**
 * ManualData 节点文件内容。
 *
 * 对应 manual_data/{id}.yaml 配置文件。
 */
export interface ManualDataFileV2 {
  /** 配置版本号（固定为 2） */
  version: number
  /** 节点 ID（与 manifest ref id 一致） */
  id: string
  /** 列名 */
  column_name: string
  /** 列数据类型 */
  column_data_type: 'string' | 'integer' | 'float' | 'decimal' | 'boolean' | 'date'
  /** 二维字符串数组，每行一个字段值 */
  rows: string[][]
  /** 是否启用 */
  enabled: boolean
  /** 描述 */
  description?: string
  /** 上游节点 ID（当从 Schema 列注入数据时设置） */
  input_from_node?: string
}
