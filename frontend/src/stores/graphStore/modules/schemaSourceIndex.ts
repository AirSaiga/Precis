/**
 * @file schemaSourceIndex.ts
 * @description Schema 数据源索引模块
 *
 * 维护画布中所有 schema/jsonSchema 节点的 (source.path, source.sheet) 索引，
 * 用于在创建、导入、绑定数据源时即时检测重复 source。
 *
 * 设计原则：
 * - source key 标准化逻辑与后端 normalize_source_key 保持一致
 * - 索引惰性构建，首次访问时从当前 nodes 重建
 * - 提供查找、重复检测、冲突信息构建能力
 */

import { computed, type Ref } from 'vue'
import type { CustomNode, SchemaNodeData, JsonSchemaNodeData } from '@/types/graph'
import { sourceKeyString, normalizeSourceKey } from '@/utils/typeHelpers'

export interface SchemaSourceConflict {
  /** 发生冲突的 source key */
  sourceKey: string
  /** 涉及的两个及以上 schema 节点 ID */
  nodeIds: string[]
  /** 供 UI 展示的路径 */
  path: string
  /** 供 UI 展示的 sheet（可能为 null） */
  sheet: string | null
}

export interface SchemaSourceIndex {
  /** 查找指定 source 对应的 schema 节点 ID */
  findNodeIdBySource(path: string, sheet: string | null | undefined): string | undefined
  /** 检测是否重复（可排除指定节点，用于更新自身时） */
  isDuplicateSource(path: string, sheet: string | null | undefined, excludeNodeId?: string): boolean
  /** 获取指定 source 的重复冲突信息（不含 excludeNodeId） */
  getConflictForSource(
    path: string,
    sheet: string | null | undefined,
    excludeNodeId?: string
  ): SchemaSourceConflict | null
  /** 获取所有 source 冲突 */
  getConflicts(): SchemaSourceConflict[]
  /** 重建索引 */
  rebuild(): void
}

function getNodeSource(
  node: CustomNode
): { path: string | undefined; sheet: string | undefined } | null {
  if (node.type !== 'schema' && node.type !== 'jsonSchema') return null
  const data = node.data as SchemaNodeData | JsonSchemaNodeData
  // 优先使用真实本地路径 localPath，sourceFilePath 通常仅作为显示文件名
  const path = data.localPath || data.sourceFilePath
  if (!path) return null
  return { path, sheet: data.sheetName }
}

function createIndexState(nodes: Ref<CustomNode[]>): {
  index: Map<string, string[]>
  conflicts: Map<string, string[]>
} {
  const index = new Map<string, string[]>()
  const conflicts = new Map<string, string[]>()
  for (const node of nodes.value) {
    const source = getNodeSource(node)
    if (!source?.path) continue
    const key = sourceKeyString(source.path, source.sheet)
    const list = index.get(key) || []
    list.push(node.id)
    index.set(key, list)
    if (list.length >= 2) {
      conflicts.set(key, list)
    }
  }
  return { index, conflicts }
}

function buildConflictMap(nodes: Ref<CustomNode[]>): Map<string, string[]> {
  return createIndexState(nodes).conflicts
}

export function createSchemaSourceIndex(nodes: Ref<CustomNode[]>): SchemaSourceIndex {
  let cachedIndex: Map<string, string[]> | null = null

  function ensureIndex(): Map<string, string[]> {
    if (!cachedIndex) {
      cachedIndex = createIndexState(nodes).index
    }
    return cachedIndex
  }

  function rebuild(): void {
    cachedIndex = createIndexState(nodes).index
  }

  function findNodeIdBySource(path: string, sheet: string | null | undefined): string | undefined {
    const ids = ensureIndex().get(sourceKeyString(path, sheet))
    return ids?.[0]
  }

  function isDuplicateSource(
    path: string,
    sheet: string | null | undefined,
    excludeNodeId?: string
  ): boolean {
    const ids = ensureIndex().get(sourceKeyString(path, sheet))
    if (!ids || ids.length === 0) return false
    if (!excludeNodeId) return ids.length > 1
    const others = ids.filter((id) => id !== excludeNodeId)
    return others.length > 0
  }

  function getConflictForSource(
    path: string,
    sheet: string | null | undefined,
    excludeNodeId?: string
  ): SchemaSourceConflict | null {
    const groups = buildConflictMap(nodes)
    const key = sourceKeyString(path, sheet)
    const nodeIds = groups.get(key)
    if (!nodeIds || nodeIds.length < 2) return null
    const filteredIds = excludeNodeId ? nodeIds.filter((id) => id !== excludeNodeId) : nodeIds
    if (filteredIds.length < 2) return null
    const [normalizedPath, normalizedSheet] = normalizeSourceKey(path, sheet)
    return { sourceKey: key, nodeIds: filteredIds, path: normalizedPath, sheet: normalizedSheet }
  }

  function getConflicts(): SchemaSourceConflict[] {
    const conflicts: SchemaSourceConflict[] = []
    const groups = buildConflictMap(nodes)
    for (const [key, nodeIds] of groups.entries()) {
      if (nodeIds.length < 2) continue
      const [path, sheet] = normalizeSourceKeyFromKey(key)
      conflicts.push({ sourceKey: key, nodeIds, path, sheet })
    }
    return conflicts
  }

  return {
    findNodeIdBySource,
    isDuplicateSource,
    getConflictForSource,
    getConflicts,
    rebuild,
  }
}

function normalizeSourceKeyFromKey(key: string): [string, string | null] {
  const sepIdx = key.indexOf('::')
  if (sepIdx < 0) return [key, null]
  return [key.slice(0, sepIdx), key.slice(sepIdx + 2)]
}

export function useSchemaSourceIndexState(nodes: Ref<CustomNode[]>) {
  const index = createSchemaSourceIndex(nodes)
  const conflicts = computed(() => index.getConflicts())
  const hasConflicts = computed(() => conflicts.value.length > 0)

  return {
    index,
    conflicts,
    hasConflicts,
  }
}
