/**
 * @file importV2ResourceToCanvas.ts
 * @description V2 资源导入画布协调器
 *
 * 负责将后端 V2 项目配置完整导入到画布，是项目加载流程的核心 orchestrator。
 * 协调 schema、constraint、regex 三类资源的水合和导入。
 *
 * 功能概述：
 * - createV2ImportToCanvas: 工厂函数，创建导入器实例
 * - importProjectFromV2Config: 主入口，加载 FullConfigV2 并导入画布
 * - 分阶段导入：Schema → Constraint → Regex，确保依赖顺序正确
 * - 错误处理：加载失败时显示 Toast 错误提示
 * - 支持增量导入：避免重复创建已存在的节点
 *
 * 架构设计：
 * - 工厂模式：createV2ImportToCanvas 返回一组导入方法
 * - 依赖注入：接收 nodes / edges / selectedNodeId 等状态引用
 * - 子模块分工：schema/constraint/regex/edges 各有一个独立导入器
 * - 通过 getV2FullConfig 从后端获取完整配置
 */

import { logger } from '@/core/utils/logger'
import { nextTick } from 'vue'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, TransformNodeData } from '@/types/graph'
import { useI18n } from 'vue-i18n'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { toastError, toastWarning } from '@/core/toast'
import { createV2ImportEdges } from './edges'
import { createV2SchemaImporter } from './schema'
import { createV2RegexImporter } from './regex'
import { createV2ConstraintImporter } from './constraint'
import { getV2FullConfig } from '@/api/projectV2Api'
import type { PatternRegistryTypeV2 } from '@/types/projectV2'
import { addNodes, updateNode } from '@/services/canvas/vueFlowApi'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import {
  computeClearanceShift,
  computeItemsBounds,
  layoutBatchAsColumn,
  type PlacedItem,
  type RectBounds,
} from '@/features/node-layout-organizer/utils/batchPlacement'
import { getDefaultDimension } from '@/features/node-layout-organizer/utils/nodeDimensionHelper'
export type ProjectResourceKind =
  | 'schema'
  | 'constraint'
  | 'regex'
  | 'pattern'
  | 'regex_node'
  | 'transform'

/** 批量导入约束列相对 Schema 落点的水平偏移（沿用既有 +420 视觉惯例） */
const IMPORT_COLUMN_OFFSET_X = 420

/** 约束列的行间距（约束节点高约 100 + 60 间距 ≈ 原导入列 160 步进） */
const IMPORT_COLUMN_ROW_GAP = 60

/** 导入批次与既有节点保持的最小净空距离 */
const IMPORT_CLEARANCE_GAP = 40

/**
 * 批量导入后的约束批次列式重排（修复：导入约束列压盖既有节点，如项目根节点）。
 *
 * 对"本次导入新增的约束类节点"（内嵌物化 + 连带独立约束）统一按列式布局：
 * - 锚点取 Schema 落点右侧 +420（保持与用户落点的相对关系）
 * - 计算批次包围盒与"非批次节点"包围盒的碰撞，必要时整体平移到净空区
 * - 位置经 vueFlowApi.updateNode 增量应用，不直接改 node.position
 *
 * 只影响当次导入批次，用户既有布局不动。
 */
