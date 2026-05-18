/**
 * @file hydrateSchemas.ts
 * @description V2 Schema 节点水合模块
 *
 * 将后端 V2 项目配置中的 schema 定义反序列化为画布上的 Schema 节点（CustomNode）。
 * 负责列类型转换、数据源路径解析、内嵌约束物化等。
 *
 * 功能概述：
 * - hydrateSchemasFromV2Config: 主入口，遍历 manifest.schemas 并水合每个 schema
 * - 列类型转换：通过 fromBackendType 将后端类型字符串转为前端 DataType
 * - 数据源路径解析：将相对路径解析为项目相对路径
 * - 内嵌约束物化：调用 materializeV2EmbeddedConstraints 处理 schema 内嵌约束
 *
 * 架构设计：
 * - 纯函数设计，接收 config + 工具函数作为参数
 * - 返回 { nodes, edges } 供上层合并到画布状态
 * - 错误处理：缺失的 schema 记录 warn 日志并跳过
 */

import type { Edge } from '@vue-flow/core'
import type { CustomNode, SchemaNodeData } from '@/types/graph'
import { fromBackendType } from '@/services/builders'
import { materializeV2EmbeddedConstraints } from '../../shared/embeddedConstraints'
import { logger } from '@/core/utils/logger'
import { normalizePath } from '@/core/utils/pathNormalization'

export function hydrateSchemasFromV2Config(params: {
  config: any
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
}) {
  const { config, getEffectiveProjectConfigPath, resolveProjectRelativePath } = params

  const nextNodes: CustomNode[] = []
  const nextEdges: Edge[] = []

  const schemaIds = config.manifest.schemas.map((s: any) => s.id)
  schemaIds.forEach((id: string, idx: number) => {
    const schema = config.schemas[id]
    if (!schema) {
      logger.warn(`[hydrateSchemas] Schema ${id} 在配置中缺失，跳过`)
      return
    }
    const cols = (schema.columns || []).map((col: any) => {
      const dataType = fromBackendType(col.type)
      const colResult: any = {
        id: col.id,
        columnName: col.name,
        dataType,
        validationErrors: [],
        constraints: {},
      }
      // 如果类型是 Expr 对象配置，提取 boundPattern 和 boundRegistry
      if (typeof col.type === 'object' && col.type?.name === 'Expr') {
        colResult.boundRegistry = col.type.registry
        colResult.boundPattern = col.type.pattern
        colResult.isBound = !!col.type.pattern
        colResult.expressionType = col.type.pattern ? 'explicit' : 'implicit'
      }
      // 如果类型是 Extracted 对象配置，提取 extractedConfig
      if (typeof col.type === 'object' && col.type?.name === 'Extracted') {
        colResult.extractedConfig = {
          sourceColumn: col.type.source_column,
          extractKey: col.type.extract_key,
          resultType: col.type.result_type,
        }
      }
      return colResult
    })
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
    // 判断是否为 JSON schema：存在 format 选项且为 json/jsonl/ndjson
    const isJsonSchema =
      schema.source?.options?.format &&
      ['json', 'jsonl', 'ndjson'].includes(schema.source.options.format)
    // 优先读取 source.sheet，兼容顶层 sheet 字段（后端 TableSchemaFile 支持两者）
    const sheetName = schema.source?.sheet ?? schema.sheet

    const schemaNode: CustomNode = {
      id,
      type: isJsonSchema ? 'jsonSchema' : 'schema',
      position: { x: 80 + (idx % 3) * 420, y: 80 + Math.floor(idx / 3) * 320 },
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
    nextNodes.push(schemaNode)

    const embeddedConstraints: any[] = Array.isArray(schema.constraints) ? schema.constraints : []
    const colNameToId = new Map<string, string>(cols.map((c: any) => [c.columnName, c.id]))
    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: (schemaNode.data as SchemaNodeData).tableName,
      embeddedConstraints,
      colNameToId,
      hasNode: (nodeId: string) => nextNodes.some((n) => n.id === nodeId),
      addNode: (node: CustomNode) => nextNodes.push(node),
      addConstraintEdge: (tableId: string, constraintId: string, columnId: string) => {
        const edgeId = `e-${tableId}-${constraintId}-${columnId}`
        if (nextEdges.some((e) => e.id === edgeId)) return
        nextEdges.push({
          id: edgeId,
          source: tableId,
          target: constraintId,
          sourceHandle: `source-right-${columnId}`,
          targetHandle: `target-input-${constraintId}`,
          type: 'smoothstep',
        } as unknown as Edge)
      },
    })
  })

  return { nodes: nextNodes, edges: nextEdges }
}
