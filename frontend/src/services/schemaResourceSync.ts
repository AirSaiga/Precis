/**
 * @file schemaResourceSync.ts
 * @description Schema 资源自动同步服务
 *
 * 核心职责：
 * - 当 schema 节点绑定数据源后，自动从 V2 配置加载完整的表定义
 * - 加载内嵌约束、独立约束、正则节点
 * - 触发校验以更新节点状态
 *
 * 设计原则：
 * - 单一入口 syncSchemaResources()
 * - 幂等：重复调用不会创建重复节点
 * - 异步：所有加载操作都是异步的，不阻塞 UI
 */

import { nextTick } from 'vue'
import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { getV2Schema, getV2FullConfig } from '@/api/projectV2Api'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
import { generateSchemaId } from '@/utils/typeHelpers'
import type { SchemaNodeData } from '@/types/graph'

export interface SchemaResourceSyncOptions {
  /** 是否加载内嵌约束（默认 true） */
  loadEmbedded?: boolean
  /** 是否加载独立约束（默认 true） */
  loadIndependent?: boolean
  /** 是否加载正则（默认 true） */
  loadRegex?: boolean
  /** 是否触发校验（默认 true） */
  triggerValidation?: boolean
}

/**
 * 统一入口：同步 schema 节点的 V2 资源
 */
export async function syncSchemaResources(
  schemaNodeId: string,
  options: SchemaResourceSyncOptions = {}
): Promise<{
  success: boolean
  v2SchemaId?: string
  embeddedCount: number
  independentCount: number
  regexCount: number
  error?: string
}> {
  const {
    loadEmbedded = true,
    loadIndependent = true,
    loadRegex = true,
    triggerValidation: shouldValidate = true,
  } = options

  try {
    const v2SchemaId = await resolveV2SchemaId(schemaNodeId)
    if (!v2SchemaId) {
      return { success: false, embeddedCount: 0, independentCount: 0, regexCount: 0 }
    }

    const graphStore = useGraphStore()

    // 注册映射（UUID -> V2 ID）
    if (schemaNodeId !== v2SchemaId) {
      graphStore.registerV2SchemaMapping(schemaNodeId, v2SchemaId)
    }

    let embeddedCount = 0
    let independentCount = 0
    let regexCount = 0

    // 1. 加载内嵌约束
    if (loadEmbedded) {
      embeddedCount = await loadEmbeddedConstraints(schemaNodeId, v2SchemaId)
    }

    // 2. 加载独立约束（占位：Phase 2 实现）
    if (loadIndependent) {
      independentCount = await loadIndependentConstraints(schemaNodeId, v2SchemaId)
    }

    // 3. 加载正则（占位：Phase 2 实现）
    if (loadRegex) {
      regexCount = await loadRegexNodes(schemaNodeId, v2SchemaId)
    }

    // 4. 触发校验
    const totalLoaded = embeddedCount + independentCount + regexCount
    if (shouldValidate && totalLoaded > 0) {
      // 等待 Vue Flow 渲染新节点
      await nextTick()
      triggerValidationForNode(
        schemaNodeId,
        Array.from(graphStore.nodes),
        Array.from(graphStore.edges),
        (nodeId: string, data: any) => graphStore.updateNodeData(nodeId, data)
      )
    }

    return {
      success: true,
      v2SchemaId,
      embeddedCount,
      independentCount,
      regexCount,
    }
  } catch (error) {
    logger.error('❌ [syncSchemaResources] 同步失败:', error)
    return {
      success: false,
      embeddedCount: 0,
      independentCount: 0,
      regexCount: 0,
      error: String(error),
    }
  }
}

/**
 * 解析 schema 节点对应的 V2 Schema ID
 *
 * 优先级：
 * 1. 节点 ID 本身就是 V2 ID (sc_...)
 * 2. graphStore 映射表
 * 3. 用 tableName 反查 V2 配置
 * 4. 用 sourceFilePath + sheetName 计算 V2 ID
 */
export async function resolveV2SchemaId(schemaNodeId: string): Promise<string | null> {
  // 1. 本身就是 V2 ID
  if (isV2SchemaId(schemaNodeId)) {
    return schemaNodeId
  }

  const graphStore = useGraphStore()

  // 2. 查映射表
  const mapped = graphStore.getV2SchemaId?.(schemaNodeId)
  if (mapped) return mapped

  // 3. 用节点数据计算
  const schemaNode = graphStore.nodes.find((n) => n.id === schemaNodeId)
  if (!schemaNode) return null

  const schemaData = schemaNode.data as SchemaNodeData
  const projectStore = useProjectStore()
  const configPath = projectStore.currentPaths?.configPath

  if (!configPath) return null

  // 加载 V2 配置（供后续两步共用）
  let fullConfig: Awaited<ReturnType<typeof getV2FullConfig>> | null = null
  try {
    fullConfig = await getV2FullConfig(configPath)
  } catch (error) {
    logger.debug('ℹ️ [resolveV2SchemaId] 无法加载 V2 配置:', error)
    return null
  }

  const schemas = fullConfig.schemas || {}

  // 3a. 用 tableName 反查
  const byName = Object.values(schemas).find(
    (s: any) => s.name?.toLowerCase() === schemaData.tableName?.toLowerCase()
  )
  if (byName?.id) return byName.id as string

  // 3b. 用 sourceFilePath + sheetName 计算
  const computedId = generateSchemaId(
    schemaData.sourceFilePath || schemaData.sourceFile || '',
    schemaData.sheetName
  )
  if (schemas[computedId]) {
    return computedId
  }

  return null
}