function relayoutImportedConstraintBatch(
  nodes: Ref<CustomNode[]>,
  preImportNodeIds: ReadonlySet<string>,
  anchorPosition: { x: number; y: number }
): void {
  const batch = nodes.value.filter(
    (n) => !preImportNodeIds.has(n.id) && isConstraintNodeType(n.type ?? '')
  )
  if (batch.length === 0) return

  const dimById = new Map<string, { width: number; height: number }>()
  const items = batch.map((n) => {
    const dim = getDefaultDimension(n.type ?? '')
    dimById.set(n.id, dim)
    return { id: n.id, width: dim.width, height: dim.height }
  })

  const origin = { x: anchorPosition.x + IMPORT_COLUMN_OFFSET_X, y: anchorPosition.y }
  const positions = layoutBatchAsColumn(items, origin, IMPORT_COLUMN_ROW_GAP)

  // 避开"非批次节点"（既有节点 + 本次新建的 Schema 等非约束节点）的包围盒
  const obstacleNodes = nodes.value.filter((n) => !positions.has(n.id))
  const obstacles: RectBounds[] = obstacleNodes.map((n) => {
    const dim = getDefaultDimension(n.type ?? '')
    return {
      minX: n.position.x,
      minY: n.position.y,
      maxX: n.position.x + dim.width,
      maxY: n.position.y + dim.height,
    }
  })

  const placedItems: PlacedItem[] = []
  for (const n of batch) {
    const pos = positions.get(n.id)
    const dim = dimById.get(n.id)
    if (pos && dim) placedItems.push({ position: pos, width: dim.width, height: dim.height })
  }
  const block = computeItemsBounds(placedItems)
  if (block) {
    const { dx, dy } = computeClearanceShift(block, obstacles, IMPORT_CLEARANCE_GAP)
    if (dx !== 0 || dy !== 0) {
      for (const [id, pos] of positions) {
        positions.set(id, { x: pos.x + dx, y: pos.y + dy })
      }
      logger.debug('[importV2ResourceToCanvas] 批量导入批次平移避让:', {
        dx,
        dy,
        count: batch.length,
      })
    }
  }

  for (const [id, pos] of positions) {
    updateNode(id, { position: { x: pos.x, y: pos.y } })
  }
}

