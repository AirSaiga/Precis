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
 * @fileoverview 命令面板节点搜索源 —— 纯逻辑：索引构建 / 子串过滤 / 隐藏节点揭示聚焦
 *
 * 匹配策略刻意简单：大小写不敏感的子串匹配（无模糊算法），可检索字段按节点
 * 类别提取（configName / 表名 / 列名 / 约束类型名 / regex pattern 等）。
 * i18n 依赖（约束类型显示名）由调用方以 typeLabels 注入，保持本模块可单测。
 */

import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { NodeSearchEntry } from '../types'

/**
 * 不进结果集的纯 UI 节点：约束坞 / 正则工具箱 / 约束仪表盘都是派生视图，
 * 定位它们没有业务意义（其宿主数据源才是搜索目标）。
 */
export const PALETTE_EXCLUDED_NODE_TYPES: ReadonlySet<string> = new Set([
  'constraintDock',
  'patternToolbox',
  'constraintDashboard',
])

/** 节点结果上限：大项目数百节点全渲染会拖慢面板，截断为前 N 条 */
export const MAX_NODE_RESULTS = 50

/** schema/jsonSchema 节点判定（与 viewFilter / dockSync 的同名判定一致） */
function isSchemaNodeType(type: string | undefined): boolean {
  return type === 'schema' || type === 'jsonSchema'
}

