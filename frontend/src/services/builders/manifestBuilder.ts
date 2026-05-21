/**
 * @file manifestBuilder.ts
 * @description V2 项目清单构建器
 *
 * 该模块负责构建 project.precis.yaml 的清单部分，
 * 包含项目元信息和所有资源的引用列表。
 *
 * 功能：
 * 1. 构建项目清单头部（版本、项目信息）
 * 2. 收集并生成 Schema 节点引用
 * 3. 收集并生成 Constraint 节点引用
 * 4. 收集并生成 Regex 节点引用
 */

import type { CustomNode, SchemaNodeData, JsonSchemaNodeData } from '@/types/graph'
import type { ProjectManifestV2, ProjectSettings, TemplateInstanceRefV2 } from '@/types/projectV2'
import { generateSchemaId } from '@/utils/typeHelpers'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

/**
 * 获取有效的项目 ID
 *
 * 清理用户输入的项目名称，移除不安全字符
 * @param projectPath - 项目路径
 * @param projectName - 项目名称
 * @returns 清理后的项目 ID
 */
export function sanitizeV2Id(input: string): string {
  return (input || 'project')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:"*?<>|]+/g, '_')
}

/**
 * 构建 V2 项目清单
 *
 * 扫描图中所有节点，生成对应的资源引用列表
 *
 * @param nodes - 图中所有节点
 * @param projectName - 项目名称
 * @param projectPath - 项目路径
 * @param schemaIdMap - 可选的 schema id 映射表（nodeId -> effectiveTableId），用于更新已有 schema 时保持原有 id
 * @returns 项目清单对象
 *
 * @example
 * ```typescript
 * const manifest = buildV2Manifest(nodes, 'MyProject', '/path/to/project');
 * ```
 */
export function buildV2Manifest(
  nodes: CustomNode[],
  projectName: string,
  projectPath: string,
  schemaIdMap?: Record<string, string>
): ProjectManifestV2 {
  const projectId = sanitizeV2Id(projectPath?.split(/[/\\]/).pop() || projectName || 'project')

  const schemaRefs = nodes
    // 支持普通 schema 和 jsonSchema 节点
    .filter((n) => n.type === 'schema' || n.type === 'jsonSchema')
    .map((n) => {
      const isJsonSchema = n.type === 'jsonSchema'
      const data = n.data as SchemaNodeData | JsonSchemaNodeData
      // JSON Schema 没有 sheetName
      const sheetName = isJsonSchema ? undefined : (data as SchemaNodeData).sheetName
      const computedId = generateSchemaId(data.sourceFilePath || data.sourceFile || '', sheetName)
      const effectiveId = schemaIdMap?.[n.id] || computedId || n.id
      const schemaName = data.tableName
      return { id: effectiveId, path: `schemas/${schemaName}.schema.yaml` }
    })

  const constraintRefs = nodes
    .filter(
      (n) =>
        isConstraintNodeType(n.type) && !(n.data as unknown as Record<string, unknown>)?.embedded
    )
    .map((n) => ({ id: n.id, path: `constraints/${n.id}.constraint.yaml` }))

  const regexRefs = nodes
    .filter((n) => n.type === 'regex')
    .map((n) => ({ id: n.id, path: `regex/${n.id}.regex.yaml` }))

  const transformRefs = nodes
    .filter((n) => n.type === 'transform')
    .map((n) => ({ id: n.id, path: `transforms/${n.id}.transform.yaml` }))

  const templateInstanceRefs: TemplateInstanceRefV2[] = nodes
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

  const defaultSettings: ProjectSettings = {
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
  }

  return {
    version: 2,
    project: { id: projectId, name: projectName || 'untitled' },
    settings: defaultSettings,
    schemas: schemaRefs,
    constraints: constraintRefs,
    regex_nodes: regexRefs,
    transforms: transformRefs,
    template_instances: templateInstanceRefs.length > 0 ? templateInstanceRefs : undefined,
    patterns_dir: 'patterns',
  }
}
