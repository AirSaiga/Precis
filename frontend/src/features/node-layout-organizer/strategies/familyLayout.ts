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
 * @file familyLayout.ts
 * @description 家族内部布局辅助函数
 *
 * 功能概述：
 * - 单个 Schema 家族内部的流式布局计算
 * - 节点分类、边界计算、维度回退
 * - 约束区分节：列亲和（默认，按目标列分节）与按类型分节（历史行为）
 * - 按列对齐约束节点
 */
import type { SubGroup, ConnectionInfo, MemberColumnTarget } from '../types'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '../types'
import {
  COLUMN_GROUPING_COLORS,
  COLUMN_GROUPING_LABELS,
  GROUP_COLORS,
  LAYOUT_CONSTANTS,
  NODE_DIMENSIONS,
  NODE_TYPE_COLORS,
  NODE_TYPE_NAMES,
  SAFE_FITVIEW_PADDING_PX,
} from '../constants'
import { getDefaultDimension, type NodeDimension } from '../utils/nodeDimensionHelper'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { isRegexNodeType } from '@/utils/nodes/regex'
/**
 * 获取节点类型的回退尺寸
 */
export function getFallbackDimension(nodeType: string): NodeDimension {
  // 与 useSchemaResizable 的 DEFAULT_WIDTH(360) 对齐；实测大卡可达 690 宽
  // （DEF-14），优先走 node.dimensions / data.width 实测路径，这里仅兜底
  if (nodeType === 'schema') return { width: 360, height: 400 }
  if (isRegexNodeType(nodeType))
    return { width: NODE_DIMENSIONS.DEFAULT_WIDTH, height: NODE_DIMENSIONS.DEFAULT_HEIGHT }
  if (isConstraintNodeType(nodeType))
    return { width: NODE_DIMENSIONS.CONSTRAINT_WIDTH, height: NODE_DIMENSIONS.CONSTRAINT_HEIGHT }
  const dim = getDefaultDimension(nodeType)
  return { width: dim.width, height: dim.height }
}

/**
 * 按节点类型对节点 ID 进行分组。
 *
 * 保持输入顺序：调用方负责在分组前完成语义排序（如 Schema 列序），
 * 此处不得重新排序，否则会覆盖上游的排序意图。
 */
export function groupByType(
  nodeIds: string[],
  nodeTypeById: Map<string, string>
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const id of nodeIds) {
    const type = nodeTypeById.get(id) || 'unknown'
    if (!result.has(type)) result.set(type, [])
    result.get(type)!.push(id)
  }
  return result
}

/**
 * 估算 Schema 列行顶相对节点顶部的偏移（header 高 + index × 行高）。
 *
 * 布局是纯计算层没有 DOM，行高由 Schema 节点高度与列数估算：
 * header 按 30% 高度封顶 120px 估计，剩余高度均摊到各列行。
 * 仅用于列节顶部的尽力对齐，不要求精确。
 */
export function estimateColumnRowOffset(
  columnIndex: number,
  schemaHeight: number,
  columnCount: number
): number {
  const header = Math.min(schemaHeight * 0.3, 120)
  const rowHeight = (schemaHeight - header) / Math.max(1, columnCount)
  return header + columnIndex * rowHeight
}

/** 约束区分节方案（列亲和与类型分节共用的节描述） */
export interface ConstraintSectionPlan {
  /** SubGroup id 后缀与 nodeType 字段值（类型节=类型名；列节=col-<columnId>；表级=tableLevel） */
  key: string
  /** 节标题：类型节=类型显示名；列节=列名；表级=固定标题 */
  label: string
  color: string
  nodeIds: string[]
  /** 节排序值（列节=列序；类型节=成员最小列序；表级恒沉底） */
  order: number
  /** 列节行对齐目标（相对 Schema 节点顶部的偏移）；表级/类型节无 */
  alignOffsetY?: number
}

