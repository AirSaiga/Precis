/**
 * @file v2Import.ts
 * @description V2 资源导入（资源树 -> 画布）
 *
 * 该模块封装从后端 V2 单文件接口拉取资源并在画布具象化的逻辑，
 * 包括 Schema/Constraint/Regex 的节点创建、依赖补齐与连线生成。
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import type { ResourceTreeStoreLike } from '@/types/storeInterfaces'
import { createEnsureSchemaNodeFromV2 } from './v2/import/ensureSchemaNodeFromV2'
import { createV2ImportToCanvas } from './v2/import/importV2ResourceToCanvas'

export function createV2ImportModule(params: {
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
   * 资源树 Store 的最小接口，用于查询 Schema 关联的独立约束。
   */
  resourceTreeStore: ResourceTreeStoreLike
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
    resourceTreeStore,
    sourceIndex,
  } = params

  // 拖拽独立约束触发自动创建 Schema 时，连带创建该 Schema 关联的其他独立约束。
  // 从 resourceTreeStore 查询 Schema 的 associatedConstraintIds，
  // 过滤出 constraintSource === 'independent' 的约束（排除内嵌约束，
  // 后者由 materializeEmbeddedConstraints 单独处理）。
  const getIndependentConstraintIdsForSchema = (schemaId: string): string[] | undefined => {
    const schemaResource = resourceTreeStore.getResourceById(schemaId)
    if (!schemaResource || schemaResource.kind !== 'schema') return undefined
    const associatedIds = schemaResource.associatedConstraintIds
    if (!associatedIds || associatedIds.length === 0) return undefined
    // 过滤出独立约束（内嵌约束通过 materializeEmbeddedConstraints 物化，不在此处理）
    return associatedIds.filter((cId) => {
      const cResource = resourceTreeStore.getResourceById(cId)
      return (
        cResource?.kind === 'constraint' &&
        (cResource as { constraintSource?: string }).constraintSource === 'independent'
      )
    })
  }

  const { ensureSchemaNodeFromV2 } = createEnsureSchemaNodeFromV2({
    nodes,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
  })

  const { importV2ResourceToCanvas } = createV2ImportToCanvas({
    nodes,
    edges,
    selectedNodeId,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    reconcileAll,
    getIndependentConstraintIdsForSchema,
    sourceIndex,
  })

  return { importV2ResourceToCanvas, ensureSchemaNodeFromV2 }
}
