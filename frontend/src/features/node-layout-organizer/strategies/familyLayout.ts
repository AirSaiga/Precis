/**
 * @file familyLayout.ts
 * @description 家族内部布局辅助函数
 *
 * 功能概述：
 * - 单个 Schema 家族内部的流式布局计算
 * - 节点分类、边界计算、维度回退
 * - 按列对齐约束节点
 */
import type { SubGroup, ConnectionInfo } from '../types'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '../types'
import {
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
  /** 成员节点 → Schema 列序号（越小越靠前）。缺省视为无语义顺序，按 UUID 序兜底 */
  memberSortIndexById?: Map<string, number>
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
    params.memberSortIndexById?.get(id) ?? Number.MAX_SAFE_INTEGER
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

    const constraintGroups = groupByType(constraints, nodeTypeById)
    for (const [type, ids] of constraintGroups) {
      placeSection(ids, NODE_TYPE_NAMES[type] || type, NODE_TYPE_COLORS[type] || '#ccc', type)
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

    const schemaDim = schemaNodeId
      ? nodeDimensions.get(schemaNodeId) || getFallbackDimension('schema')
      : { width: 0, height: 0 }
    const rightStartX = schemaX + schemaDim.width + gap

    // 3. 右侧区块：约束按类型分节，正则与 Others 各成一节。
    //    节与节之间按最小 Schema 列序稳定排序（无列序信息时保持构造顺序，与历史行为一致）
    type RightSection = {
      nodeType: string
      ids: string[]
      label: string
      color: string
      order: number
    }
    const buildSection = (
      nodeType: string,
      ids: string[],
      order: number,
      color?: string
    ): RightSection => ({
      nodeType,
      ids,
      label: NODE_TYPE_NAMES[nodeType] || nodeType,
      color: color || NODE_TYPE_COLORS[nodeType] || '#ccc',
      order,
    })

    const sections: RightSection[] = []
    for (const [type, ids] of groupByType(constraints, nodeTypeById)) {
      sections.push(buildSection(type, ids, Math.min(...ids.map(sortIndexOf))))
    }
    if (regexNodes.length > 0) {
      sections.push(buildSection('regex', regexNodes, Math.min(...regexNodes.map(sortIndexOf))))
    }
    if (others.length > 0) {
      // Others 恒排最后
      sections.push(buildSection('others', others, Number.MAX_SAFE_INTEGER, '#9e9e9e'))
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
            const bandTop = y
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
