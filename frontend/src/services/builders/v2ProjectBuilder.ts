/**
 * @file v2ProjectBuilder.ts
 * @description V2 项目构建器 - 统一导出入口
 */

/**
 * @file v2ProjectBuilder.ts
 * @description V2 项目构建器
 *
 * 从 graphStore.ts 提取的 V2 项目构建逻辑，
 * 负责将前端节点数据转换为后端 V2 配置格式。
 *
 * 功能：
 * 1. 构建项目清单 (manifest)
 * 2. 构建 Schema 文件
 * 3. 构建 Constraint 文件
 * 4. 构建 Regex 节点文件
 * 5. 构建全量配置
 * 6. 构建项目视图
 */

import type {
  CustomNode,
  SchemaNodeData,
  RegexNodeData,
  TransformNodeData,
  JsonSchemaNodeData,
  JsonSchemaColumn,
} from '@/types/graph'
import type {
  ProjectManifestV2,
  TableSchemaFileV2,
  ColumnSpecV2,
  ConstraintFileV2,
  ConstraintItemV2,
  ConstraintTypeV2,
  RegexNodeFileV2,
  TransformFileV2,
  FullConfigV2Request,
  ProjectViewV2,
} from '@/types/projectV2'
import {
  toBackendType,
  generateSchemaId,
  buildJSONOptions,
  toJsonBackendType,
} from './schemaBuilder'
import { i18n } from '@/i18n'
import {
  getV2ConstraintTypeByNodeType,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'
import { buildConstraintExportPayload } from '@/services/constraints/constraintExportAdapter'

export { buildV2Manifest } from './v2/manifestBuilder'
export { buildV2SchemaFile, buildV2JsonSchemaFile } from './v2/schemaBuilder'
export { buildSchemaIdByNodeId } from './v2/manifestBuilder'

import { buildV2Manifest as _buildV2Manifest } from './v2/manifestBuilder'
import { buildV2SchemaFile as _buildV2SchemaFile } from './v2/schemaBuilder'
import { buildSchemaIdByNodeId } from './v2/manifestBuilder'

const buildV2Manifest = _buildV2Manifest
const buildV2SchemaFile = _buildV2SchemaFile

/**
 * 构建 V2 项目清单
 *
 * @param nodes - 图中所有节点
 * @param projectName - 项目名称
 * @param projectPath - 项目路径
 * @returns 项目清单对象
 */
export function buildV2ConstraintFile(
  nodes: CustomNode[],
  constraintNodeId: string
): ConstraintFileV2 {
  const t = i18n.global.t
  const node = nodes.find((n) => n.id === constraintNodeId && isConstraintNodeType(n.type))
  if (!node) throw new Error(t('messages.builder.constraintNodeNotFound'))

  const schemaIdByNodeId = buildSchemaIdByNodeId(nodes)
  const v2Type = getV2ConstraintTypeByNodeType(node.type)
  if (!v2Type) throw new Error('不支持的约束类型')
  const data = (node.data || {}) as Record<string, unknown>
  const { refs, params } = buildConstraintExportPayload({
    nodes,
    constraintNodeId,
    v2Type: v2Type as ConstraintTypeV2,
    data,
    schemaIdByNodeId,
  })

  return {
    version: 2,
    id: constraintNodeId,
    type: v2Type,
    enabled: true,
    description: (data.configName as string) || undefined,
    refs,
    params,
  }
}

/**
 * 构建 V2 Regex 节点文件
 *
 * @param nodes - 图中所有节点
 * @param regexNodeId - Regex 节点 ID
 * @returns Regex 节点文件对象
 */
export function buildV2RegexNodeFile(nodes: CustomNode[], regexNodeId: string): RegexNodeFileV2 {
  const node = nodes.find((n) => n.id === regexNodeId && n.type === 'regex')
  if (!node) throw new Error('未找到Regex节点')

  const data = node.data as RegexNodeData
  const schemaIdByNodeId = buildSchemaIdByNodeId(nodes)
  const normalizeSchemaId = (value?: string): string | undefined =>
    value ? schemaIdByNodeId[value] || value : value

  const usesPattern = data.uses_pattern

  return {
    version: 2,
    id: regexNodeId,
    name: data.configName || 'Regex',
    description: data.description || undefined,
    pattern: usesPattern ? undefined : data.pattern || '',
    uses_pattern: usesPattern || undefined,
    match_mode: data.matchMode || 'full',
    case_sensitive: !!data.caseSensitive,
    flags: data.flags || '',
    enabled: data.enabled !== false,
    parameters: data.parameters || [],
    rules: data.rules || [],
    source_ref: data.sourceRef
      ? {
          table_id: normalizeSchemaId(data.sourceRef.nodeId) || data.sourceRef.nodeId,
          column_id: data.sourceRef.columnId,
        }
      : undefined,
    source_column_name: data.sourceColumnName || undefined,
  }
}

/**
 * 构建 V2 Transform 文件
 *
 * @param nodes - 图中所有节点
 * @param transformNodeId - Transform 节点 ID
 * @returns Transform 文件对象
 */
export function buildV2TransformFile(
  nodes: CustomNode[],
  transformNodeId: string
): TransformFileV2 {
  const node = nodes.find((n) => n.id === transformNodeId && n.type === 'transform')
  if (!node) throw new Error('未找到Transform节点')

  const data = node.data as TransformNodeData

  return {
    version: 2,
    id: transformNodeId,
    type: data.transformType,
    enabled: data.enabled !== false,
    description: data.description || undefined,
    input_from_node: data.inputFromNode || undefined,
    input_column: data.inputColumn || undefined,
    params: data.params || {},
    output_columns: data.outputColumns || [],
  }
}

/**
 * 构建 V2 全量配置
 *
 * @param nodes - 图中所有节点
 * @param projectName - 项目名称
 * @param projectPath - 项目路径
 * @returns 全量配置对象
 */
export function buildV2FullConfig(
  nodes: CustomNode[],
  projectName: string,
  projectPath: string
): FullConfigV2Request {
  const manifest = buildV2Manifest(nodes, projectName, projectPath)

  const schemas: Record<string, TableSchemaFileV2> = {}
  for (const node of nodes) {
    // 支持普通 schema 和 jsonSchema 节点
    if (node.type !== 'schema' && node.type !== 'jsonSchema') continue
    const schemaFile = buildV2SchemaFile(nodes, node.id)
    schemas[schemaFile.id] = schemaFile
  }

  const constraints: Record<string, ConstraintFileV2> = {}
  for (const ref of manifest.constraints) {
    constraints[ref.id] = buildV2ConstraintFile(nodes, ref.id)
  }

  const regex_nodes: Record<string, RegexNodeFileV2> = {}
  for (const ref of manifest.regex_nodes || []) {
    regex_nodes[ref.id] = buildV2RegexNodeFile(nodes, ref.id)
  }

  const transforms: Record<string, TransformFileV2> = {}
  for (const ref of manifest.transforms || []) {
    transforms[ref.id] = buildV2TransformFile(nodes, ref.id)
  }

  return { manifest, schemas, constraints, regex_nodes, transforms }
}

/**
 * 构建 V2 项目视图（画布布局）
 *
 * 注意：对于 schema/jsonSchema 节点，使用 schema ID 而非 canvas UUID 作为 key。
 * 因为在 reload 时，hydrateSchemasFromV2Config 会用 schema ID 重建节点，
 * 若 view 中仍用 canvas UUID 则位置无法匹配，导致节点位置丢失（F9）。
 *
 * @param nodes - 图中所有节点
 * @returns 项目视图对象
 */
export function buildV2ProjectView(nodes: CustomNode[]): ProjectViewV2 {
  const nodePositions: Record<string, { x: number; y: number }> = {}
  const schemaIdByNodeId = buildSchemaIdByNodeId(nodes)
  for (const node of nodes) {
    // schema/jsonSchema 节点在 reload 后 ID 会变成 schema ID，
    // 因此保存视图时用 schema ID 作为 key，确保 reload 时能正确恢复位置
    const key = schemaIdByNodeId[node.id] || node.id
    nodePositions[key] = { x: node.position.x, y: node.position.y }
  }
  return { version: 1, nodes: nodePositions }
}