/**
 * 生成约束区分节方案。
 *
 * - grouping 'column'（列亲和）：每个被引用的 Schema 列一节（节内类型混合，
 *   按类型显示名做次级稳定排序），节序=列序；无列引用或 columnId 失效的
 *   约束（含 ForeignKey/Composite 等表级约束）沉底为一个"表级"节。
 *   家族无 Schema 列信息（伪家族、无 columns 的 Schema）时回退类型分节，
 *   保持伪家族历史行为不变。
 * - grouping 'type'：按约束类型分节（历史行为）。
 *
 * 输入 constraints 应已由调用方完成语义排序；本函数只负责分节与节内排序。
 */
export function planConstraintSections(params: {
  constraints: string[]
  nodeTypeById: Map<string, string>
  grouping: 'column' | 'type'
  /** 成员 → 目标列信息；未提供时列亲和不可用（回退类型分节） */
  columnTargetById?: Map<string, MemberColumnTarget>
  /** Schema 节点尺寸（行对齐估算用）；伪家族无 Schema 传 null */
  schemaDim: { width: number; height: number } | null
  /** Schema 列总数；缺省按目标列最大序号 +1 估算 */
  schemaColumnCount?: number
}): ConstraintSectionPlan[] {
  const { constraints, nodeTypeById, columnTargetById } = params
  const sortIndexOf = (id: string): number =>
    columnTargetById?.get(id)?.columnIndex ?? Number.MAX_SAFE_INTEGER

  const plans: ConstraintSectionPlan[] = []

  const maxTargetIndex = columnTargetById
    ? Math.max(-1, ...Array.from(columnTargetById.values(), (t) => t.columnIndex))
    : -1
  const columnCount = params.schemaColumnCount ?? maxTargetIndex + 1
  const schemaDim = params.schemaDim

  if (params.grouping !== 'column' || !schemaDim || columnCount <= 0 || !columnTargetById) {
    for (const [type, ids] of groupByType(constraints, nodeTypeById)) {
      plans.push({
        key: type,
        label: NODE_TYPE_NAMES[type] || type,
        color: NODE_TYPE_COLORS[type] || '#ccc',
        nodeIds: ids,
        order: Math.min(...ids.map(sortIndexOf)),
      })
    }
    return plans
  }

  const byColumn = new Map<string, { target: MemberColumnTarget; ids: string[] }>()
  const tableLevel: string[] = []
  for (const id of constraints) {
    const target = columnTargetById.get(id)
    if (!target) {
      tableLevel.push(id)
      continue
    }
    const bucket = byColumn.get(target.columnId) ?? { target, ids: [] }
    bucket.ids.push(id)
    byColumn.set(target.columnId, bucket)
  }

  const buckets = Array.from(byColumn.values()).sort(
    (a, b) =>
      a.target.columnIndex - b.target.columnIndex ||
      a.target.columnId.localeCompare(b.target.columnId)
  )
  for (const bucket of buckets) {
    // 节内次级稳定排序：同列各类型相邻聚拢。按类型标识符（ASCII）排序而非
    // 本地化显示名——显示名 localeCompare 在 zh/en collation 下顺序可能相反，
    // 布局需保证跨环境确定性；同类型内按 id 兜底稳定
    const typeOf = (id: string): string => nodeTypeById.get(id) || 'unknown'
    const ids = bucket.ids.slice().sort((a, b) => {
      const ta = typeOf(a)
      const tb = typeOf(b)
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.localeCompare(b)
    })
    plans.push({
      key: `col-${bucket.target.columnId}`,
      label: bucket.target.columnName,
      color: COLUMN_GROUPING_COLORS.COLUMN,
      nodeIds: ids,
      order: bucket.target.columnIndex,
      alignOffsetY: estimateColumnRowOffset(
        bucket.target.columnIndex,
        schemaDim.height,
        columnCount
      ),
    })
  }
  if (tableLevel.length > 0) {
    plans.push({
      key: 'tableLevel',
      label: COLUMN_GROUPING_LABELS.TABLE_LEVEL_NAME,
      color: COLUMN_GROUPING_COLORS.TABLE_LEVEL,
      nodeIds: tableLevel,
      order: Number.MAX_SAFE_INTEGER,
    })
  }
  return plans
}

/**
 * 流式布局：将节点按顺序从左到右、从上到下排列
 * 当行宽度超过 maxWidth 时自动换行
 */
