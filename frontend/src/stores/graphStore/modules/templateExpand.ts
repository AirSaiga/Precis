/**
 * @file templateExpand.ts
 * @description 模板展开画布渲染模块 — 将 expand API 结果转换为画布上的 DAG 节点和边
 *
 * 架构设计 (6 阶段管线):
 *   Stage 1: collectExpandItems     — 解析 API 结果为 ExpandItem[]
 *   Stage 2: buildDagPlan           — 补全合成节点(transformOutput/manualData)，确定边
 *   Stage 3: computeLayout          — 对所有节点(含合成)做拓扑排序布局
 *   Stage 4: materializeNodes       — DagNode → CustomNode 推入 nodes.value
 *   Stage 5: materializeEdges       — DagEdge → Edge 推入 edges.value
 *   Stage 6: executePostExpandHooks — 调用已注册的 type-agnostic 后置钩子
 *                                     （Transform 计算、约束校验、关系同步等）
 *
 * Stage 6 的具体逻辑由 `services/templateExpand/registryHandlers/*` 通过
 * `registerTemplateExpandHandler` 自注册，模板展开模块本身不感知节点类型。
 * 新增节点类型只需新增一个 handler 文件，无需修改本模块。
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
import {
  getConstraintKindByV2Type,
  getConstraintMetaByKind,
} from '@/services/constraints/validationRegistry'
import {
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  updateNode,
} from '@/services/canvas/vueFlowApi'
import { executeTemplateExpandHooks, resetRelationshipSyncRound } from '@/services/templateExpand'
// ============================================================================
// 数据结构
// ============================================================================

/** API 返回的单个展开节点（解析后的中间表示） */
interface ExpandItem {
  id: string
  kind: 'transform' | 'constraint' | 'regex' | 'manualData'
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
  /**
   * 重建 parent/children/outputPortConnected 关系。
   * 模板展开不走 useConnections.onConnect，需要手动调用 reconcileAll。
   * 由 registryHandlers/relationshipSync.ts 在 Stage 6 中通过 ctx 间接调用。
   */
  reconcileAll?: () => Promise<void>
}) {
  const { nodes, edges, updateNodeData, reconcileAll } = params

  // instanceNodeId → [expanded node ids]
  const expandedNodeIds = new Map<string, string[]>()

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async function clearExpansion(instanceNodeId: string) {
    const ids = expandedNodeIds.get(instanceNodeId)
    if (!ids || ids.length === 0) return

    const idSet = new Set(ids)

    const relatedEdges = edges.value.filter((e) => idSet.has(e.source) || idSet.has(e.target))
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }
    removeNodes(ids)

    expandedNodeIds.delete(instanceNodeId)

    // 关键：等 removeNodes 触发的 Vue Flow v-model 回写完成（v-model:nodes 双向绑定在 nextTick 后回写到 store ref），
    // 再更新容器，否则紧接着的 map 会把刚删的子节点重新写回 nodes.value，
    // Vue Flow setNodes 可能拒绝执行 remove。
    await nextTick()

    // 容器恢复折叠态：统一走 updateNodeData 入口，保证 saveState 同步
    updateNodeData(instanceNodeId, { expanded: false } as Partial<CustomNodeData>)

    // B36 修复：style/width/height 走 vueFlowApi.updateNode，避免全量数组替换
    updateNode(instanceNodeId, {
      style: {},
      width: undefined,
      height: undefined,
    })
  }

  function resetAll() {
    expandedNodeIds.clear()
  }

  function getExpandedIds(instanceNodeId: string): string[] {
    return expandedNodeIds.get(instanceNodeId) || []
  }

  // --------------------------------------------------------------------------
  // Main orchestrator — 6 阶段管线
  // --------------------------------------------------------------------------

  async function expandOnCanvas(instanceNodeId: string, expandResult: TemplateExpandResult) {
    // 0. 清除旧展开
    await clearExpansion(instanceNodeId)

    const instanceNode = nodes.value.find((n) => n.id === instanceNodeId)
    if (!instanceNode) return

    // Stage 1: 解析 API 结果
    const items = collectExpandItems(expandResult)
    if (items.length === 0) return

    // Stage 2: 构建 DAG 规划（含合成节点）
    const { dagNodes, dagEdges } = buildDagPlan(items)

    // Stage 3: 计算拓扑布局（子节点使用容器内相对坐标）
    const containerSize = computeLayout(dagNodes, dagEdges)

    // Stage 4: 创建节点
    const createdIds = materializeNodes(dagNodes, instanceNodeId)

    // 等待节点渲染，获得 handleBounds 后再创建边
    await nextTick()

    // Stage 5: 创建边 + 回写 inputFromNode
    materializeEdges(dagEdges, dagNodes)

    // 等待 Vue Flow 完成 handle 注册（边路径计算依赖）
    await nextTick()

    // Stage 6: 调用已注册的后置钩子（type-agnostic，自动执行子节点逻辑）
    //   - Transform 计算、约束校验、关系同步等
    //   - 由 services/templateExpand/registryHandlers/* 通过自注册提供
    //   - 新增节点类型只需新增 handler，无需修改本模块
    resetRelationshipSyncRound()
    await executeTemplateExpandHooks(dagNodes, {
      nodes,
      edges,
      updateNodeData,
      reconcileAll,
    })

    // 先用估算尺寸设置容器（确保子节点在容器内）
    // B36 修复：走 vueFlowApi.updateNode 而非全量数组替换，保持 saveState/撤销历史一致
    if (containerSize) {
      updateNode(instanceNodeId, {
        style: {
          width: `${containerSize.width}px`,
          height: `${containerSize.height}px`,
        },
        width: containerSize.width,
        height: containerSize.height,
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
    for (const md of result.manual_data) {
      items.push({
        id: md.id as string,
        kind: 'manualData',
        type: 'ManualData',
        inputFromNode: (md.input_from_node as string) || null,
        data: md,
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
  function buildDagPlan(items: ExpandItem[]): { dagNodes: DagNode[]; dagEdges: DagEdge[] } {
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
    const transformOutputMap = new Map<string, string[]>() // transformId → 每列的 outputNodeId[]

    for (const item of items) {
      if (item.kind !== 'constraint' || !item.inputFromNode) continue
      if (!itemIdSet.has(item.inputFromNode)) continue // 外部节点跳过

      const sourceItem = itemMap.get(item.inputFromNode)
      if (sourceItem?.kind === 'transform') {
        transformsNeedingOutput.add(item.inputFromNode)
      }
    }

    // ---- 2c: 创建 transformOutput 合成节点（每列一个）----
    // 多列 transform（StringSplit/RegexExtract）会产出 N 列，需为每列创建独立 output 节点，
    // 否则只有首列数据能被后续约束消费，其余列被静默丢弃。
    for (const transformId of transformsNeedingOutput) {
      const transformItem = itemMap.get(transformId)!
      const outputColumns = (transformItem.data.output_columns as string[]) || []
      // 列名列表（空数组时退化为单节点，保持向后兼容）
      const colNames = outputColumns.length > 0 ? outputColumns : ['output']

      // 检查画布上是否已有该 transform 的 output 节点（复用场景，按列名匹配）
      const existingOutputs = nodes.value.filter(
        (n) =>
          n.type === 'transformOutput' &&
          (n.data as unknown as Record<string, unknown>)?.parentTransformId === transformId
      )
      const existingByColName = new Map(
        existingOutputs.map((n) => [
          (n.data as unknown as Record<string, unknown>)?.columnName as string | undefined,
          n,
        ])
      )

      const outputNodeIds: string[] = []
      colNames.forEach((colName, i) => {
        const existing = existingByColName.get(colName)
        const outputNodeId = existing?.id || `output-${transformId}-${i}`

        dagNodes.push({
          id: outputNodeId,
          origin: 'synthetic',
          kind: 'transformOutput',
          existsOnCanvas: !!existing,
          syntheticData: {
            parentTransformId: transformId,
            columnName: colName,
            outputColumnIndex: i,
          },
        })

        outputNodeIds.push(outputNodeId)

        // transform → transformOutput 边（每列一条）
        dagEdges.push({
          sourceId: transformId,
          targetId: outputNodeId,
          sourceHandle: 'transform-output',
          targetHandle: 'target-left',
        })
      })

      transformOutputMap.set(transformId, outputNodeIds)
    }

    // ---- 2d: 实例自包含，无外部数据源 ----
    // manualData 节点是模板自带的输入起点，不需要外部数据源。
    // 只有非 manualData 的根节点需要数据源，但实例自包含后不再有外部输入。

    // ---- 2e: 为每个节点生成边 ----
    for (const item of items) {
      // manualData 是 DAG 起点，不需要入边
      if (item.kind === 'manualData') continue

      // 解析源节点 ID
      let sourceId: string | undefined

      if (item.inputFromNode) {
        if (itemIdSet.has(item.inputFromNode)) {
          // 源是展开图中的节点
          sourceId = item.inputFromNode
        } else {
          // 源是外部节点（保留向后兼容，但实例自包含后通常不会出现）
          sourceId = undefined
        }
      } else {
        // 根节点（无 inputFromNode），实例自包含后无外部数据源
        sourceId = undefined
      }

      if (!sourceId) continue

      // 确定目标 handle
      const targetHandle = resolveTargetHandle(item)

      // 如果源是 transform 且目标是 constraint，路由经过 transformOutput
      const sourceItem = itemMap.get(sourceId)
      if (sourceItem?.kind === 'transform' && item.kind === 'constraint') {
        const outputNodeIds = transformOutputMap.get(sourceId) || []
        if (outputNodeIds.length > 0) {
          // 多列 transform：按约束声明的 input_column 路由到对应列的 output 节点。
          // 未声明或不匹配时回退到首列（保持向后兼容）。
          const outputColumns = (sourceItem.data.output_columns as string[]) || []
          const inputColumn = (item.data.input_column as string) || ''
          const colIndex = inputColumn ? outputColumns.indexOf(inputColumn) : 0
          const targetOutputId = outputNodeIds[colIndex >= 0 ? colIndex : 0]
          if (targetOutputId) {
            dagEdges.push({
              sourceId: targetOutputId,
              targetId: item.id,
              targetHandle,
            })
            continue
          }
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

    // B36 修复：走 vueFlowApi.updateNode 而非全量数组替换
    updateNode(instanceNodeId, {
      style: {
        width: `${width}px`,
        height: `${height}px`,
      },
      width,
      height,
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

  function materializeEdges(dagEdges: DagEdge[], dagNodes: DagNode[]): void {
    const newEdges: Edge[] = []
    const dagNodeMap = new Map(dagNodes.map((n) => [n.id, n]))

    for (const dagEdge of dagEdges) {
      const sourceNode = nodes.value.find((n) => n.id === dagEdge.sourceId)
      const dagTarget = dagNodeMap.get(dagEdge.targetId)

      // 从 DAG 规划中补全 schema → constraint 边的 sourceHandle
      // 使验证上下文能正确识别目标列
      let sourceHandle = dagEdge.sourceHandle
      if (
        !sourceHandle &&
        (sourceNode?.type === 'schema' || sourceNode?.type === 'jsonSchema') &&
        dagTarget?.kind === 'constraint'
      ) {
        const refs = (dagTarget.item?.data.refs || {}) as Record<string, unknown>
        const inputColumn = (dagTarget.item?.data.input_column as string) || ''
        const columnId =
          (refs.column_id as string) || (refs.column_ids as string[])?.[0] || inputColumn
        if (columnId) {
          sourceHandle = `source-right-${columnId}`
        }
      }

      newEdges.push({
        id: `e-expand-${dagEdge.sourceId}-${dagEdge.targetId}`,
        source: dagEdge.sourceId,
        target: dagEdge.targetId,
        sourceHandle,
        targetHandle: dagEdge.targetHandle,
      })

      // 回写 inputFromNode 到目标节点，使保存时 input_from_node 字段正确序列化。
      // dagEdge.sourceId 可能是合成 transformOutput 节点（当 transform→constraint 路由经过时），
      // 只有此处知道实际边源 ID，因此必须在此回写。
      updateNodeData(dagEdge.targetId, {
        inputFromNode: dagEdge.sourceId,
      } as Partial<CustomNodeData>)
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
    const kind = getConstraintKindByV2Type(item.type)
    if (!kind) return null
    const meta = getConstraintMetaByKind(kind)
    if (!meta) return null

    const refs = (item.data.refs || {}) as Record<string, unknown>
    const params = (item.data.params || {}) as Record<string, unknown>

    const tableId = refs.table_id || refs.tableId || ''
    const columnId = refs.column_id || refs.columnId || ''
    const columnIds = refs.column_ids || refs.columnIds
    const inputColumn = (item.data.input_column as string) || ''

    // 兼容仅通过 input_column 指定目标列的模板
    const effectiveColumnId = columnId || inputColumn
    const effectiveColumnIds = Array.isArray(columnIds) ? columnIds : []

    const base: Record<string, unknown> = {
      configName: (item.data.description as string) || item.id,
      constraintName: item.id,
      saveState: 'draft',
      _expandedFromInstanceId: instanceNodeId,
      table: tableId,
      // inputColumn 用于 inline 数据源场景（manualData / transformOutput），
      // 明确告诉行内校验应该以哪一列作为目标列。
      inputColumn: effectiveColumnId || effectiveColumnIds[0] || undefined,
    }

    // 写入 sourceRef，使单约束校验和重验能定位到源节点/列
    if (tableId && (effectiveColumnId || effectiveColumnIds.length > 0)) {
      base.sourceRef = {
        nodeId: tableId,
        columnId: effectiveColumnId || effectiveColumnIds[0],
      }
    }

    switch (kind) {
      case 'notNull':
        base.column = effectiveColumnId
        break

      case 'unique':
        base.column = effectiveColumnIds.length > 0 ? effectiveColumnIds : effectiveColumnId
        break

      case 'allowedValues':
        base.column = effectiveColumnId
        base.allowedValues = params.allowed_values || []
        break

      case 'foreignKey':
        base.sourceTable = refs.from_table_id || ''
        base.sourceColumn = refs.from_column_id || ''
        base.targetTable = refs.to_table_id || ''
        base.targetColumn = refs.to_column_id || ''
        if (base.sourceTable && base.sourceColumn) {
          base.sourceRef = {
            nodeId: base.sourceTable as string,
            columnId: base.sourceColumn as string,
          }
        }
        break

      case 'range':
        base.column = effectiveColumnId
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
        base.column = effectiveColumnId
        base.expression = params.expression || ''
        break

      case 'charset':
        base.column = effectiveColumnId
        base.charsetMode = params.charset_mode || 'ascii'
        break

      case 'dateLogic':
        base.column = effectiveColumnId
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

  function buildTransformOutputData(dagNode: DagNode): {
    type: string
    data: Record<string, unknown>
  } {
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

  function buildManualDataData(dagNode: DagNode): { type: string; data: Record<string, unknown> } {
    // real origin: 从模板展开结果中读取数据
    if (dagNode.item) {
      const d = dagNode.item.data
      return {
        type: 'manualData',
        data: {
          configName: (d.column_name as string) || 'Column1',
          columnName: (d.column_name as string) || 'Column1',
          columnDataType: (d.column_data_type as string) || 'string',
          rows: (d.rows as string[][]) || [],
          saveState: 'draft',
          _expandedFromInstanceId: undefined,
        },
      }
    }
    // synthetic origin（向后兼容）
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
  // Collapse / toggle expansion
  // --------------------------------------------------------------------------

  /**
   * 折叠容器：隐藏子节点并恢复紧凑尺寸
   * 不删除子节点，以便再次展开时无需重新调用 API
   */
  function collapseExpansion(instanceNodeId: string) {
    const ids = expandedNodeIds.get(instanceNodeId)
    const idSet = ids && ids.length > 0 ? new Set(ids) : new Set<string>()

    // B36 修复：拆分为逐个 updateNode 调用，走 vueFlowApi 统一入口
    // 过去用 nodes.value.map 全量替换，绕过 Vue Flow hooks 导致 saveState/状态不同步
    for (const n of nodes.value) {
      if (idSet.has(n.id)) {
        updateNode(n.id, { hidden: true })
      } else if (n.id === instanceNodeId) {
        updateNode(instanceNodeId, {
          style: {},
          width: undefined,
          height: undefined,
          data: { ...n.data, expanded: false } as CustomNodeData,
        })
      }
    }
  }

  /**
   * 再次展开容器：显示已有子节点并恢复容器尺寸
   * 仅在子节点已存在时有效（之前已展开过）
   */
  function reExpand(instanceNodeId: string) {
    const ids = expandedNodeIds.get(instanceNodeId)
    if (!ids || ids.length === 0) return false

    const idSet = new Set(ids)

    // B36 修复：逐个 updateNode 取消隐藏，避免全量数组替换
    for (const n of nodes.value) {
      if (idSet.has(n.id)) {
        updateNode(n.id, { hidden: false })
      }
    }

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
