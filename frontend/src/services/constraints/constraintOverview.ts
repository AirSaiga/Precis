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
 * @fileoverview Schema 约束概览弹层的纯逻辑（分组 / 状态聚合）
 *
 * 三层表达方案的①索引层：把约束坞退役后的"按列一览"价值以 Schema 头部弹层重建。
 * 行派生复用 constraintDensity 的 deriveConstraintFamilies（列序 + 内嵌先独立后 +
 * 表级沉底），本模块只做展示侧纯变换：
 * - flattenSchemaColumnsForOverview：Schema/jsonSchema 列树 → 有序 {id, name} 清单
 * - groupConstraintRowsByColumn：行清单 → 按列分组的 chips 小节（表级沉底）
 * - aggregateStatusCounts：chips → ✓/✗/◌ 三桶计数（内嵌无运行态不计入）
 *
 * 纯函数、参数注入、不碰 store 与 DOM，可直接单测。
 */

import type { BaseSchemaColumn } from '@/types/graph'
import type { ConstraintRowEntry } from '@/stores/graphStore/modules/constraintDensity'

/** 有序列引用：分组小节的标题来源（schema 平铺 / jsonSchema 树先序遍历） */
export interface ConstraintOverviewColumnRef {
  id: string
  name: string
}

/** chip 的运行态：standalone 取约束节点 validationStatus；内嵌约束无运行态（null） */
export type ConstraintChipStatus = 'idle' | 'pass' | 'error' | 'missing' | null

/** 概览 chip：行条目 + 运行态快照（组件侧经 computed 直读保持响应式） */
export interface ConstraintOverviewChip {
  constraintId: string
  kind: string
  columnId?: string
  label: string
  embedded: boolean
  /** null = 内嵌约束（无独立卡片、无校验状态）；缺省 idle */
  status: ConstraintChipStatus
  /** 最近一次校验的错误数（仅 standalone 有意义） */
  errorCount: number
}

/** 概览小节：一列（或表级）下的 chips 集合 */
export interface ConstraintOverviewSection {
  /** columnId；表级小节为固定哨兵值 */
  key: string
  /** 小节标题：列显示名；表级由调用方传入 i18n 文案 */
  title: string
  /** 是否表级（含悬挂列）小节 */
  isTableLevel: boolean
  chips: ConstraintOverviewChip[]
}

/** 头部状态聚合计数：✓ pass / ✗ error / ◌ 未校验（idle+missing；内嵌不计入） */
export interface ConstraintOverviewStatusCounts {
  pass: number
  error: number
  pending: number
}

/** 表级小节的固定 key（与列 id 空间无冲突的哨兵） */
export const TABLE_LEVEL_SECTION_KEY = '__table_level__'

/**
 * Schema 列树 → 有序 {id, name} 清单（深度优先先序：父列后紧跟其子列）。
 * Schema 列无 children，等价于原序列；jsonSchema 嵌套子列按树展开。
 */
export function flattenSchemaColumnsForOverview(
  columns: ReadonlyArray<BaseSchemaColumn & { children?: unknown[] }> | undefined
): ConstraintOverviewColumnRef[] {
  const result: ConstraintOverviewColumnRef[] = []
  const walk = (cols: ReadonlyArray<BaseSchemaColumn & { children?: unknown[] }>) => {
    for (const col of cols) {
      result.push({ id: col.id, name: col.columnName || col.id })
      if (Array.isArray(col.children) && col.children.length > 0) {
        walk(col.children as ReadonlyArray<BaseSchemaColumn & { children?: unknown[] }>)
      }
    }
  }
  if (columns) walk(columns)
  return result
}

/**
 * 行清单 → 按列分组的小节列表。
 * 小节顺序 = orderedColumns 顺序（无约束的列跳过）；
 * columnId 缺失或不在列集中的行（表级 + 悬挂）归入表级小节沉底。
 */
export function groupConstraintRowsByColumn(
  rows: ReadonlyArray<ConstraintRowEntry>,
  orderedColumns: ReadonlyArray<ConstraintOverviewColumnRef>,
  resolveStatus: (row: ConstraintRowEntry) => { status: ConstraintChipStatus; errorCount: number }
): ConstraintOverviewSection[] {
  const sections: ConstraintOverviewSection[] = []
  const tableLevel: ConstraintOverviewChip[] = []

  const chipsByColumnId = new Map<string, ConstraintOverviewChip[]>()
  const knownColumnIds = new Set(orderedColumns.map((c) => c.id))
  for (const row of rows) {
    const resolved = resolveStatus(row)
    const chip: ConstraintOverviewChip = {
      constraintId: row.constraintId,
      kind: row.kind,
      columnId: row.columnId,
      label: row.label,
      embedded: row.embedded,
      status: resolved.status,
      errorCount: resolved.errorCount,
    }
    if (row.columnId && knownColumnIds.has(row.columnId)) {
      const bucket = chipsByColumnId.get(row.columnId)
      if (bucket) bucket.push(chip)
      else chipsByColumnId.set(row.columnId, [chip])
    } else {
      tableLevel.push(chip)
    }
  }

  for (const column of orderedColumns) {
    const chips = chipsByColumnId.get(column.id)
    if (!chips || chips.length === 0) continue
    sections.push({ key: column.id, title: column.name, isTableLevel: false, chips })
  }
  if (tableLevel.length > 0) {
    sections.push({
      key: TABLE_LEVEL_SECTION_KEY,
      title: '',
      isTableLevel: true,
      chips: tableLevel,
    })
  }
  return sections
}

/**
 * chips → 三桶状态计数。内嵌约束（status === null，无独立校验态）不计入任何桶；
 * missing 与 idle 合入 pending（◌ 桶，chip 级 tooltip 仍区分两者）。
 */
export function aggregateStatusCounts(
  chips: ReadonlyArray<ConstraintOverviewChip>
): ConstraintOverviewStatusCounts {
  const counts: ConstraintOverviewStatusCounts = { pass: 0, error: 0, pending: 0 }
  for (const chip of chips) {
    if (chip.status === 'pass') counts.pass++
    else if (chip.status === 'error') counts.error++
    else if (chip.status === 'idle' || chip.status === 'missing') counts.pending++
    // status === null（内嵌）：无运行态，不计入
  }
  return counts
}