export function flowLayout(
  nodeIds: string[],
  outPositions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>,
  startX: number,
  startY: number,
  maxWidth: number,
  gap: number
): { bounds: { x: number; y: number; width: number; height: number }; nextY: number } {
  let x = startX
  let y = startY
  let rowHeight = 0
  let maxX = startX
  let maxY = startY

  for (const id of nodeIds) {
    const dim = nodeDimensions.get(id) || getFallbackDimension('')
    if (x > startX && x + dim.width > startX + maxWidth) {
      x = startX
      y += rowHeight + gap
      rowHeight = 0
    }

    outPositions.set(id, { x, y })
    maxX = Math.max(maxX, x + dim.width)
    maxY = Math.max(maxY, y + dim.height)
    rowHeight = Math.max(rowHeight, dim.height)
    x += dim.width + gap
  }

  return {
    bounds: {
      x: startX,
      y: startY,
      width: Math.max(0, maxX - startX),
      height: Math.max(0, maxY - startY),
    },
    nextY: maxY,
  }
}

/**
 * 从局部坐标计算节点包围边界（无 padding）
 */
export function calculateBoundsFromLocal(
  nodeIds: string[],
  positions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>
): { x: number; y: number; width: number; height: number } | null {
  if (nodeIds.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of nodeIds) {
    const pos = positions.get(id)
    const dim = nodeDimensions.get(id)
    if (!pos || !dim) continue
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + dim.width)
    maxY = Math.max(maxY, pos.y + dim.height)
  }

  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 从位置计算带 padding 的节点包围边界
 */
export function calculateBoundsFromPositions(
  nodeIds: string[],
  positions: Map<string, { x: number; y: number }>,
  nodeDimensions: Map<string, NodeDimension>,
  nodeTypeById: Map<string, string>,
  padding: number
): { x: number; y: number; width: number; height: number } | null {
  if (nodeIds.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of nodeIds) {
    const pos = positions.get(id)
    if (!pos) continue
    const dim = nodeDimensions.get(id) || getFallbackDimension(nodeTypeById.get(id) || '')
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + dim.width)
    maxY = Math.max(maxY, pos.y + dim.height)
  }

  if (minX === Infinity) return null
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

/**
 * 计算单个 Schema 家族的内部布局
 */
