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
import { toastError } from '@/core/toast'
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
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    reconcileAll,
  } = params
  const { t } = useI18n()

  const { ensureSchemaToRegexEdge, ensureSchemaToConstraintEdge, bufferEdge, flushBufferedEdges } =
    createV2ImportEdges({ edges })
  const { ensureSchemaNode, importSchema } = createV2SchemaImporter({
    nodes,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    ensureSchemaToConstraintEdge,
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
        await nextTick()
        flushBufferedEdges()
        reconcileAll()
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
