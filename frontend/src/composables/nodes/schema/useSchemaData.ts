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
 * @file useSchemaData.ts
 * @description Schema数据管理组合式函数
 *
 * 该模块负责管理 Schema 节点的数据结构，包括列的增删改查等核心操作。
 * 底层逻辑已提取至 useSchemaDataBase，本文件仅做类型特化包装。
 */

import type { EmitFn } from 'vue'
import type { SchemaNodeData, SchemaColumn } from '../types'
import { useSchemaDataBase } from '../shared/useSchemaDataBase'

export function useSchemaData(
  props: { id: string; data: SchemaNodeData },
  emit: EmitFn<{ dataChanged: [SchemaNodeData] }>
) {
  return useSchemaDataBase<SchemaColumn, SchemaNodeData>(props, emit)
}