export function createV2ImportToCanvas(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  reconcileAll: () => void | Promise<void>
  /**
   * 查询引用指定 Schema 的独立约束 ID 列表。
   * 用于拖拽独立约束触发自动创建 Schema 时，连带创建该 Schema 关联的其他独立约束。
   * 返回 undefined 表示无法查询（如 resourceTreeStore 未初始化），此时跳过连带创建。
   */
  getIndependentConstraintIdsForSchema?: (schemaId: string) => string[] | undefined
  sourceIndex?: {
    isDuplicateSource: (
      path: string,
      sheet: string | null | undefined,
      excludeNodeId?: string
    ) => boolean
    getConflictForSource: (
      path: string,
      sheet: string | null | undefined,
      excludeNodeId?: string
    ) => { nodeIds: string[] } | null
    rebuild: () => void
  }
  /** 导入前压入撤销快照（可选，历史模块注入） */
  saveState?: () => void
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    reconcileAll,
    getIndependentConstraintIdsForSchema,
    sourceIndex,
    saveState,
  } = params
  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()

  const {
    ensureSchemaToRegexEdge,
    ensureSchemaToRegexExtractEdge,
    ensureSchemaToConstraintEdge,
    bufferEdge,
    flushBufferedEdges,
  } = createV2ImportEdges({ edges })

  // 延迟绑定 importConstraint，解决 schema importer ↔ constraint importer 的循环依赖：
  // createV2SchemaImporter 需要在新建 Schema 时连带创建引用它的独立约束（调用 importConstraint），
  // 但 importConstraint 依赖 ensureSchemaNode（来自 schema importer），二者互相引用。
  // 通过 getImportConstraint 闭包在运行时获取最新的 importConstraint 引用，
  // 此时它已在下方 createV2ConstraintImporter 中完成赋值。
  let importConstraintFn:
    | ((
        resourceId: string,
        position: { x: number; y: number },
        options?: { includeDeps?: boolean; moveIfExists?: boolean }
      ) => Promise<string>)
    | null = null
  const getImportConstraint = () => importConstraintFn

  /**
   * 连带创建引用指定 Schema 的其他独立约束。
   *
   * 调用时机：拖拽独立约束 A 触发 ensureSchemaNode 新建 Schema 时，
   * 补齐该 Schema 关联的其他独立约束（排除 A 自身），使自动创建的 Schema 内容完整。
   *
   * 布局：连带约束围绕 Schema 右侧错落排列，沿用内嵌约束的 idx*160 y 偏移模式。
   */
  const importRelatedIndependentConstraints = async (
    tableId: string,
    excludeConstraintId: string,
    schemaPosition: { x: number; y: number }
  ): Promise<void> => {
    const importConstraint = getImportConstraint()
    if (!importConstraint || !getIndependentConstraintIdsForSchema) return

    const relatedIds = getIndependentConstraintIdsForSchema(tableId)
    if (!relatedIds || relatedIds.length === 0) return

    // 逐个导入引用该 Schema 的独立约束（排除被拖拽约束自身）
    // importConstraint 内部是幂等的，重复拖拽时已存在的节点会被跳过
    let idx = 0
    for (const cId of relatedIds) {
      if (!cId || cId === excludeConstraintId) continue
      // 排除画布上已存在的约束，避免重复导入
      if (nodes.value.some((n) => n.id === cId)) continue
      const cPosition = { x: schemaPosition.x + 420, y: schemaPosition.y + idx * 160 }
      // includeDeps=false：连带创建的约束不再触发其依赖 Schema 的连带创建，
      // 避免雪崩（其依赖的 Schema 即当前 tableId，已存在会直接返回）
      await importConstraint(cId, cPosition, { includeDeps: false, moveIfExists: false })
      idx++
    }
  }

  const { ensureSchemaNode, importSchema } = createV2SchemaImporter({
    nodes,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    ensureSchemaToConstraintEdge,
    importRelatedIndependentConstraints,
  })
  const { importRegex } = createV2RegexImporter({
    nodes,
    selectedNodeId,
    ensureSchemaNode,
    ensureSchemaToRegexEdge,
    ensureSchemaToRegexExtractEdge,
  })
  const { importConstraint } = createV2ConstraintImporter({
    nodes,
    edges,
    selectedNodeId,
    ensureSchemaNode,
    ensureSchemaToConstraintEdge,
    bufferEdge,
  })
  // 完成延迟绑定：供 schema importer 的连带创建逻辑使用
  importConstraintFn = importConstraint

  async function importV2ResourceToCanvas(
    kind: ProjectResourceKind,
    resourceId: string,
    position: { x: number; y: number },
    options?: { includeDeps?: boolean; moveIfExists?: boolean; skipRelatedConstraints?: boolean }
  ): Promise<string | null> {
    const normalizedKind: ProjectResourceKind =
      kind === 'pattern' || kind === 'regex_node' ? 'regex' : kind
    const includeDeps = options?.includeDeps !== false
    const moveIfExists = options?.moveIfExists === true

    const existing = nodes.value.find((n) => n.id === resourceId)
    if (existing) {
      if (moveIfExists) {
        // 走 vueFlowApi.updateNode 更新位置（Vue Flow 规范，触发内部状态同步）
        updateNode(existing.id, { position })
      }
      selectedNodeId.value = existing.id
      // 非 schema 幂等返回时也需要触发 reconcileAll，
      // 因为内嵌约束物化可能已在之前的 Schema 导入中创建了节点但未建立完整关系
      if (normalizedKind !== 'schema') {
        await nextTick()
        await reconcileAll()
        return existing.id
      }
    }

    try {
      // 导入前压入撤销快照（幂等早退已排除，此后必然产生画布变更）
      saveState?.()

      if (kind === 'pattern') {
        return await importPattern(resourceId, position, getEffectiveProjectConfigPath)
      }

      if (normalizedKind === 'schema') {
        // 检测引用该 Schema 的关联独立约束，询问用户是否一并导入。
        // 仅当存在「尚未在画布上」的关联独立约束时才弹窗（智能跳过，零打扰）。
        // 设计背景：拖拽 Schema 默认只物化内嵌约束，独立约束需用户决策是否连带，
        // 避免自动连带造成「拖一个出现一堆」的雪崩。详见
        // docs/superpowers/specs/2026-06-26-schema-import-related-constraints-prompt-design.md
        //
        // 时序要点：弹窗必须在 Schema 节点创建【之前】弹出。
        // 早期实现把 showConfirm 放在 importSchema 之后，导致「确认弹窗」比 Schema 节点
        // 晚出现约 9ms——这与依赖「Schema 节点出现」作为成功信号的拖拽自动化（及外部
        // 并发关弹窗逻辑）形成极端竞态，在较慢环境（CI）下弹窗来不及被处理。
        // 改为「先问（记下决定）→ 始终建节点 → 决定为真才连带创建」，让弹窗严格早于节点，
        // 从源头消除竞态。getIndependentConstraintIdsForSchema 仅读资源树、不读画布节点，
        // 可安全前置；连带约束创建（依赖 Schema 节点存在以解析列名）仍保留在节点创建之后。
        let shouldImportRelated = false
        // AI 驱动的导入（skipRelatedConstraints=true）跳过确认弹窗——AI 流程中无人响应弹窗，
        // 且 AI 默认只显示用户点名的资源，不连带（用户可后续手动连带）。
        if (!options?.skipRelatedConstraints && getIndependentConstraintIdsForSchema) {
          const pendingIds =
            getIndependentConstraintIdsForSchema(resourceId)?.filter(
              (cId) => !nodes.value.some((n) => n.id === cId)
            ) || []

          if (pendingIds.length > 0) {
            // 用户选「全部导入」→ 连带创建关联独立约束（复用已有能力，幂等且避免雪崩）
            // 用户选「只导 Schema」/关闭弹窗 → 跳过，保持当前行为
            shouldImportRelated =
              (await showConfirm({
                title: t('canvas.nodeCanvas.relatedConstraintsTitle'),
                message: t('canvas.nodeCanvas.relatedConstraintsMessage', {
                  schema: resourceId,
                  count: pendingIds.length,
                  constraints: pendingIds.join(', '),
                }),
                confirmText: t('canvas.nodeCanvas.relatedConstraintsImportAll'),
                cancelText: t('canvas.nodeCanvas.relatedConstraintsSchemaOnly'),
                type: 'info',
              })) === true
          }
        }

        // 始终创建 Schema 节点（无论用户在弹窗中选择什么）。
        // 「只导 Schema」/关闭弹窗时 Schema 仍要落画布，这是用户的主体操作意图。
        // 导入前快照节点 id 集合，用于导入后识别"本次批次"并做列式布局避让。
        const preImportNodeIds = new Set(nodes.value.map((n) => n.id))
        const nodeId = await importSchema(resourceId, position)
        selectedNodeId.value = nodeId

        // 仅当用户选「全部导入」才连带创建：必须 Schema 节点已存在，
        // 否则 importConstraint(includeDeps:false) 拿不到 schema 节点、列名解析会丢失。
        if (shouldImportRelated) {
          await importRelatedIndependentConstraints(resourceId, '', position)
        }

        // 批量导入完成后对新导入的约束批次应用列式布局并避开既有节点包围盒
        //（修复：约束列压住项目根节点等既有内容；内嵌物化与连带约束共用一列，互不重叠）
        relayoutImportedConstraintBatch(nodes, preImportNodeIds, position)

        sourceIndex?.rebuild()
        await nextTick()
        flushBufferedEdges()
        await reconcileAll()
        // 导入后检测是否出现重复 source
        const schemaNode = nodes.value.find(
          (n) => n.id === nodeId && (n.type === 'schema' || n.type === 'jsonSchema')
        )
        if (schemaNode && sourceIndex) {
          const data = schemaNode.data as {
            sourceFilePath?: string
            localPath?: string
            sheetName?: string
          }
          if (
            sourceIndex.isDuplicateSource(
              data.sourceFilePath || data.localPath || '',
              data.sheetName,
              nodeId
            )
          ) {
            const conflict = sourceIndex.getConflictForSource(
              data.sourceFilePath || data.localPath || '',
              data.sheetName,
              nodeId
            )
            const otherIds = conflict?.nodeIds.filter((id) => id !== nodeId) || []
            toastWarning(
              t('canvas.nodeCanvas.duplicateSourceImportMessage', {
                resourceId,
                nodes: otherIds.join(', '),
              }),
              t('canvas.nodeCanvas.duplicateSourceTitle')
            )
          }
        }
        return nodeId
      }

      if (normalizedKind === 'regex') {
        const nodeId = await importRegex(resourceId, position, { includeDeps, moveIfExists })
        await nextTick()
        flushBufferedEdges()
        await reconcileAll()
        return nodeId
      }

      if (normalizedKind === 'constraint') {
        const nodeId = await importConstraint(resourceId, position, { includeDeps, moveIfExists })
        await nextTick()
        flushBufferedEdges()
        await reconcileAll()
        return nodeId
      }

      if (normalizedKind === 'transform') {
        const nodeId = await importTransform(resourceId, position, { includeDeps, moveIfExists })
        await nextTick()
        flushBufferedEdges()
        await reconcileAll()
        return nodeId
      }

      return null
    } catch (error) {
      logger.error('[GraphStore] importV2ResourceToCanvas 失败:', error)
      toastError(
        error instanceof Error ? error.message : t('messages.error.unknownError'),
        t('messages.import.importFailed')
      )
      return null
    }
  }

  async function importPattern(
    patternId: string,
    position: { x: number; y: number },
    getConfigPath: () => string | undefined
  ): Promise<string | null> {
    const configPath = getConfigPath()
    if (!configPath) {
      logger.warn('[importPattern] 无法获取项目配置路径')
      return null
    }

    const fullConfig = await getV2FullConfig(configPath)
    const registries = fullConfig.regex_registries

    let patternData: unknown = null
    let registry: PatternRegistryTypeV2 = 'patterns'

    for (const [key, value] of Object.entries(registries || {})) {
      if (key === patternId || key.endsWith(`/${patternId}`)) {
        patternData = value
        registry = 'patterns'
        break
      }
    }

    if (!patternData) {
      logger.warn(`[importPattern] 未找到 pattern: ${patternId}`)
      toastError(
        t('messages.import.patternNotFound', { patternId }),
        t('messages.import.importFailed')
      )
      return null
    }

    const definition = (patternData as Record<string, unknown>).definition as Record<
      string,
      unknown
    >
    const nodeId = `pattern-${patternId}`

    const existingNode = nodes.value.find((n) => n.id === nodeId)
    if (existingNode) {
      updateNode(existingNode.id, { position })
      selectedNodeId.value = nodeId
      return nodeId
    }

    const patternNode: CustomNode = {
      id: nodeId,
      type: 'pattern',
      position,
      data: {
        patternId,
        name: patternId,
        registry,
        pattern: definition?.pattern || definition?.regex || '',
        flags: definition?.flags,
        caseSensitive: definition?.case_sensitive ?? true,
        saveState: 'saved',
      } as unknown as CustomNodeData,
    }

    addNodes(patternNode)
    // addNodes 是 Vue Flow 增量 API，需等待 nextTick 让 model→store 回写完成后，
    // 本 tick 之后的节点查找（nodes.value.find）才能命中该节点。
    // 禁止手动 spread 追加 nodes.value——会绕过 Vue Flow 内部状态管理（见 AGENTS.md 时序约定）。
    await nextTick()
    selectedNodeId.value = nodeId
    return nodeId
  }

  async function importTransform(
    transformId: string,
    position: { x: number; y: number },
    options?: { includeDeps?: boolean; moveIfExists?: boolean }
  ): Promise<string | null> {
    const moveIfExists = options?.moveIfExists === true

    const existingNode = nodes.value.find((n) => n.id === transformId)
    if (existingNode) {
      if (moveIfExists) {
        updateNode(existingNode.id, { position })
      }
      selectedNodeId.value = transformId
      return transformId
    }

    const configPath = getEffectiveProjectConfigPath()
    if (!configPath) {
      logger.warn('[importTransform] 无法获取项目配置路径')
      return null
    }

    const fullConfig = await getV2FullConfig(configPath)
    const tData = fullConfig.transforms?.[transformId]
    if (!tData) {
      logger.warn(`[importTransform] 未找到 transform: ${transformId}`)
      return null
    }

    const inputFromNode = tData.input_from_node || undefined

    const transformNode: CustomNode = {
      id: transformId,
      type: 'transform',
      position,
      data: {
        configName: tData.name || tData.id || 'Transform',
        transformType: tData.type || 'StringSplit',
        description: tData.description || '',
        inputFromNode,
        inputColumn: tData.input_column || undefined,
        params: tData.params || {},
        outputColumns: tData.output_columns || [],
        enabled: tData.enabled !== false,
        saveState: 'saved',
      } as TransformNodeData,
    }

    addNodes(transformNode)
    // addNodes 是 Vue Flow 增量 API，需等待 nextTick 让 model→store 回写完成后，
    // 本 tick 之后的节点查找（nodes.value.find）才能命中该节点。
    // 禁止手动 spread 追加 nodes.value——会绕过 Vue Flow 内部状态管理（见 AGENTS.md 时序约定）。
    await nextTick()
    selectedNodeId.value = transformId
    return transformId
  }

  return { importV2ResourceToCanvas }
}
