/**
 * @file schema.ts
 * @description V2 Schema 导入模块
 *
 * 负责将 V2 项目配置中的 Schema（表结构）导入到画布节点中。
 * 包括从后端加载 Schema 定义、创建 Schema 节点、解析列信息、
 * 处理数据源路径（绝对/相对文件路径）以及物化内嵌约束。
 *
 * 核心功能：
 * - ensureSchemaNode: 确保指定 Schema 节点存在于画布中（幂等）
 * - materializeEmbeddedConstraints: 将 Schema 内嵌约束转换为画布节点和边
 * - importSchema: 完整的 Schema 导入流程（加载 + 创建节点 + 物化约束）
 *
 * 数据流：
 * V2 配置 → getV2Schema API → TableSchemaFileV2 → CustomNode(schema) → 画布
 */

import type { Ref } from 'vue'
import type { CustomNode, SchemaNodeData } from '@/types/graph'
import type { TableSchemaFileV2 } from '@/types/projectV2'
import { getV2Schema } from '@/api/projectV2Api'
import { fromBackendType } from '@/services/builders'
import { materializeV2EmbeddedConstraints } from '../shared/embeddedConstraints'
import { normalizePath } from '@/core/utils/pathNormalization'

export function createV2SchemaImporter(params: {
  nodes: Ref<CustomNode[]>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  ensureSchemaToConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
}) {
  const {
    nodes,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    ensureSchemaToConstraintEdge,
  } = params

  const ensureSchemaNode = async (
    tableId: string,
    schemaPosition: { x: number; y: number },
    schemaFile?: TableSchemaFileV2
  ) => {
    const found = nodes.value.find((n) => n.id === tableId && n.type === 'schema')
    if (found) return found

    const schema = schemaFile || (await getV2Schema(tableId))
    const cols = (schema.columns || []).map((col) => ({
      id: col.id,
      columnName: col.name,
      dataType: fromBackendType(col.type),
      validationErrors: [],
      constraints: {},
    }))
    const configPath = getEffectiveProjectConfigPath()
    // 默认回退为 relative_file，防止后端返回的 mode 为空或未声明时 localPath 丢失
    const sourcePathMode = schema.source?.mode || 'relative_file'
    const rawLocalPath =
      sourcePathMode === 'absolute_file'
        ? schema.source?.path
        : sourcePathMode === 'relative_file'
          ? resolveProjectRelativePath(configPath, schema.source?.path)
          : undefined
    const localPath = rawLocalPath ? normalizePath(rawLocalPath) : undefined
    const sourceMode = 'localfile'
    // 优先读取 source.sheet，兼容顶层 sheet 字段（后端 TableSchemaFile 支持两者）
    const sheetName = schema.source?.sheet ?? schema.sheet

    const schemaNode: CustomNode = {
      id: tableId,
      type: 'schema',
      position: schemaPosition,
      data: {
        configName: `Schema_${schema.name}`,
        tableName: schema.name,
        sheetName,
        sourceFilePath: schema.source?.path,
        headerRow: schema.source?.header_row ?? 0,
        sourcePathMode,
        sourceMode,
        localPath,
        columns: cols,
        saveState: 'saved',
      } as SchemaNodeData,
    }
    nodes.value.push(schemaNode)
    return schemaNode
  }

  const materializeEmbeddedConstraints = (
    schemaNode: CustomNode,
    schemaFile: TableSchemaFileV2
  ) => {
    const schemaData = schemaNode.data as SchemaNodeData
    const colNameToId = new Map<string, string>(
      (schemaData.columns || []).map((c) => [c.columnName, c.id])
    )
    const embedded = Array.isArray(schemaFile.constraints) ? schemaFile.constraints : []
    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: schemaData.tableName,
      embeddedConstraints: embedded,
      colNameToId,
      hasNode: (id: string) => nodes.value.some((n) => n.id === id),
      addNode: (node: CustomNode) => nodes.value.push(node),
      addConstraintEdge: ensureSchemaToConstraintEdge,
    })
  }

  const importSchema = async (
    resourceId: string,
    position: { x: number; y: number }
  ): Promise<string> => {
    const schemaFile = await getV2Schema(resourceId)
    const node = await ensureSchemaNode(resourceId, position, schemaFile)
    materializeEmbeddedConstraints(node, schemaFile)
    return node.id
  }

  return { ensureSchemaNode, materializeEmbeddedConstraints, importSchema }
}
