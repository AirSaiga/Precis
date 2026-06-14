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
import { toastError, toastWarning } from '@/core/toast'
import { createV2ImportEdges } from './edges'
import { createV2SchemaImporter } from './schema'
import { createV2RegexImporter } from './regex'
import { createV2ConstraintImporter } from './constraint'
import { getV2FullConfig } from '@/api/projectV2Api'
import type { PatternRegistryTypeV2 } from '@/types/projectV2'
import { addNodes } from '@/services/canvas/vueFlowApi'

export type ProjectResourceKind =
  | 'schema'
  | 'constraint'
  | 'regex'
  | 'pattern'
  | 'regex_node'
  | 'transform'

export function createV2ImportToCanvas(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  reconcileAll: () => void
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
  } = params
  const { t } = useI18n()

  const { ensureSchemaToRegexEdge, ensureSchemaToConstraintEdge, bufferEdge, flushBufferedEdges } =
    createV2ImportEdges({ edges })

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
    options?: { includeDeps?: boolean; moveIfExists?: boolean }
  ): Promise<string | null> {
    const normalizedKind: ProjectResourceKind =
      kind === 'pattern' || kind === 'regex_node' ? 'regex' : kind
    const includeDeps = options?.includeDeps !== false
    const moveIfExists = options?.moveIfExists === true

    const existing = nodes.value.find((n) => n.id === resourceId)
    if (existing) {
      if (moveIfExists) {
        existing.position = { ...position }
      }
      selectedNodeId.value = existing.id
      // 非 schema 幂等返回时也需要触发 reconcileAll，
      // 因为内嵌约束物化可能已在之前的 Schema 导入中创建了节点但未建立完整关系
      if (normalizedKind !== 'schema') {
        await nextTick()
        reconcileAll()
        return existing.id
      }
    }

    try {
      if (kind === 'pattern') {
        return await importPattern(resourceId, position, getEffectiveProjectConfigPath)
      }

      if (normalizedKind === 'schema') {
        const nodeId = await importSchema(resourceId, position)
        selectedNodeId.value = nodeId
        sourceIndex?.rebuild()
        await nextTick()
        flushBufferedEdges()
        reconcileAll()
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
        reconcileAll()
        return nodeId
      }

      if (normalizedKind === 'constraint') {
        const nodeId = await importConstraint(resourceId, position, { includeDeps, moveIfExists })
        await nextTick()
        flushBufferedEdges()
        reconcileAll()
        return nodeId
      }

      if (normalizedKind === 'transform') {
        const nodeId = await importTransform(resourceId, position, { includeDeps, moveIfExists })
        await nextTick()
        flushBufferedEdges()
        reconcileAll()
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
    let patternKey = ''

    for (const [key, value] of Object.entries(registries || {})) {
      if (key === patternId || key.endsWith(`/${patternId}`)) {
        patternData = value
        patternKey = key
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
      existingNode.position = { ...position }
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
    // 手动同步 nodes.ref — 见 ensureSchemaNodeFromV2.ts 中相同模式的详细说明
    nodes.value = [...nodes.value, patternNode]
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
        existingNode.position = { ...position }
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
    // 手动同步 nodes.ref — 见 ensureSchemaNodeFromV2.ts 中相同模式的详细说明
    nodes.value = [...nodes.value, transformNode]
    selectedNodeId.value = transformId
    return transformId
  }

  return { importV2ResourceToCanvas }
}
