/**
 * @file v2SchemaMapping.ts
 * @description V2 Schema ID 与画布节点 ID 映射模块
 *
 * 维护 canvas 节点 ID ↔ V2 schema 资源 ID 之间的映射关系。
 * 当 schema 节点 ID 已经以 'sc_' 开头时直接使用（兼容旧格式），
 * 否则通过映射表查找。
 */

import type { Ref } from 'vue'

export interface V2SchemaMappingDeps {
  v2SchemaIdMap: Ref<Map<string, string>>
}

export function createV2SchemaMappingModule(deps: V2SchemaMappingDeps) {
  const { v2SchemaIdMap } = deps

  function registerV2SchemaMapping(canvasNodeId: string, v2SchemaId: string) {
    v2SchemaIdMap.value.set(canvasNodeId, v2SchemaId)
  }

  function getV2SchemaId(canvasNodeId: string): string | undefined {
    if (canvasNodeId.startsWith('sc_')) return canvasNodeId
    return v2SchemaIdMap.value.get(canvasNodeId)
  }

  return {
    registerV2SchemaMapping,
    getV2SchemaId,
  }
}
