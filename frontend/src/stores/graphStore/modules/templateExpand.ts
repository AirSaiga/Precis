/**
 * @file templateExpand.ts
 * @description 模板展开画布渲染模块 — 将 expand API 结果转换为画布上的 DAG 节点和边
 *
 * 架构设计 (5 阶段管线):
 *   Stage 1: collectExpandItems   — 解析 API 结果为 ExpandItem[]
 *   Stage 2: buildDagPlan         — 补全合成节点(transformOutput/manualData)，确定边
 *   Stage 3: computeLayout        — 对所有节点(含合成)做拓扑排序布局
 *   Stage 4: materializeNodes     — DagNode → CustomNode 推入 nodes.value
 *   Stage 5: materializeEdges     — DagEdge → Edge 推入 edges.value
 *
 * 设计原则:
 * - 先确定所有节点，再布局，最后连线
 * - 不允许在边创建阶段插入新节点
 * - 每个阶段只做一件事
 */

import { nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import type { TemplateExpandResult } from '@/api/projectV2Api'
import { getConstraintMetaByKind } from '@/services/constraints/validationRegistry'
import type { ConstraintKind } from '@/services/constraints/types'
import { addNodes, addEdges, removeNodes, removeEdges } from '@/services/canvas/vueFlowApi'

// ============================================================================
// Backend type → Frontend ConstraintKind 映射
// ============================================================================

const V2_TYPE_TO_KIND: Record<string, ConstraintKind | undefined> = {
  Range: 'range',
  Unique: 'unique',
  NotNull: 'notNull',
  AllowedValues: 'allowedValues',
  ForeignKey: 'foreignKey',
  Conditional: 'conditional',
  Scripted: 'scripted',
  Charset: 'charset',
  DateLogic: 'dateLogic',
  Composite: 'composite',
}

// ============================================================================
// 数据结构
// ============================================================================

/** API 返回的单个展开节点（解析后的中间表示） */
interface ExpandItem {
  id: string
  kind: 'transform' | 'constraint' | 'regex'
  type: string
  inputFromNode: string | null
  data: Record<string, unknown>
}

/** DAG 规划节点（含真实节点和合成节点） */
interface DagNode {
  id: string
  /** real = API 返回的后端节点; synthetic = 前端自动生成的 UI 节点 */
  origin: 'real' | 'synthetic'
  kind: 'transform' | 'constraint' | 'regex' | 'transformOutput' | 'manualData'
  /** real 节点的原始 API 数据 */
  item?: ExpandItem
  /** 合成节点的附加数据 */
  syntheticData?: Record<string, unknown>
  /** 是否为画布上已存在的节点（复用时不重新创建） */
  existsOnCanvas?: boolean
  /** Stage 3 填充的布局位置 */
  position?: { x: number; y: number }
}

/** DAG 规划边 */
interface DagEdge {
  sourceId: string
  targetId: string
  sourceHandle?: string
  targetHandle?: string
}

// ============================================================================
// 模块工厂
// ============================================================================

export function createTemplateExpandModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
}) {
  const { nodes, edges, updateNodeData } = params

  // instanceNodeId → [expanded node ids]
  const expandedNodeIds = new Map<string, string[]>()

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  function clearExpansion(instanceNodeId: string) {
    const ids = expandedNodeIds.get(instanceNodeId)
    if (!ids || ids.length === 0) return

    const idSet = new Set(ids)

    const relatedEdges = edges.value.filter(
      (e) => idSet.has(e.source) || idSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }
    removeNodes(ids)

    expandedNodeIds.delete(instanceNodeId)

    // 恢复容器为折叠态
    const instanceNode = nodes.value.find((n) => n.id === instanceNodeId)
    if (instanceNode) {
      nodes.value = nodes.value.map((n) => {
        if (n.id !== instanceNodeId) return n
        return {
          ...n,
          style: {},
          width: undefined,
          height: undefined,
          data: { ...n.data, expanded: false },
        } as CustomNode
      })
    }
  }

  function resetAll() {
    expandedNodeIds.clear()
  }

  function getExpandedIds(instanceNodeId: string): string[] {
    return expandedNodeIds.get(instanceNodeId) || []
  }

  // --------------------------------------------------------------------------
  // Main orchestrator — 5 阶段管线
  // --------------------------------------------------------------------------

  async function expandOnCanvas(instanceNodeId: string, expandResult: TemplateExpandResult) {
    // 0. 清除旧展开
    clearExpansion(instanceNodeId)

    const instanceNode = nodes.value.find((n) => n.id === instanceNodeId)
    if (!instanceNode) return

    // Stage 1: 解析 API 结果
    const items = collectExpandItems(expandResult)
    if (items.length === 0) return

    // Stage 2: 构建 DAG 规划（含合成节点）
    const instanceInputFrom = getInstanceInputFrom(instanceNode)
    const { dagNodes, dagEdges } = buildDagPlan(items, instanceInputFrom)

    // Stage 3: 计算拓扑布局（子节点使用容器内相对坐标）
    const containerSize = computeLayout(dagNodes, dagEdges)

    // Stage 4: 创建节点
    const createdIds = materializeNodes(dagNodes, instanceNodeId)

    // 等待节点渲染，获得 handleBounds 后再创建边
    await nextTick()

    // Stage 5: 创建边 + 回写 inputFromNode
    materializeEdges(dagEdges)

    // 先用估算尺寸设置容器（确保子节点在容器内）
    if (containerSize) {
      nodes.value = nodes.value.map((n) => {
        if (n.id !== instanceNodeId) return n
        return {
          ...n,
          style: {
            width: `${containerSize.width}px`,
            height: `${containerSize.height}px`,
          },
          width: containerSize.width,
          height: containerSize.height,
        } as CustomNode
      })
    }

    // 切换为展开态
    updateNodeData(instanceNodeId, { expanded: true })

    // 追踪并更新 nodeCount
    expandedNodeIds.set(instanceNodeId, createdIds)
    updateNodeData(instanceNodeId, { nodeCount: createdIds.length })

    // 渲染完成后用实际 DOM 尺寸重新计算容器
    adjustContainerToRealDimensions(instanceNodeId, createdIds)
  }

  // --------------------------------------------------------------------------
  // Stage 1: 解析 API 结果
  // --------------------------------------------------------------------------

  function collectExpandItems(result: TemplateExpandResult): ExpandItem[] {
    const items: ExpandItem[] = []

    for (const t of result.transforms) {
      items.push({
        id: t.id as string,
        kind: 'transform',
        type: t.type as string,
        inputFromNode: (t.input_from_node as string) || null,
        data: t,
      })
    }
    for (const c of result.constraints) {
      items.push({
        id: c.id as string,
        kind: 'constraint',
        type: c.type as string,
        inputFromNode: (c.input_from_node as string) || null,
        data: c,
      })
    }
    for (const r of result.regex_nodes) {
      items.push({
        id: r.id as string,
        kind: 'regex',
        type: 'regex',
        inputFromNode: (r.input_from_node as string) || null,
        data: r,
      })
    }

    return items
  }

  // --------------------------------------------------------------------------
  // Stage 2: 构建 DAG 规划
  // --------------------------------------------------------------------------

  /**
   * 将 ExpandItem[] 转换为完整的 DAG 规划：
   * 1. 真实节点 → DagNode
   * 2. 扫描 transform → constraint 连接，插入 transformOutput 合成节点
   * 3. 无外部输入时，插入 manualData 合成节点
   * 4. 生成完整的 DagEdge 列表
   */
  function buildDagPlan(
    items: ExpandItem[],
    instanceInputFrom: string | undefined
  ): { dagNodes: DagNode[]; dagEdges: DagEdge[] } {
    const dagNodes: DagNode[] = []
    const dagEdges: DagEdge[] = []
    const itemIdSet = new Set(items.map((i) => i.id))
    const itemMap = new Map(items.map((i) => [i.id, i]))

    // ---- 2a: 将所有 ExpandItem 转为 DagNode ----
    for (const item of items) {
      dagNodes.push({ id: item.id, origin: 'real', kind: item.kind, item })
    }

    // ---- 2b: 检测需要 transformOutput 的 transform 节点 ----
    // 规则：constraint 的 source 是 transform 时，中间需要 transformOutput
    const transformsNeedingOutput = new Set<string>()
    const transformOutputMap = new Map<string, string>() // transformId → outputNodeId

    for (const item of items) {
      if (item.kind !== 'constraint' || !item.inputFromNode) continue
      if (!itemIdSet.has(item.inputFromNode)) continue // 外部节点跳过

      const sourceItem = itemMap.get(item.inputFromNode)
      if (sourceItem?.kind === 'transform') {
        transformsNeedingOutput.add(item.inputFromNode)
      }
    }

    // ---- 2c: 创建 transformOutput 合成节点 ----
    for (const transformId of transformsNeedingOutput) {
      const transformItem = itemMap.get(transformId)!
      const outputColumns = (transformItem.data.output_columns as string[]) || []

      // 检查画布上是否已有该 transform 的 output 节点（复用场景）
      const existingOutput = nodes.value.find(
        (n) =>
          n.type === 'transformOutput' &&
          (n.data as unknown as Record<string, unknown>)?.parentTransformId === transformId
      )

      const outputNodeId = existingOutput?.id || `output-${transformId}`

      dagNodes.push({
        id: outputNodeId,
        origin: 'synthetic',
        kind: 'transformOutput',
        existsOnCanvas: !!existingOutput,
        syntheticData: {
          parentTransformId: transformId,
          columnName: outputColumns[0] || 'output',
          outputColumns,
        },
      })

      transformOutputMap.set(transformId, outputNodeId)

      // transform → transformOutput 边
      dagEdges.push({
        sourceId: transformId,
        targetId: outputNodeId,
        sourceHandle: 'transform-output',
        targetHandle: 'target-left',
      })
    }

    // ---- 2d: 确定数据源（无外部输入时创建 defaultManualData） ----
    let dataSourceId: string | undefined = instanceInputFrom
    const rootItems = items.filter((i) => !i.inputFromNode)

    if (!dataSourceId && rootItems.length > 0) {
      const firstItem = rootItems[0]
      if (!firstItem) {
        return { dagNodes, dagEdges }
      }
      const manualNodeId = `manual-input-${firstItem.id}`
      dagNodes.push({
        id: manualNodeId,
        origin: 'synthetic',
        kind: 'manualData',
        syntheticData: {
          configName: 'Manual Input',
          columnName: 'Column1',
          rows: [['value1'], ['value2'], ['value3']],
        },
      })
      dataSourceId = manualNodeId
    }

    // ---- 2e: 为每个节点生成边 ----
    for (const item of items) {
      // 解析源节点 ID
      let sourceId: string | undefined

      if (item.inputFromNode) {
        if (itemIdSet.has(item.inputFromNode)) {
          // 源是展开图中的节点
          sourceId = item.inputFromNode
        } else {
          // 源是外部节点，用数据源替代
          sourceId = dataSourceId
        }
      } else {
        // 根节点（无 inputFromNode），用数据源
        sourceId = dataSourceId
      }

      if (!sourceId) continue

      // 确定目标 handle
      const targetHandle = resolveTargetHandle(item)

      // 如果源是 transform 且目标是 constraint，路由经过 transformOutput
      const sourceItem = itemMap.get(sourceId)
      if (sourceItem?.kind === 'transform' && item.kind === 'constraint') {
        const outputNodeId = transformOutputMap.get(sourceId)
        if (outputNodeId) {
          dagEdges.push({
            sourceId: outputNodeId,
            targetId: item.id,
            targetHandle,
          })
          continue
        }
      }

      // 普通边
      dagEdges.push({
        sourceId,
        targetId: item.id,
        targetHandle,
      })
    }

    return { dagNodes, dagEdges }
  }

  /** 根据节点 kind 确定目标 handle */
  function resolveTargetHandle(item: ExpandItem): string | undefined {
    switch (item.kind) {
      case 'transform':
        return 'transform-input'
      case 'regex':
        return 'regex-input'
      case 'constraint':
        return `target-input-${item.id}`
      default:
        return undefined
    }
  }

  // --------------------------------------------------------------------------
  // Stage 3: 拓扑排序布局（子节点使用容器内相对坐标）
  // --------------------------------------------------------------------------

  function computeLayout(
    dagNodes: DagNode[],
    dagEdges: DagEdge[]
  ): { width: number; height: number } | null {
    const nodeIds = new Set(dagNodes.map((n) => n.id))
    const nodeMap = new Map(dagNodes.map((n) => [n.id, n]))

    // 基于 DagEdge 构建入度表（仅统计 DAG 内部边）
    const inDegree = new Map<string, number>()
    const childrenOf = new Map<string, string[]>()

    for (const n of dagNodes) {
      inDegree.set(n.id, 0)
      childrenOf.set(n.id, [])
    }

    for (const edge of dagEdges) {
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) continue
      inDegree.set(edge.targetId, (inDegree.get(edge.targetId) || 0) + 1)
      childrenOf.get(edge.sourceId)!.push(edge.targetId)
    }

    // BFS 拓扑排序 → 计算层级
    const layerMap = new Map<string, number>()
    const queue: string[] = []

    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push(id)
        layerMap.set(id, 0)
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentLayer = layerMap.get(current)!
      for (const child of childrenOf.get(current) || []) {
        const newLayer = currentLayer + 1
        if (!layerMap.has(child) || layerMap.get(child)! < newLayer) {
          layerMap.set(child, newLayer)
        }
        inDegree.set(child, inDegree.get(child)! - 1)
        if (inDegree.get(child) === 0) {
          queue.push(child)
        }
      }
    }

    // 未被拓扑排序覆盖的节点（环路或孤立节点）放到 layer 0
    for (const n of dagNodes) {
      if (!layerMap.has(n.id)) layerMap.set(n.id, 0)
    }

    // 按层级分组
    const layerGroups = new Map<number, DagNode[]>()
    for (const n of dagNodes) {
      const layer = layerMap.get(n.id)!
      if (!layerGroups.has(layer)) layerGroups.set(layer, [])
      layerGroups.get(layer)!.push(n)
    }

    // 计算位置（相对于容器内部，顶部对齐，避免负坐标）
    const CONTAINER_HEADER_HEIGHT = 44
    const CONTAINER_PADDING_LEFT = 50
    const COLUMN_GAP = 400
    const ROW_GAP = 220

    for (const [layerIdx, layerNodes] of layerGroups) {
      const x = CONTAINER_PADDING_LEFT + layerIdx * COLUMN_GAP
      layerNodes.forEach((n, i) => {
        n.position = {
          x,
          y: CONTAINER_HEADER_HEIGHT + 20 + i * ROW_GAP,
        }
      })
    }

    // 用估算尺寸计算初始容器大小（渲染后会用 DOM 实际尺寸修正）
    const positionedNodes = dagNodes.filter((n) => n.position)
    if (positionedNodes.length === 0) return null

    const NODE_ESTIMATED_WIDTH = 360
    const NODE_ESTIMATED_HEIGHT = 200
    const CONTAINER_PADDING_RIGHT = 80
    const CONTAINER_PADDING_BOTTOM = 80

    let maxX = 0
    let maxY = 0
    for (const n of positionedNodes) {
      maxX = Math.max(maxX, n.position!.x + NODE_ESTIMATED_WIDTH)
      maxY = Math.max(maxY, n.position!.y + NODE_ESTIMATED_HEIGHT)
    }

    return {
      width: maxX + CONTAINER_PADDING_RIGHT,
      height: maxY + CONTAINER_PADDING_BOTTOM,
    }
  }

  // --------------------------------------------------------------------------
  // 渲染后 DOM 尺寸修正
  // --------------------------------------------------------------------------

  /**
   * 渲染完成后测量子节点实际 DOM 尺寸，并重新计算容器大小。
   * 初始布局使用估算值，此方法用真实尺寸修正。
   */
  async function adjustContainerToRealDimensions(
    instanceNodeId: string,
    childIds: string[]
  ): Promise<void> {
    // 等待 Vue 渲染 + 浏览器布局
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const instanceNode = nodes.value.find((n) => n.id === instanceNodeId)
    if (!instanceNode) return

    const idSet = new Set(childIds)
    let maxRight = 0
    let maxBottom = 0
    let hasMeasurement = false

    for (const node of nodes.value) {
      if (!idSet.has(node.id)) continue

      // Vue Flow 将 data-id 设置在 .vue-flow__node 包裹节点上
      const el = document.querySelector(`[data-id="${node.id}"]`) as HTMLElement | null
      if (!el) continue

      const w = el.offsetWidth || 360
      const h = el.offsetHeight || 200

      maxRight = Math.max(maxRight, node.position.x + w)
      maxBottom = Math.max(maxBottom, node.position.y + h)
      hasMeasurement = true
    }

    if (!hasMeasurement) return

    const CONTAINER_PADDING_RIGHT = 80
    const CONTAINER_PADDING_BOTTOM = 80
    const width = maxRight + CONTAINER_PADDING_RIGHT
    const height = maxBottom + CONTAINER_PADDING_BOTTOM

    nodes.value = nodes.value.map((n) => {
      if (n.id !== instanceNodeId) return n
      return {
        ...n,
        style: {
          width: `${width}px`,
          height: `${height}px`,
        },
        width,
        height,
      } as CustomNode
    })
  }

  // --------------------------------------------------------------------------
  // Stage 4: 创建节点
  // --------------------------------------------------------------------------

  function materializeNodes(dagNodes: DagNode[], instanceNodeId: string): string[] {
    const createdIds: string[] = []

    for (const dagNode of dagNodes) {
      // 复用的已有节点：不推入，但追踪 ID
      if (dagNode.existsOnCanvas) {
        createdIds.push(dagNode.id)
        continue
      }

      const pos = dagNode.position || { x: 0, y: 0 }
      const nodeBuild = buildCustomNode(dagNode, instanceNodeId)
      if (!nodeBuild) continue

      const newNode: CustomNode = {
        id: dagNode.id,
        type: nodeBuild.type,
        position: pos,
        parentNode: instanceNodeId,
        extent: 'parent',
        data: nodeBuild.data as unknown as CustomNodeData,
      }

      addNodes(newNode)
      createdIds.push(dagNode.id)
    }

    return createdIds
  }

  /** 根据 DagNode 构建 CustomNode 的 type + data */
  function buildCustomNode(
    dagNode: DagNode,
    instanceNodeId: string
  ): { type: string; data: Record<string, unknown> } | null {
    switch (dagNode.kind) {
      case 'transform':
        return buildTransformData(dagNode.item!, instanceNodeId)
      case 'constraint':
        return buildConstraintNodeData(dagNode.item!, instanceNodeId)
      case 'regex':
        return buildRegexData(dagNode.item!, instanceNodeId)
      case 'transformOutput':
        return buildTransformOutputData(dagNode)
      case 'manualData':
        return buildManualDataData(dagNode)
      default:
        return null
    }
  }

  // --------------------------------------------------------------------------
  // Stage 5: 创建边
  // --------------------------------------------------------------------------

  function materializeEdges(dagEdges: DagEdge[]): void {
    const newEdges: Edge[] = []

    for (const dagEdge of dagEdges) {
      newEdges.push({
        id: `e-expand-${dagEdge.sourceId}-${dagEdge.targetId}`,
        source: dagEdge.sourceId,
        target: dagEdge.targetId,
        sourceHandle: dagEdge.sourceHandle,
        targetHandle: dagEdge.targetHandle,
      })

      const targetNode = nodes.value.find((n) => n.id === dagEdge.targetId)
      if (targetNode) {
        updateNodeData(dagEdge.targetId, {
          ...targetNode.data,
          inputFromNode: dagEdge.sourceId,
        })
      }
    }

    if (newEdges.length > 0) {
      addEdges(newEdges)
    }
  }

  // --------------------------------------------------------------------------
  // Node data builders
  // --------------------------------------------------------------------------

  function buildTransformData(
    item: ExpandItem,
    instanceNodeId: string
  ): { type: string; data: Record<string, unknown> } {
    return {
      type: 'transform',
      data: {
        configName: (item.data.description as string) || item.id,
        transformType: item.type,
        description: item.data.description,
        inputFromNode: undefined,
        inputColumn: item.data.input_column || undefined,
        params: (item.data.params || {}) as Record<string, unknown>,
        outputColumns: item.data.output_columns || [],
        enabled: true,
        saveState: 'draft',
        _expandedFromInstanceId: instanceNodeId,
      },
    }
  }

  function buildConstraintNodeData(
    item: ExpandItem,
    instanceNodeId: string
  ): { type: string; data: Record<string, unknown> } | null {
    const kind = V2_TYPE_TO_KIND[item.type]
    if (!kind) return null
    const meta = getConstraintMetaByKind(kind)
    if (!meta) return null

    const refs = (item.data.refs || {}) as Record<string, unknown>
    const params = (item.data.params || {}) as Record<string, unknown>

    const tableId = refs.table_id || refs.tableId || ''
    const columnId = refs.column_id || refs.columnId || ''
    const columnIds = refs.column_ids || refs.columnIds

    const base: Record<string, unknown> = {
      configName: (item.data.description as string) || item.id,
      constraintName: item.id,
      saveState: 'draft',
      _expandedFromInstanceId: instanceNodeId,
      table: tableId,
    }

    switch (kind) {
      case 'notNull':
        base.column = columnId
        break

      case 'unique':
        base.column = columnIds || columnId
        break

      case 'allowedValues':
        base.column = columnId
        base.allowedValues = params.allowed_values || []
        break

      case 'foreignKey':
        base.sourceTable = refs.from_table_id || ''
        base.sourceColumn = refs.from_column_id || ''
        base.targetTable = refs.to_table_id || ''
        base.targetColumn = refs.to_column_id || ''
        break

      case 'range':
        base.column = columnId
        base.minValue = params.min ?? 0
        base.maxValue = params.max ?? 100
        base.boundaryMode = params.boundary_mode || 'inclusive'
        break

      case 'conditional':
        base.ifColumn = refs.if_column_id || ''
        base.ifValue = ''
        base.ifConditions = params.if_conditions || []
        base.ifLogic = refs.if_logic || 'and'
        base.thenColumn = refs.then_column_id || ''
        break

      case 'scripted':
        base.column = columnId
        base.expression = params.expression || ''
        break

      case 'charset':
        base.column = columnId
        base.charsetMode = params.charset_mode || 'ascii'
        break

      case 'dateLogic':
        base.column = columnId
        base.logicMode = params.logic_mode || 'compare'
        break

      case 'composite':
        base.subGraph = { nodes: [], edges: [] }
        break
    }

    return { type: meta.nodeType, data: base }
  }

  function buildRegexData(
    item: ExpandItem,
    instanceNodeId: string
  ): { type: string; data: Record<string, unknown> } {
    return {
      type: 'regex',
      data: {
        configName: (item.data.name as string) || item.id,
        name: (item.data.name as string) || item.id,
        pattern: item.data.pattern || '',
        description: item.data.description || '',
        matchMode: item.data.match_mode || 'full',
        caseSensitive: item.data.case_sensitive !== false,
        enabled: true,
        saveState: 'draft',
        parameters: item.data.parameters || undefined,
        _expandedFromInstanceId: instanceNodeId,
      },
    }
  }

  function buildTransformOutputData(
    dagNode: DagNode
  ): { type: string; data: Record<string, unknown> } {
    const sd = dagNode.syntheticData || {}
    return {
      type: 'transformOutput',
      data: {
        configName: (sd.columnName as string) || 'output',
        columnName: (sd.columnName as string) || 'output',
        rows: [],
        parentTransformId: sd.parentTransformId || '',
        saveState: 'draft',
      },
    }
  }

  function buildManualDataData(
    dagNode: DagNode
  ): { type: string; data: Record<string, unknown> } {
    const sd = dagNode.syntheticData || {}
    return {
      type: 'manualData',
      data: {
        configName: (sd.configName as string) || 'Manual Input',
        columnName: (sd.columnName as string) || 'Column1',
        rows: (sd.rows as string[][]) || [['value1'], ['value2'], ['value3']],
        saveState: 'draft',
      },
    }
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /** 从实例节点 data 中提取 inputFromNode */
  function getInstanceInputFrom(instanceNode: CustomNode): string | undefined {
    return (instanceNode.data as unknown as Record<string, unknown>).inputFromNode as
      | string
      | undefined
  }

  // --------------------------------------------------------------------------
  // Collapse / toggle expansion
  // --------------------------------------------------------------------------

  /**
   * 折叠容器：隐藏子节点并恢复紧凑尺寸
   * 不删除子节点，以便再次展开时无需重新调用 API
   */
  function collapseExpansion(instanceNodeId: string) {
    const ids = expandedNodeIds.get(instanceNodeId)
    const idSet = ids && ids.length > 0 ? new Set(ids) : new Set<string>()

    nodes.value = nodes.value.map((n) => {
      if (idSet.has(n.id)) {
        return { ...n, hidden: true } as CustomNode
      }
      if (n.id === instanceNodeId) {
        return {
          ...n,
          style: {},
          width: undefined,
          height: undefined,
          data: { ...n.data, expanded: false },
        } as CustomNode
      }
      return n
    })
  }

  /**
   * 再次展开容器：显示已有子节点并恢复容器尺寸
   * 仅在子节点已存在时有效（之前已展开过）
   */
  function reExpand(instanceNodeId: string) {
    const ids = expandedNodeIds.get(instanceNodeId)
    if (!ids || ids.length === 0) return false

    const idSet = new Set(ids)

    nodes.value = nodes.value.map((n) => {
      if (idSet.has(n.id)) {
        return { ...n, hidden: false } as CustomNode
      }
      return n
    })

    updateNodeData(instanceNodeId, { expanded: true })

    // 用 DOM 实际尺寸设置容器（子节点显示后才能测量）
    adjustContainerToRealDimensions(instanceNodeId, ids)
    return true
  }

  // --------------------------------------------------------------------------
  // Module API
  // --------------------------------------------------------------------------

  return {
    expandOnCanvas,
    clearExpansion,
    collapseExpansion,
    reExpand,
    resetAll,
    getExpandedIds,
  }
}
