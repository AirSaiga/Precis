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
 * @file validationContext.ts
 * @description 约束验证上下文构建（纯函数）
 *
 * 从 validationRegistryCore 拆出，避免 regex 校验模块与注册表核心之间的循环依赖。
 */

import type { Edge, Node } from '@vue-flow/core'
import type { ConstraintValidationContext } from './types'
import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'

export function buildValidationContext(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
}): ConstraintValidationContext | null {
  const { schemaNode, constraintNode, edge } = params
  const sourceHandle = edge.sourceHandle || ''
  if (!sourceHandle.startsWith('source-right-')) return null
  const columnId = sourceHandle.replace('source-right-', '')
  const schemaData = (schemaNode.data || {}) as Record<string, unknown>

  // 根据节点类型查找列：jsonSchema 支持嵌套 children，schema 保持平面查找
  let column: Record<string, unknown> | undefined
  if (schemaNode.type === 'jsonSchema') {
    const found = findJsonSchemaColumnById(
      schemaData.columns as import('@/types/graph').JsonSchemaColumn[],
      columnId
    )
    column = found ? (found.column as unknown as Record<string, unknown>) : undefined
  } else {
    column = ((schemaData.columns || []) as unknown[]).find(
      (c) => (c as Record<string, unknown>).id === columnId
    ) as Record<string, unknown> | undefined
  }
  if (!column) return null

  return {
    nodes: params.nodes,
    schemaNode,
    constraintNode,
    edge,
    columnId,
    columnName: column.columnName as string,
    columnDataType: (column.dataType as string) || undefined,
    sourceFilePath: (schemaData.localPath || schemaData.sourceFilePath) as string,
    sourceFile: schemaData.sourceFile as string,
    sheetName: schemaData.sheetName as string,
    headerRow: typeof schemaData.headerRow === 'number' ? schemaData.headerRow : 0,
    // 使用节点级 jsonPath 作为 JSON 数据源的记录提取路径
    // 列级 jsonPath 仅用于 Schema 展示/导出，不用于后端加载数据
    jsonPath: (schemaData.jsonPath as string) || undefined,
    recordPath: (schemaData.recordPath as string) || undefined,
    jsonFormat: (schemaData.format as string) || undefined,
  }
}
