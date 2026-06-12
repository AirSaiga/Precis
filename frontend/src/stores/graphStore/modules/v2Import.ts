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
  })

  return { importV2ResourceToCanvas, ensureSchemaNodeFromV2 }
}
