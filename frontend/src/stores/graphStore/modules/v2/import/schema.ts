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
import type { CustomNode, SchemaNodeData, JsonSchemaColumn } from '@/types/graph'
import type { TableSchemaFileV2 } from '@/types/projectV2'
import { getV2Schema } from '@/api/projectV2Api'
import { fromBackendType } from '@/services/builders'
import { materializeV2EmbeddedConstraints } from '../shared/embeddedConstraints'
import { normalizePath } from '@/core/utils/pathNormalization'
import { addNodes } from '@/services/canvas/vueFlowApi'

export function createV2SchemaImporter(params: {
  nodes: Ref<CustomNode[]>
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  ensureSchemaToConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
  /**
   * 连带创建引用该 Schema 的其他独立约束。
   * 仅在 ensureSchemaNode 新建 Schema 且 options.importRelatedConstraints=true 时调用。
   * 用于拖拽独立约束触发自动创建 Schema 时，补齐该 Schema 关联的其他约束。
   */
  importRelatedIndependentConstraints?: (
    tableId: string,
    excludeConstraintId: string,
    schemaPosition: { x: number; y: number }
  ) => Promise<void>
}) {
  const {
    nodes,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    ensureSchemaToConstraintEdge,
    importRelatedIndependentConstraints,
  } = params

  /**
   * 确保指定 Schema 节点存在于画布中（幂等）。
   *
   * @param tableId - Schema 资源 ID
   * @param schemaPosition - 节点在画布上的坐标
   * @param schemaFile - 可选的预加载 Schema 文件，避免重复请求后端
   * @param options.importRelatedConstraints - 是否连带创建该 Schema 的内嵌约束和引用它的其他独立约束。
   *   拖拽独立约束触发自动创建 Schema 时置为 true；拖拽 FK 的 to_schema 等不希望雪崩的场景保持 false。
   * @param options.excludeConstraintId - 连带创建时需排除的约束 ID（通常是触发本次自动创建的被拖拽约束自身）
   */
  const ensureSchemaNode = async (
    tableId: string,
    schemaPosition: { x: number; y: number },
    schemaFile?: TableSchemaFileV2,
    options?: { importRelatedConstraints?: boolean; excludeConstraintId?: string }
  ) => {
    const found = nodes.value.find(
      (n) => n.id === tableId && (n.type === 'schema' || n.type === 'jsonSchema')
    )
    if (found) return found

    const schema = schemaFile || (await getV2Schema(tableId))

    // 递归转换列定义，支持嵌套 children
    const convertColumns = (columns: any[]): JsonSchemaColumn[] => {
      return (columns || []).map((col) => {
        // 将后端类型转换为前端 JsonDataType
        const backendType = fromBackendType(col.type)
        const jsonDataType = backendType.toLowerCase() as JsonSchemaColumn['dataType']

        const column: JsonSchemaColumn = {
          id: col.id,
          columnName: col.name,
          dataType: jsonDataType,
          jsonPath: col.json_path || '',
          nullable: col.nullable,
          primaryKey: col.primary_key,
          validationErrors: [],
          constraints: {},
        }
        // 递归处理嵌套子列
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

    const schemaNode: CustomNode = {
      id: tableId,
      type: isJsonSchema ? 'jsonSchema' : 'schema',
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
        sourceType: isJsonSchema ? 'json' : undefined,
        format: (schema.source?.options as any)?.format,
        jsonPath: (schema.source?.options as any)?.json_path,
        recordPath: (schema.source?.options as any)?.record_path,
      },
    }
    addNodes(schemaNode)
    // addNodes() 只更新 Vue Flow 内部状态，不会同步到 Pinia store 的 nodes ref
    // （v-model 同步在 nextTick 才触发）。手动同步确保本 tick 内的后续节点查找
    // （如 ensureSchemaNode / nodes.value.find）能正确找到该节点，避免重复创建。
    nodes.value = [...nodes.value, schemaNode]

    // 连带创建该 Schema 的约束：
    // - 拖拽独立约束触发自动创建 Schema 时（options.importRelatedConstraints=true），
    //   补齐 Schema 自身的内嵌约束 + 引用该 Schema 的其他独立约束，
    //   使自动创建的 Schema 与直接拖拽 Schema 时的内容保持一致。
    // - FK 的 to_schema 等场景不传该选项，避免雪崩式导入。
    if (options?.importRelatedConstraints) {
      // 先物化内嵌约束（与直接 importSchema 行为一致）
      materializeEmbeddedConstraints(schemaNode, schema)
      // 再连带创建引用该 Schema 的其他独立约束（排除被拖拽约束自身）
      if (importRelatedIndependentConstraints) {
        await importRelatedIndependentConstraints(
          tableId,
          options.excludeConstraintId || '',
          schemaPosition
        )
      }
    }

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
      addNode: (node: CustomNode) => {
        addNodes(node)
        // 手动同步 nodes.ref — 见 ensureSchemaNodeFromV2.ts 中相同模式的详细说明
        nodes.value = [...nodes.value, node]
      },
      addConstraintEdge: ensureSchemaToConstraintEdge,
    })
  }

  const importSchema = async (
    resourceId: string,
    position: { x: number; y: number }
  ): Promise<string> => {
    const schemaFile = await getV2Schema(resourceId)
    // 直接拖拽 Schema 保持原有行为：只物化内嵌约束，不连带创建引用它的独立约束。
    // 连带创建独立约束的能力（importRelatedConstraints）仅用于拖拽独立约束触发
    // 自动创建 Schema 的场景，避免改变直接拖拽 Schema 的导入范围。
    const node = await ensureSchemaNode(resourceId, position, schemaFile)
    materializeEmbeddedConstraints(node, schemaFile)
    return node.id
  }

  return { ensureSchemaNode, materializeEmbeddedConstraints, importSchema }
}