export function layoutFamily(params: {
  familyId: string
  familyName: string
  schemaNodeId: string | null
  memberNodeIds: string[]
  nodeTypeById: Map<string, string>
  nodeDimensions: Map<string, NodeDimension>
  canvasWidth: number
  layoutMode: 'horizontal' | 'vertical'
  gap: number
  edges: ConnectionInfo[]
  /** 画布高度（水平模式下用于按视口适配度选择右侧列数；缺省按 900 估算） */
  canvasHeight?: number
  /** 成员节点 → 目标 Schema 列信息（列亲和分节 + 语义排序）。缺省视为无列信息，按 UUID 序兜底 */
  memberColumnTargetById?: Map<string, MemberColumnTarget>
  /** Schema 列总数（列行对齐估算用；缺省按目标列最大序号 +1 估算） */
  schemaColumnCount?: number
  /** 家族内约束区分节维度：'column' 列亲和（默认）| 'type' 按类型（历史行为） */
  constraintGrouping?: 'column' | 'type'
}): {
  localPositions: Map<string, { x: number; y: number }>
  subGroups: SubGroup[]
  width: number
  height: number
  color: string
} {
  const {
    schemaNodeId,
    memberNodeIds,
    nodeTypeById,
    nodeDimensions,
    canvasWidth,
    layoutMode,
    gap,
  } = params
  const localPositions = new Map<string, { x: number; y: number }>()

  const familyPadding = 40
  const sectionGap = 40

  const allIds = (schemaNodeId ? [schemaNodeId, ...memberNodeIds] : memberNodeIds.slice()).filter(
    Boolean
  ) as string[]

  const sources: string[] = []
  const regexNodes: string[] = []
  const constraints: string[] = []
  const others: string[] = []

  for (const id of memberNodeIds) {
    const type = nodeTypeById.get(id) || ''
    if (type === 'sourcePreview' || type === 'jsonSourcePreview') sources.push(id)
    else if (isRegexNodeType(type)) regexNodes.push(id)
    else if (NODE_TYPE_TO_CATEGORY[type] === NodeCategory.CONSTRAINT || isConstraintNodeType(type))
      constraints.push(id)
    else others.push(id)
  }

  sources.sort((a, b) => a.localeCompare(b))
  // 约束/正则/Others 优先按 Schema 列序排列（与左侧 Schema 字段自上而下的顺序呼应），
  // 无列序信息时回退 UUID 序，保持历史行为
  const sortIndexOf = (id: string): number =>
    params.memberColumnTargetById?.get(id)?.columnIndex ?? Number.MAX_SAFE_INTEGER
  const semanticOrder = (a: string, b: string): number =>
    sortIndexOf(a) - sortIndexOf(b) || a.localeCompare(b)
  regexNodes.sort(semanticOrder)
  constraints.sort(semanticOrder)
  others.sort(semanticOrder)

  const subGroups: SubGroup[] = []
  const familyColor = GROUP_COLORS[NodeCategory.CORE]?.border || '#2196f3'

  const maxFamilyWidth = Math.max(
    700,
    Math.min(1200, canvasWidth - LAYOUT_CONSTANTS.CANVAS_PADDING * 2)
  )

  // 约束区分节方案：列亲和（默认）或按类型（历史行为），两种布局模式共用
  const schemaDim =
    schemaNodeId !== null
      ? nodeDimensions.get(schemaNodeId) || getFallbackDimension('schema')
      : null
  const constraintPlans = planConstraintSections({
    constraints,
    nodeTypeById,
    grouping: params.constraintGrouping ?? 'column',
    columnTargetById: params.memberColumnTargetById,
    schemaDim,
    schemaColumnCount: params.schemaColumnCount,
  })

  if (layoutMode === 'vertical') {
    let y = familyPadding
    if (schemaNodeId) {
      localPositions.set(schemaNodeId, { x: familyPadding, y })
      const dim = nodeDimensions.get(schemaNodeId) || getFallbackDimension('schema')
      y += dim.height + sectionGap
    }

    const placeSection = (nodeIds: string[], label: string, color: string, nodeType: string) => {
      if (nodeIds.length === 0) return
      const { bounds, nextY } = flowLayout(
        nodeIds,
        localPositions,
        nodeDimensions,
        familyPadding,
        y,
        maxFamilyWidth - familyPadding * 2,
        gap
      )
      y = nextY + sectionGap
      subGroups.push({
        id: `sub-${params.familyId}-${nodeType}`,
        name: label,
        nodeType,
        nodeIds,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        color,
        collapsed: false,
      })
    }

    placeSection(
      sources,
      NODE_TYPE_NAMES.sourcePreview || 'sourcePreview',
      NODE_TYPE_COLORS.sourcePreview || '#ccc',
      'sourcePreview'
    )
    placeSection(
      regexNodes,
      NODE_TYPE_NAMES.regex || 'regex',
      NODE_TYPE_COLORS.regex || '#ccc',
      'regex'
    )

    for (const plan of constraintPlans) {
      placeSection(plan.nodeIds, plan.label, plan.color, plan.key)
    }

    placeSection(others, 'Others', '#9e9e9e', 'others')
  } else {
    // === 水平模式 ===

    // 1. Sources — 垂直堆叠在 Schema 左侧
    let maxSourceWidth = 0
    let sourceY = familyPadding
    for (const id of sources) {
      localPositions.set(id, { x: familyPadding, y: sourceY })
      const dim = nodeDimensions.get(id) || getFallbackDimension(nodeTypeById.get(id) || '')
      sourceY += dim.height + gap
      maxSourceWidth = Math.max(maxSourceWidth, dim.width)
    }

    // 2. Schema — 放在 Sources 右侧
    let schemaX = familyPadding
    const schemaY = familyPadding
    if (sources.length > 0) schemaX += maxSourceWidth + gap
    if (schemaNodeId) {
      localPositions.set(schemaNodeId, { x: schemaX, y: schemaY })
    }

    const schemaSize = schemaNodeId
      ? nodeDimensions.get(schemaNodeId) || getFallbackDimension('schema')
      : { width: 0, height: 0 }
    const rightStartX = schemaX + schemaSize.width + gap

    // 3. 右侧区块：约束按列亲和分节（默认；列节=Schema 列，表级沉底）或按类型分节，
    //    正则与 Others 各成一节。节与节之间按最小 Schema 列序稳定排序
    //    （无列序信息时保持构造顺序，与历史行为一致）
    type RightSection = {
      nodeType: string
      ids: string[]
      label: string
      color: string
      order: number
      /** 列节行对齐目标（家族局部 y = schemaY + 列行偏移）；表级/类型节无 */
      alignY?: number
    }

    const sections: RightSection[] = constraintPlans.map((plan) => ({
      nodeType: plan.key,
      ids: plan.nodeIds,
      label: plan.label,
      color: plan.color,
      order: plan.order,
      alignY:
        plan.alignOffsetY !== undefined && schemaNodeId !== null
          ? schemaY + plan.alignOffsetY
          : undefined,
    }))
    if (regexNodes.length > 0) {
      sections.push({
        nodeType: 'regex',
        ids: regexNodes,
        label: NODE_TYPE_NAMES.regex || 'regex',
        color: NODE_TYPE_COLORS.regex || '#ccc',
        order: Math.min(...regexNodes.map(sortIndexOf)),
      })
    }
    if (others.length > 0) {
      // Others 恒排最后
      sections.push({
        nodeType: 'others',
        ids: others,
        label: 'Others',
        color: '#9e9e9e',
        order: Number.MAX_SAFE_INTEGER,
      })
    }
    sections.sort((a, b) => a.order - b.order)

    // 4. 分栏放置：列内各节纵向堆叠；列数 k 按视口适配度选择——
    //    以 fitView 的视角比较每个候选 k 下家族包围盒的缩放适配度，取最优。
    //    避免"约束全部堆成一根长柱、画布右侧大面积留白"的失衡布局。
    if (sections.length > 0) {
      const dim = (id: string): NodeDimension =>
        nodeDimensions.get(id) || getFallbackDimension(nodeTypeById.get(id) || '')
      const sectionWidth = (ids: string[]): number => Math.max(...ids.map((id) => dim(id).width))

      // 可用区域与 fitView 的 SAFE_FITVIEW_PADDING 保持一致（不对称留白：
      // 右侧检查器/底部状态栏/MiniMap），否则 k 选择会系统性高估可用空间
      const availW = Math.max(
        1,
        canvasWidth - SAFE_FITVIEW_PADDING_PX.left - SAFE_FITVIEW_PADDING_PX.right
      )
      const availH = Math.max(
        1,
        (params.canvasHeight ?? 900) - SAFE_FITVIEW_PADDING_PX.top - SAFE_FITVIEW_PADDING_PX.bottom
      )
      // 节内换列阈值：单节最多占据整个纵向可用区（扣除家族上下 padding）。
      // 不预扣 sectionGap——阈值过紧会让临界高的节过早换列、把分栏方案挤宽，
      // 反而劣化 k 选择；换列只兜底"病态长节"（如同类型约束远超视口高度）。
      const wrapThreshold = Math.max(360, availH - familyPadding * 2)

      /**
       * 节的度量：节点纵向堆叠、超过 wrapThreshold 换子列。
       * 返回换列后的内容高度与总宽度。下方落点循环的换列判定必须与本函数
       * 严格同构，否则 k 选择看到的家族尺寸与实际落点不符。
       */
      const measureSection = (ids: string[]): { h: number; w: number } => {
        const nodeW = sectionWidth(ids)
        let y = 0
        let colStart = 0
        let subCols = 1
        let maxColH = 0
        for (const id of ids) {
          const h = dim(id).height
          if (y > colStart && y - colStart + h > wrapThreshold) {
            maxColH = Math.max(maxColH, y - colStart - gap)
            subCols++
            colStart = y
          }
          y += h + gap
        }
        maxColH = Math.max(maxColH, y - colStart - gap)
        return { h: maxColH, w: nodeW * subCols + gap * (subCols - 1) }
      }

      const totalH =
        sections.reduce((acc, s) => acc + measureSection(s.ids).h, 0) +
        (sections.length - 1) * sectionGap
      const sourceBottom = sources.length > 0 ? sourceY - gap : 0
      const schemaBottom = schemaNodeId
        ? familyPadding + (nodeDimensions.get(schemaNodeId)?.height ?? 0)
        : 0
      const leftBottom = Math.max(sourceBottom, schemaBottom, familyPadding)

      /** 顺序保持贪心装箱：尽量把总高度均分到 k 列（不拆节，保证分组框完整） */
      const buildColumns = (
        k: number
      ): Array<{ sections: RightSection[]; height: number; width: number }> => {
        const target = Math.max(1, totalH / k)
        const cols: Array<{ sections: RightSection[]; height: number; width: number }> = [
          { sections: [], height: 0, width: 0 },
        ]
        for (const s of sections) {
          const { h, w } = measureSection(s.ids)
          const cur = cols[cols.length - 1]
          if (!cur) break
          const mergedH = cur.sections.length === 0 ? h : cur.height + sectionGap + h
          if (cur.sections.length > 0 && mergedH > target && cols.length < k) {
            cols.push({ sections: [s], height: h, width: w })
          } else {
            cur.sections.push(s)
            cur.height = mergedH
            cur.width = Math.max(cur.width, w)
          }
        }
        return cols
      }

      let best: { cols: ReturnType<typeof buildColumns>; zoom: number } | null = null
      const maxCols = Math.min(4, sections.length)
      for (let k = 1; k <= maxCols; k++) {
        const cols = buildColumns(k)
        const contentW = cols.reduce((acc, c, i) => acc + c.width + (i > 0 ? gap : 0), 0)
        const contentH = Math.max(leftBottom - familyPadding, ...cols.map((c) => c.height))
        const famW = rightStartX - familyPadding + contentW + familyPadding * 2
        const famH = contentH + familyPadding * 2
        const zoom = Math.min(availW / famW, availH / famH)
        if (!best || zoom > best.zoom) best = { cols, zoom }
      }

      if (best) {
        let colX = rightStartX
        for (const col of best.cols) {
          const colStartX = colX
          // y = 当前节带顶部；节内换子列时 subX 右移、secY 回到节带顶
          let y = familyPadding
          for (const s of col.sections) {
            const { h } = measureSection(s.ids)
            // 列节行对齐：节带顶向该列在 Schema 中的估算行顶尽力下拉。
            // 只下拉不上提（bandTop ≥ 游标，保证节间不重叠），且下拉量不超过
            // COLUMN_ALIGN_MAX_SLACK_PX——行高估算远小于节高，深列的行顶会
            // 落在游标下方远处，无界下拉会在节间拉开大段空白。
            let bandTop = y
            if (s.alignY !== undefined) {
              bandTop = Math.min(
                Math.max(y, s.alignY),
                y + LAYOUT_CONSTANTS.COLUMN_ALIGN_MAX_SLACK_PX
              )
            }
            let subX = colStartX
            let secY = bandTop
            let secColStartY = secY
            for (const id of s.ids) {
              const d = dim(id)
              if (secY > secColStartY && secY - secColStartY + d.height > wrapThreshold) {
                subX += sectionWidth(s.ids) + gap
                secY = bandTop
                secColStartY = secY
              }
              localPositions.set(id, { x: subX, y: secY })
              secY += d.height + gap
            }
            const bounds = calculateBoundsFromLocal(s.ids, localPositions, nodeDimensions)
            if (bounds) {
              subGroups.push({
                id: `sub-${params.familyId}-${s.nodeType}`,
                name: s.label,
                nodeType: s.nodeType,
                nodeIds: s.ids,
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                color: s.color,
                collapsed: false,
              })
            }
            y = bandTop + h + sectionGap
          }
          colX = colStartX + col.width + gap
        }
      }
    }
  }

  const bounds = calculateBoundsFromLocal(allIds, localPositions, nodeDimensions)
  const width = bounds ? bounds.width + familyPadding * 2 : maxFamilyWidth
  const height = bounds ? bounds.height + familyPadding * 2 : 500

  return {
    localPositions,
    subGroups,
    width: Math.max(width, 500),
    height: Math.max(height, 300),
    color: familyColor,
  }
}