function readData(node: CustomNode): Record<string, unknown> {
  return (node.data || {}) as Record<string, unknown>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Schema 列名收集（jsonSchema 的嵌套子列仅取首层，够搜索用） */
function readColumnNames(data: Record<string, unknown>): string[] {
  const columns = data.columns
  if (!Array.isArray(columns)) return []
  const names: string[] = []
  for (const col of columns) {
    if (!col || typeof col !== 'object') continue
    const name = (col as Record<string, unknown>).columnName
    if (typeof name === 'string') names.push(name)
  }
  return names
}

export interface BuildNodeSearchEntriesOptions {
  /** 节点类型 → 本地化显示名（约束类型名经 constraintMeta + i18n 由调用方备好） */
  typeLabels: Record<string, string>
}

/**
 * 从画布节点构建搜索索引（纯函数）。
 *
 * 结果顺序保持画布节点顺序（稳定、可预测）；每类节点提取主/次标签与
 * 可检索字段拼为 searchText（小写）。次标签（所属 Schema）经 sourceRef
 * 解析——覆盖约束 / 正则等挂靠节点；无挂靠或 Schema 已删除时为空串。
 */
export function buildNodeSearchEntries(
  nodes: ReadonlyArray<CustomNode>,
  options: BuildNodeSearchEntriesOptions
): NodeSearchEntry[] {
  const { typeLabels } = options

  // schema 显示名映射：sourceRef.nodeId → configName（解析约束/正则的所属 Schema）
  const schemaLabels = new Map<string, string>()
  for (const node of nodes) {
    if (!isSchemaNodeType(node.type)) continue
    const data = readData(node)
    schemaLabels.set(node.id, str(data.configName) || str(data.tableName) || node.id)
  }

  const entries: NodeSearchEntry[] = []
  for (const node of nodes) {
    const type = node.type ?? ''
    if (PALETTE_EXCLUDED_NODE_TYPES.has(type)) continue

    const data = readData(node)
    const extras: string[] = []
    let primary = ''
    let secondary = ''

    const sourceRefNodeId = str((data.sourceRef as Record<string, unknown> | undefined)?.nodeId)
    const schemaLabel = sourceRefNodeId ? (schemaLabels.get(sourceRefNodeId) ?? '') : ''

    if (type === 'projectRoot') {
      primary = str(data.projectName) || node.id
      extras.push(str(data.projectPath))
    } else if (isSchemaNodeType(type)) {
      primary = str(data.configName) || str(data.tableName) || node.id
      extras.push(str(data.tableName), str(data.sheetName), str(data.sourceFile))
      extras.push(...readColumnNames(data))
    } else if (type === 'sourcePreview' || type === 'jsonSourcePreview') {
      primary = str(data.configName) || str(data.sourceName) || str(data.fileName) || node.id
      extras.push(str(data.sourceName), str(data.fileName))
    } else if (type === 'regex' || type === 'regexExtract') {
      primary = str(data.configName) || node.id
      secondary = schemaLabel
      extras.push(str(data.pattern), str(data.description))
    } else if (type === 'transform') {
      primary = str(data.configName) || node.id
      extras.push(str(data.description), str(data.transformType), ...strList(data.outputColumns))
    } else if (type === 'transformOutput') {
      primary = str(data.configName) || str(data.columnName) || node.id
      extras.push(str(data.columnName))
    } else if (type === 'manualData') {
      primary = str(data.configName) || node.id
      extras.push(str(data.columnName), str(data.description))
    } else if (type === 'templateInstance') {
      primary = str(data.configName) || node.id
      extras.push(str(data.templateName), str(data.summaryText))
    } else if (type === 'pattern') {
      primary = str(data.name) || node.id
      extras.push(str(data.name))
    } else {
      // 约束节点（10 种 *Constraint）及其他未来业务类型
      const typeLabel = typeLabels[type] ?? ''
      primary = str(data.configName) || typeLabel || node.id
      secondary = schemaLabel
      extras.push(
        str(data.configName),
        str(data.constraintName),
        typeLabel,
        type,
        str(data.table),
        str(data.column),
        str(data.sourceTable),
        str(data.sourceColumn),
        str(data.targetTable),
        str(data.targetColumn),
        str(data.ifColumn),
        str(data.thenColumn)
      )
    }

    const searchText = [primary, secondary, typeLabels[type] ?? '', ...extras]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    entries.push({
      kind: 'node',
      nodeId: node.id,
      nodeType: type,
      primaryLabel: primary,
      secondaryLabel: secondary,
      searchText,
      hidden: node.hidden === true,
    })
  }
  return entries
}

/**
 * 大小写不敏感子串过滤（纯函数）。空 query（或纯空白）原样返回全部条目。
 */
export function filterPaletteEntries<T extends { searchText: string }>(
  entries: ReadonlyArray<T>,
  query: string
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter((entry) => entry.searchText.includes(q))
}

/**
 * 揭示并聚焦一个节点（依赖注入，供单测 mock 边界）。
 *
 * 节点被隐藏（坞聚合 / 视图筛选 / 模板折叠）时先经 updateNodeData 揭示——
 * hidden 在 state.ts 被路由为 node 级 patch；随后经注入的 focusNodes
 * （组件层发 eventBus 'focus-canvas-nodes'）执行 setSelection + fitView。
 * 揭示后节点成为当前选中，坞重聚合与视图筛选重应用都会因"选中豁免"
 * 跳过它，语义与约束坞 L1 点击揭示一致。
 */
export interface RevealFocusDeps {
  nodes: () => ReadonlyArray<CustomNode>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData & { hidden?: boolean }>) => void
  focusNodes: (nodeIds: string[]) => void
  /**
   * 同步标记 Vue Flow 内部选中集（双选择模型一致性，镜像约束坞 L1 的
   * markVueFlowSelected 模式）：setSelection 只写 Store 侧，VF 侧不标记
   * 则节点无高亮且下一次 VF→Store 同步可能覆写。可选——画布未挂载时省略。
   */
  markSelected?: (nodeId: string) => void
}

export function revealAndFocusNode(nodeId: string, deps: RevealFocusDeps): void {
  const node = deps.nodes().find((n) => n.id === nodeId)
  if (!node) return
  if (node.hidden === true) {
    deps.updateNodeData(nodeId, { hidden: false })
  }
  deps.markSelected?.(nodeId)
  deps.focusNodes([nodeId])
}
