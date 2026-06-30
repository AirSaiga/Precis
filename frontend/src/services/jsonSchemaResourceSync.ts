/**
 * @file jsonSchemaResourceSync.ts
 * @description JSON Schema 资源同步服务
 *
 * 数据源连接成功后,从 V2 配置拉取关联资源并物化到画布,与 table 版
 * services/schemaResourceSync.ts 对称。加载三类资源:
 *   1. 内嵌约束(schemaFile.constraints)
 *   2. 独立约束(refs.table_id === v2SchemaId)
 *   3. 正则节点(source_ref.table_id === v2SchemaId)
 * 其中 2、3 直接复用 table 版的格式无关 loader,避免重复实现。
 *
 * 资源同步是编排逻辑(依赖 store/Vue),由 E2E 覆盖,不写单测。
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'
import { useProjectStore } from '@/stores/projectStore'
import { getV2FullConfig } from '@/api/projectV2Api'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { loadIndependentConstraints, loadRegexNodes } from '@/services/schemaResourceSync'
import { addNodes } from '@/services/canvas/vueFlowApi'
import { findMatchingJsonSchema } from '@/utils/nodes/json/findMatchingJsonSchema'
import type { CustomNode, JsonSchemaColumn, JsonSchemaNodeData } from '@/types/nodes'

/**
 * 同步 JSON Schema 关联资源到画布
 * @param schemaNodeId - JSON Schema 节点 ID
 */
export async function syncJsonSchemaResources(schemaNodeId: string): Promise<void> {
  const store = useGraphStore()
  const projectStore = useProjectStore()
  const configPath = projectStore.currentPaths?.configPath

  const schemaNode = store.nodes.find((n) => n.id === schemaNodeId)
  if (!schemaNode) return

  const schemaData = schemaNode.data as unknown as JsonSchemaNodeData
  if (!schemaData.localPath || !configPath) return

  let fullConfig
  try {
    fullConfig = await getV2FullConfig(configPath)
  } catch {
    logger.debug('🔄 [syncJsonSchemaResources] 无法加载 V2 配置,跳过同步')
    return
  }

  const match = findMatchingJsonSchema(
    fullConfig.schemas || {},
    schemaData.localPath,
    schemaData.recordPath,
    configPath
  )
  if (!match) {
    logger.debug('🔄 [syncJsonSchemaResources] 未找到匹配 schema,跳过同步')
    return
  }

  const { id: v2SchemaId, schema: schemaFile } = match
  const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []

  // 1. 加载内嵌约束(仅当存在时)
  let embeddedCount = 0
  if (embedded.length > 0) {
    // 递归构建 columnName -> columnId 映射
    const colNameToId = new Map<string, string>()
    const walkNames = (cols: JsonSchemaColumn[]) => {
      for (const c of cols) {
        colNameToId.set(c.columnName, c.id)
        if (c.children) walkNames(c.children)
      }
    }
    walkNames(schemaData.columns || [])

    const bufferedEdges: Array<{ tableId: string; constraintId: string; columnId: string }> = []

    materializeV2EmbeddedConstraints({
      schemaNode: schemaNode as CustomNode,
      schemaTableName: schemaData.tableName,
      embeddedConstraints: embedded as Parameters<
        typeof materializeV2EmbeddedConstraints
      >[0]['embeddedConstraints'],
      colNameToId,
      hasNode: (id: string) => store.nodes.some((n) => n.id === id),
      addNode: (node: CustomNode) => addNodes(node),
      addConstraintEdge: (tId: string, cId: string, colId: string) => {
        bufferedEdges.push({ tableId: tId, constraintId: cId, columnId: colId })
      },
    })

    // 建边(内嵌约束物化后),去重避免与 tryLoadJsonSchemaConfig 重复
    for (const edge of bufferedEdges) {
      if (!store.edges.some((e) => e.source === edge.tableId && e.target === edge.constraintId)) {
        store.createConnection(
          edge.tableId,
          edge.constraintId,
          `source-right-${edge.columnId}`,
          `target-input-${edge.constraintId}`
        )
      }
    }
    embeddedCount = embedded.length
  }

  // 2. 加载独立约束 + 3. 加载正则节点(复用 table 版格式无关 loader)
  const independentCount = await loadIndependentConstraints(
    schemaNodeId,
    v2SchemaId,
    store,
    projectStore
  )
  const regexCount = await loadRegexNodes(schemaNodeId, v2SchemaId, store, projectStore)

  logger.debug(
    `🔄 [syncJsonSchemaResources] 同步完成: ${embeddedCount} 内嵌约束, ${independentCount} 独立约束, ${regexCount} 正则`
  )
}
