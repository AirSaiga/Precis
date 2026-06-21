/**
 * @file ensureSchemaNodeFromV2.ts
 * @description V2 Schema 节点确保模块
 *
 * 提供幂等函数 ensureSchemaNodeFromV2，用于确保画布中存在指定 ID 的 Schema 节点。
 * 若节点已存在则直接返回；若不存在则从 V2 配置加载并创建。
 *
 * 核心功能：
 * - 从后端加载 Schema 定义（getV2Schema）
 * - 解析列类型、数据源路径（绝对/相对文件）
 * - 创建完整的 SchemaNodeData 并添加到画布
 *
 * 使用场景：
 * - 约束/正则导入时自动确保依赖的 Schema 节点存在
 * - 上下文感知导入时预创建关联的 Schema 节点
 */

import type { Ref } from 'vue'
import type { CustomNode, SchemaNodeData, JsonSchemaColumn } from '@/types/graph'
import type { ColumnSpecV2, JSONOptionsV2 } from '@/types/projectV2'
import { getV2Schema } from '@/api/projectV2Api'
import { fromBackendType, fromJsonBackendType } from '@/services/builders'
import { normalizePath } from '@/core/utils/pathNormalization'
import { addNodes } from '@/services/canvas/vueFlowApi'

export function createEnsureSchemaNodeFromV2(params: {
  nodes: Ref<CustomNode[]>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
}) {
  const { nodes, getEffectiveProjectConfigPath, resolveProjectRelativePath } = params

  async function ensureSchemaNodeFromV2(tableId: string, position: { x: number; y: number }) {
    const existing = nodes.value.find(
      (n) => n.id === tableId && (n.type === 'schema' || n.type === 'jsonSchema')
    )
    if (existing) return existing

    const schema = await getV2Schema(tableId)

    // 递归转换列定义，JSON schema 保留嵌套 children 与 json_path
    const convertColumns = (columns: ColumnSpecV2[] | undefined): JsonSchemaColumn[] => {
      return (columns || []).map((col) => {
        const isJsonColumn =
          col.json_path !== undefined || (col.children && col.children.length > 0)
        const dataType = isJsonColumn
          ? (fromJsonBackendType(col.type) as JsonSchemaColumn['dataType'])
          : (fromBackendType(col.type).toLowerCase() as JsonSchemaColumn['dataType'])

        const column: JsonSchemaColumn = {
          id: col.id,
          columnName: col.name,
          dataType,
          jsonPath: col.json_path || '',
          nullable: col.nullable,
          primaryKey: col.primary_key,
          validationErrors: [],
          constraints: {},
        }
        if (col.children && col.children.length > 0) {
          column.children = convertColumns(col.children)
          column.isExpanded = col.expand ?? false
        }
        return column
      })
    }

    const cols = convertColumns(schema.columns || [])

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

    // 检测是否为 JSON schema：根据文件扩展名判断
    const sourcePath = schema.source?.path || ''
    const isJsonSchema = /\.(json|jsonl|ndjson)$/i.test(sourcePath)

    // JSON schema 不需要 sheet
    const sheetName = isJsonSchema ? undefined : (schema.source?.sheet ?? schema.sheet)

    const node: CustomNode = {
      id: tableId,
      type: isJsonSchema ? 'jsonSchema' : 'schema',
      position,
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
        sourceType: isJsonSchema ? 'json' : undefined,
        format: (schema.source?.options as JSONOptionsV2 | undefined)?.format,
        jsonPath: (schema.source?.options as JSONOptionsV2 | undefined)?.json_path,
        recordPath: (schema.source?.options as JSONOptionsV2 | undefined)?.record_path,
      },
    }

    addNodes(node)
    // addNodes() 只更新 Vue Flow 内部状态，不会同步到 Pinia store 的 nodes ref
    // （v-model 同步在 nextTick 才触发）。手动同步确保本 tick 内的后续节点查找
    // （如 ensureSchemaNode / nodes.value.find）能正确找到该节点，避免重复创建。
    nodes.value = [...nodes.value, node]
    return node
  }

  return { ensureSchemaNodeFromV2 }
}