/**
 * 判断是否为 V2 Schema ID
 */
export function isV2SchemaId(id: string): boolean {
  return id.startsWith('sc_')
}

// ============================================================================
// 内部实现
// ============================================================================

/**
 * 加载内嵌约束
 */
async function loadEmbeddedConstraints(schemaNodeId: string, v2SchemaId: string): Promise<number> {
  try {
    const schemaFile = await getV2Schema(v2SchemaId)
    if (!schemaFile?.constraints?.length) return 0

    const graphStore = useGraphStore()
    const schemaNode = graphStore.nodes.find((n) => n.id === schemaNodeId)
    if (!schemaNode) return 0

    const schemaData = schemaNode.data as SchemaNodeData
    const colNameToId = new Map<string, string>(
      (schemaData.columns || []).map((c) => [c.columnName, c.id])
    )

    // 缓冲边，等节点渲染后再创建
    const bufferedEdges: Array<{
      tableId: string
      constraintId: string
      columnId: string
    }> = []

    materializeV2EmbeddedConstraints({
      schemaNode: schemaNode as any,
      schemaTableName: schemaData.tableName,
      embeddedConstraints: schemaFile.constraints,
      colNameToId,
      hasNode: (id: string) => graphStore.nodes.some((n) => n.id === id),
      addNode: (node: any) => addNodes(node),
      addConstraintEdge: (tableId: string, constraintId: string, columnId: string) => {
        bufferedEdges.push({ tableId, constraintId, columnId })
      },
    })

    // 等待 Vue Flow 渲染后创建边
    await nextTick()
    for (const edge of bufferedEdges) {
      graphStore.createConnection(
        edge.tableId,
        edge.constraintId,
        `source-right-${edge.columnId}`,
        `target-input-${edge.constraintId}`
      )
    }

    return schemaFile.constraints.length
  } catch (error) {
    logger.debug('ℹ️ [loadEmbeddedConstraints] 无内嵌约束或加载失败:', error)
    return 0
  }
}

/**
 * 加载独立约束
 *
 * 遍历 V2 配置中的 constraints，加载 refs.table_id 匹配 v2SchemaId 的独立约束节点。
 * 幂等：已存在于画布上的节点不会重复创建。
 */
async function loadIndependentConstraints(
  schemaNodeId: string,
  v2SchemaId: string
): Promise<number> {
  try {
    const projectStore = useProjectStore()
    const configPath = projectStore.currentPaths?.configPath
    if (!configPath) return 0

    const fullConfig = await getV2FullConfig(configPath)
    const constraints = fullConfig.constraints || {}
    const graphStore = useGraphStore()

    const matchingConstraints = Object.values(constraints).filter((c) => {
      const refs = c.refs as Record<string, unknown>
      return refs?.table_id === v2SchemaId
    })

    if (matchingConstraints.length === 0) return 0

    const schemaNode = graphStore.nodes.find((n) => n.id === schemaNodeId)
    const baseX = (schemaNode?.position.x || 0) + 350
    const baseY = schemaNode?.position.y || 0

    let loadedCount = 0
    for (let i = 0; i < matchingConstraints.length; i++) {
      const c = matchingConstraints[i]
      if (!c) continue
      if (graphStore.nodes.some((n) => n.id === c.id)) continue

      const position = { x: baseX, y: baseY + i * 120 }
      const createdId = await graphStore.importV2ResourceToCanvas('constraint', c.id, position)
      if (createdId) loadedCount++
    }

    return loadedCount
  } catch (error) {
    logger.debug('ℹ️ [loadIndependentConstraints] 加载失败:', error)
    return 0
  }
}

/**
 * 加载正则节点
 *
 * 遍历 V2 配置中的 regex_nodes，加载 source_ref.table_id 匹配 v2SchemaId 的正则节点。
 * 幂等：已存在于画布上的节点不会重复创建。
 */
async function loadRegexNodes(schemaNodeId: string, v2SchemaId: string): Promise<number> {
  try {
    const projectStore = useProjectStore()
    const configPath = projectStore.currentPaths?.configPath
    if (!configPath) return 0

    const fullConfig = await getV2FullConfig(configPath)
    const regexNodes = fullConfig.regex_nodes || {}
    const graphStore = useGraphStore()

    const matchingRegex = Object.values(regexNodes).filter((r) => {
      return r.source_ref?.table_id === v2SchemaId
    })

    if (matchingRegex.length === 0) return 0

    const schemaNode = graphStore.nodes.find((n) => n.id === schemaNodeId)
    const baseX = (schemaNode?.position.x || 0) + 350
    const baseY = schemaNode?.position.y || 0

    let loadedCount = 0
    for (let i = 0; i < matchingRegex.length; i++) {
      const r = matchingRegex[i]
      if (!r) continue
      if (graphStore.nodes.some((n) => n.id === r.id)) continue

      const position = { x: baseX, y: baseY + i * 120 }
      const createdId = await graphStore.importV2ResourceToCanvas('regex', r.id, position)
      if (createdId) loadedCount++
    }

    return loadedCount
  } catch (error) {
    logger.debug('ℹ️ [loadRegexNodes] 加载失败:', error)
    return 0
  }
}
