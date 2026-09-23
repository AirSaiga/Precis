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
 * @fileoverview 约束列引用解析器：严格区分「列名字段」与「列 ID 字段」两类引用
 *
 * 与后端 embedded_constraints（build_qualified_name_to_id_map）保持同一约定：
 * - resolve(ref)：名称字段（column / columns / from_column / to_column）专用，
 *   仅接受顶层裸名（email）或嵌套「父.子」全限定路径（customer.email），
 *   不做递归裸名猜测、不接受列 ID；未命中返回 undefined，由调用方报错。
 * - byId(id)：ID 字段（column_id / then_column_id / if_column_id 等）专用，
 *   按列 ID 直查任意层级列。
 *
 * 兼容多种列树形状：V2 ColumnSpecV2（name）、Schema/JsonSchema 节点列
 * （columnName，JsonSchema 带 children）、AI spec 原始列。
 */

export interface ColumnRefNode {
  id?: string
  name?: string
  columnName?: string
  children?: ColumnRefNode[]
}

/** 单个列的解析结果 */
export interface ResolvedColumnRef {
  /** 真实列 id（嵌套子列为其自身 id） */
  columnId: string
  /** 全限定列名（顶层为裸名，嵌套为「父.子」路径），用于展示与持久化 */
  columnName: string
  /** 顶层祖先列 id：画布连线 handle（source-right-{rootColumnId}）用 */
  rootColumnId: string
}

export interface ColumnRefResolver {
  /** 名称字段严格解析：顶层裸名 / 嵌套「父.子」全限定路径；未命中返回 undefined */
  resolve: (ref: string) => ResolvedColumnRef | undefined
  /** ID 字段直查：按列 ID 返回任意层级列的信息；未命中返回 undefined */
  byId: (columnId: string) => ResolvedColumnRef | undefined
}

export function buildColumnRefResolver(tree: ColumnRefNode[] | undefined): ColumnRefResolver {
  const byName = new Map<string, ResolvedColumnRef>()
  const byId = new Map<string, ResolvedColumnRef>()

  const walk = (nodes: ColumnRefNode[], parentPath: string, rootColumnId: string) => {
    const prefix = parentPath ? `${parentPath}.` : ''
    for (const node of nodes) {
      const id = node.id
      const name = node.columnName ?? node.name
      let nextRoot = rootColumnId
      if (id && name) {
        const qualifiedName = `${prefix}${name}`
        nextRoot = rootColumnId || id
        const info: ResolvedColumnRef = {
          columnId: id,
          columnName: qualifiedName,
          rootColumnId: nextRoot,
        }
        // 同名键保留首个（深度优先序），与后端 build_qualified_name_to_id_map 一致
        if (!byName.has(qualifiedName)) byName.set(qualifiedName, info)
        if (!byId.has(id)) byId.set(id, info)
      }
      if (node.children?.length) {
        walk(node.children, name ? `${prefix}${name}` : parentPath, nextRoot)
      }
    }
  }
  walk(tree ?? [], '', '')

  return {
    resolve: (ref: string) => byName.get(ref),
    byId: (columnId: string) => byId.get(columnId),
  }
}
