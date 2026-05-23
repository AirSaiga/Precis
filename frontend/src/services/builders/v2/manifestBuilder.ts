/**
 * @file v2/manifestBuilder.ts
 * @description V2 项目清单构建器
 *
 * 从 v2ProjectBuilder.ts 提取的清单构建逻辑，
 * 负责构建 project.precis.yaml 的清单部分。
 *
 * 功能：
 * 1. buildV2Manifest: 构建项目清单
 */

import type {
  CustomNode,
  SchemaNodeData,
  RegexNodeData,
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
  FullConfigV2Request,
  ProjectViewV2,
  TemplateInstanceRefV2,
} from '@/types/projectV2'
import {
  toBackendType,
  generateSchemaId,
  buildJSONOptions,
  toJsonBackendType,
} from '../schemaBuilder'
import { useI18n } from 'vue-i18n'
import {
  getV2ConstraintTypeByNodeType,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'
import { buildConstraintExportPayload } from '@/services/constraints/constraintExportAdapter'

function getI18nText(): (key: string) => string {
  const { t } = useI18n()
  return t
}

function buildSchemaIdByNodeId(nodes: CustomNode[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of nodes) {
    if (n.type === 'schema') {
      const data = n.data as SchemaNodeData
      const schemaId = generateSchemaId(
        data.sourceFilePath || data.sourceFile || '',
        data.sheetName
      )
      map[n.id] = schemaId
    } else if (n.type === 'jsonSchema') {
      const data = n.data as JsonSchemaNodeData
      const schemaId = generateSchemaId(data.sourceFilePath || data.sourceFile || '', undefined)
      map[n.id] = schemaId
    }
  }
  return map
}

/**
 * 构建 V2 项目清单
 *
 * @param nodes - 图中所有节点
 * @param projectName - 项目名称
 * @param projectPath - 项目路径
 * @returns 项目清单对象
 */
export function buildV2Manifest(
  nodes: CustomNode[],
  projectName: string,
  projectPath: string,
  schemaIdMap?: Record<string, string>
): ProjectManifestV2 {
  // 过滤模板展开预览节点（不应持久化到清单）
  const persistentNodes = nodes.filter(
    (n) => !(n.data as unknown as Record<string, unknown>)?._expandedFromInstanceId
  )

  const projectId = (projectPath?.split(/[/\\]/).pop() || projectName || 'project')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:"*?<>|]+/g, '_')

  const schemaRefs = persistentNodes
    // 支持普通 schema 和 jsonSchema 节点
    .filter((n) => n.type === 'schema' || n.type === 'jsonSchema')
    .map((n) => {
      const isJsonSchema = n.type === 'jsonSchema'
      const data = n.data as SchemaNodeData | JsonSchemaNodeData
      // JSON Schema 没有 sheetName
      const sheetName = isJsonSchema ? undefined : (data as SchemaNodeData).sheetName
      const schemaId = generateSchemaId(data.sourceFilePath || data.sourceFile || '', sheetName)
      const effectiveId = schemaIdMap?.[n.id] || schemaId || n.id
      const schemaName = data.tableName
      return { id: effectiveId, path: `schemas/${schemaName}.schema.yaml` }
    })

  const constraintRefs = persistentNodes
    .filter((n) => isConstraintNodeType(n.type) && !(n.data as { embedded?: boolean })?.embedded)
    .map((n) => ({ id: n.id, path: `constraints/${n.id}.constraint.yaml` }))

  const regexRefs = persistentNodes
    .filter((n) => n.type === 'regex')
    .map((n) => ({ id: n.id, path: `regex/${n.id}.regex.yaml` }))

  const transformRefs = persistentNodes
    .filter((n) => n.type === 'transform')
    .map((n) => ({ id: n.id, path: `transforms/${n.id}.transform.yaml` }))

  const templateInstanceRefs = persistentNodes
    .filter((n) => n.type === 'templateInstance')
    .map((n) => {
      const d = n.data as unknown as Record<string, unknown>
      return {
        id: n.id,
        template_id: String(d.templateId || ''),
        enabled: d.enabled !== false,
        input_from_node: String(d.inputFromNode || ''),
        params: (d.parameters as Record<string, unknown>) || {},
      }
    })

  return {
    version: 2,
    project: { id: projectId, name: projectName || 'untitled' },
    settings: {
      validation: {
        auto_validate: true,
        strict_mode: false,
        error_handling: 'continue',
        timeout_seconds: 30,
        batch_max_files: 100,
      },
      file_processing: {
        default_encoding: 'utf-8',
        csv_delimiter: ',',
        null_value_strategy: 'null',
        date_format: '%Y-%m-%d',
      },
      script_security: {
        allow_eval: false,
        allow_exec: false,
        sandbox_mode: true,
        timeout_seconds: 10,
      },
    },
    schemas: schemaRefs,
    constraints: constraintRefs,
    regex_nodes: regexRefs,
    transforms: transformRefs,
    template_instances: templateInstanceRefs.length > 0 ? templateInstanceRefs : undefined,
    patterns_dir: 'patterns',
  }
}

/**
 * 构建 V2 Schema 文件
 *
 * 支持普通 Schema 节点和 JSON Schema 节点
 *
 * @param nodes - 图中所有节点
 * @param schemaNodeId - Schema 节点 ID
 * @returns Schema 文件对象
 */
