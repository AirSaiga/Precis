/**
 * @fileoverview Save Plan Builder
 *
 * 将画布节点集合转换为 SavePlan。
 *
 * 处理流程：
 * 1. 过滤持久化节点（排除模板展开预览）
 * 2. 构建 schema ID 映射
 * 3. 分类 schema/constraint/regex/transform/templateInstance 节点
 * 4. 约束节点进一步分为内嵌（写入 schema）和独立（写入 constraints/）
 * 5. 使用注册的 builder 逐个构建 V2 文件对象
 * 6. 组装 manifest
 */

import type { CustomNode } from '@/types/graph'
import type { ProjectManifestV2 } from '@/types/projectV2'
import { sanitizeV2Id } from '@/utils/typeHelpers'
import { findBuildersByKind } from './builders/registry'
import { buildEmbeddedConstraintItem } from './embedders/embeddedConstraintBuilder'
import { classifyConstraints } from './embedders/embeddedSelector'
import { filterPersistentNodes, buildSchemaIdByNodeId } from './utils'
import type { SavePlan, SchemaFilePlan, PreValidationError } from './types'

export interface BuildSavePlanOptions {
  projectName: string
  projectPath: string
}

/**
 * 构建 SavePlan
 */
export function buildSavePlan(nodes: CustomNode[], options: BuildSavePlanOptions): SavePlan {
  const persistentNodes = filterPersistentNodes(nodes)
  const schemaIdByNodeId = buildSchemaIdByNodeId(persistentNodes)
  const errors: PreValidationError[] = []

  // 分类节点
  const schemaNodes = persistentNodes.filter((n) => n.type === 'schema' || n.type === 'jsonSchema')
  const constraintNodes = persistentNodes.filter(
    (n) => typeof n.type === 'string' && n.type.endsWith('Constraint')
  )
  const regexNodes = persistentNodes.filter((n) => n.type === 'regex')
  const transformNodes = persistentNodes.filter((n) => n.type === 'transform')
  const templateInstanceNodes = persistentNodes.filter((n) => n.type === 'templateInstance')

  // 约束分类：内嵌 vs 独立
  const { embedded: embeddedConstraintNodes, standalone: standaloneConstraintNodes } =
    classifyConstraints(constraintNodes, schemaNodes)

  // 构建 schema 文件计划
  const schemas = new Map<string, SchemaFilePlan>()
  const schemaBuilder = findBuildersByKind('schema')[0]
  if (!schemaBuilder) {
    errors.push({
      severity: 'BLOCKER',
      nodeId: '',
      message: '未找到 schema builder',
    })
  } else {
    for (const node of schemaNodes) {
      const { file } = schemaBuilder.build({
        nodes: persistentNodes,
        node,
        schemaIdByNodeId,
        configPath: options.projectPath,
      }) as { consumed: boolean; file: import('@/types/projectV2').TableSchemaFileV2 }

      schemas.set(file.id, {
        schemaFile: file,
        embeddedConstraintIds: [],
      })
    }
  }

  // 将内嵌约束附加到对应 schema
  // 注意：schemaBuilder 可能已预先收集部分内嵌约束（children/legacy embedded），
  // 这里使用 Set 去重，避免单节点保存路径和完整保存路径产生重复。
  for (const node of embeddedConstraintNodes) {
    try {
      const item = buildEmbeddedConstraintItem(node)
      const sourceRef = (node.data as any).sourceRef
      const targetSchemaNode = sourceRef?.nodeId
        ? schemaNodes.find((n) => n.id === sourceRef.nodeId)
        : undefined

      if (!targetSchemaNode) {
        errors.push({
          severity: 'WARNING',
          nodeId: node.id,
          message: `内嵌约束 ${node.id} 无法找到目标 schema，将降级为独立保存`,
        })
        standaloneConstraintNodes.push(node)
        continue
      }

      const schemaFilePlan = schemas.get(schemaIdByNodeId[targetSchemaNode.id]!)
      if (schemaFilePlan) {
        schemaFilePlan.schemaFile.constraints = schemaFilePlan.schemaFile.constraints || []
        const existingIds = new Set(schemaFilePlan.schemaFile.constraints.map((c) => c.id))
        if (!existingIds.has(item.id)) {
          schemaFilePlan.schemaFile.constraints.push(item)
        }
        if (!schemaFilePlan.embeddedConstraintIds.includes(node.id)) {
          schemaFilePlan.embeddedConstraintIds.push(node.id)
        }
      }
    } catch (err) {
      errors.push({
        severity: 'WARNING',
        nodeId: node.id,
        message: err instanceof Error ? err.message : '构建内嵌约束失败',
      })
      standaloneConstraintNodes.push(node)
    }
  }

  // 构建独立约束文件
  const constraints = new Map<string, import('@/types/projectV2').ConstraintFileV2>()
  const constraintBuilders = findBuildersByKind('constraint')
  for (const node of standaloneConstraintNodes) {
    const builder = constraintBuilders.find((b) => b.matches(node))
    if (!builder) {
      errors.push({
        severity: 'WARNING',
        nodeId: node.id,
        message: `未找到约束 builder: ${node.type}`,
      })
      continue
    }
    const { file } = builder.build({
      nodes: persistentNodes,
      node,
      schemaIdByNodeId,
      configPath: options.projectPath,
    }) as { consumed: boolean; file: import('@/types/projectV2').ConstraintFileV2 }
    constraints.set(file.id, file)
  }

  // 构建 regex 文件
  const regexes = new Map<string, import('@/types/projectV2').RegexNodeFileV2>()
  const regexBuilder = findBuildersByKind('regex')[0]
  if (regexBuilder) {
    for (const node of regexNodes) {
      const { file } = regexBuilder.build({
        nodes: persistentNodes,
        node,
        schemaIdByNodeId,
        configPath: options.projectPath,
      }) as { consumed: boolean; file: import('@/types/projectV2').RegexNodeFileV2 }
      regexes.set(file.id, file)
    }
  }

  // 构建 transform 文件
  const transforms = new Map<string, import('@/types/projectV2').TransformFileV2>()
  const transformBuilder = findBuildersByKind('transform')[0]
  if (transformBuilder) {
    for (const node of transformNodes) {
      const { file } = transformBuilder.build({
        nodes: persistentNodes,
        node,
        schemaIdByNodeId,
        configPath: options.projectPath,
      }) as { consumed: boolean; file: import('@/types/projectV2').TransformFileV2 }
      transforms.set(file.id, file)
    }
  }

  // 构建 template instance 引用
  const templateInstances = new Map<string, import('@/types/projectV2').TemplateInstanceRefV2>()
  const templateInstanceBuilder = findBuildersByKind('templateInstance')[0]
  if (templateInstanceBuilder) {
    for (const node of templateInstanceNodes) {
      const { file } = templateInstanceBuilder.build({
        nodes: persistentNodes,
        node,
        schemaIdByNodeId,
        configPath: options.projectPath,
      }) as { consumed: boolean; file: import('@/types/projectV2').TemplateInstanceRefV2 }
      templateInstances.set(file.id, file)
    }
  }

  // 构建 manifest
  const manifest: ProjectManifestV2 = {
    version: 2,
    project: {
      id: sanitizeV2Id(
        options.projectPath.split(/[/\\]/).pop() || options.projectName || 'project'
      ),
      name: options.projectName || 'untitled',
    },
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
    schemas: Array.from(schemas.entries()).map(([id, plan]) => ({
      id,
      path: `schemas/${plan.schemaFile.name}.schema.yaml`,
    })),
    constraints: Array.from(constraints.keys()).map((id) => ({
      id,
      path: `constraints/${id}.constraint.yaml`,
    })),
    regex_nodes: Array.from(regexes.keys()).map((id) => ({
      id,
      path: `regex/${id}.regex.yaml`,
    })),
    transforms: Array.from(transforms.keys()).map((id) => ({
      id,
      path: `transforms/${id}.transform.yaml`,
    })),
    template_instances:
      templateInstances.size > 0 ? Array.from(templateInstances.values()) : undefined,
    patterns_dir: 'patterns',
  }

  return {
    manifest,
    schemas,
    constraints,
    regexes,
    transforms,
    templateInstances,
    errors,
  }
}

/**
 * 收集目标节点的所有依赖节点（递归）
 *
 * 例如：
 * - 约束节点 → 引用的 schema 节点
 * - schema 节点 → 其内嵌约束节点
 * - transform/templateInstance → input_from_node 引用的节点
 */
function collectDependencies(targetNode: CustomNode, allNodes: CustomNode[]): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = [targetNode.id]

  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)

    const node = allNodes.find((n) => n.id === currentId)
    if (!node) continue

    const data = (node.data || {}) as Record<string, unknown>

    // 约束节点：sourceRef → schema 节点
    const sourceRef = data.sourceRef as { nodeId?: string } | undefined
    if (sourceRef?.nodeId && !visited.has(sourceRef.nodeId)) {
      queue.push(sourceRef.nodeId)
    }

    // ForeignKey：targetRef → schema 节点
    const targetRef = data.targetRef as { nodeId?: string } | undefined
    if (targetRef?.nodeId && !visited.has(targetRef.nodeId)) {
      queue.push(targetRef.nodeId)
    }

    // Transform：inputFromNode → 前置节点
    const inputFromNode = data.inputFromNode as string | undefined
    if (inputFromNode && !visited.has(inputFromNode)) {
      queue.push(inputFromNode)
    }

    // TemplateInstance：inputFromNode → 前置节点
    const templateInput = data.inputFromNode as string | undefined
    if (templateInput && !visited.has(templateInput)) {
      queue.push(templateInput)
    }

    // Conditional：thenRef / ifRef → schema 节点
    const thenRef = data.thenRef as { nodeId?: string } | undefined
    if (thenRef?.nodeId && !visited.has(thenRef.nodeId)) {
      queue.push(thenRef.nodeId)
    }

    const ifRef = data.ifRef as { nodeId?: string } | undefined
    if (ifRef?.nodeId && !visited.has(ifRef.nodeId)) {
      queue.push(ifRef.nodeId)
    }

    // Composite：includedNodeIds → 子约束节点
    const includedNodeIds = data.includedNodeIds as string[] | undefined
    if (Array.isArray(includedNodeIds)) {
      for (const id of includedNodeIds) {
        if (!visited.has(id)) queue.push(id)
      }
    }
  }

  return visited
}

/**
 * 从全部节点快速构建完整 manifest（不构建文件内容）
 *
 * 用于增量保存时保留其他资源的引用，避免构建完整 SavePlan 的开销。
 */
function buildFullManifest(nodes: CustomNode[], options: BuildSavePlanOptions): ProjectManifestV2 {
  const persistent = filterPersistentNodes(nodes)
  const schemaIdByNodeId = buildSchemaIdByNodeId(persistent)

  const schemaNodes = persistent.filter((n) => n.type === 'schema' || n.type === 'jsonSchema')
  const constraintNodes = persistent.filter(
    (n) => typeof n.type === 'string' && n.type.endsWith('Constraint')
  )
  const regexNodes = persistent.filter((n) => n.type === 'regex')
  const transformNodes = persistent.filter((n) => n.type === 'transform')
  const templateInstanceNodes = persistent.filter((n) => n.type === 'templateInstance')

  const { embedded: embeddedConstraintNodes } = classifyConstraints(constraintNodes, schemaNodes)
  const embeddedIds = new Set(embeddedConstraintNodes.map((n) => n.id))

  const schemas = schemaNodes.map((n) => {
    const id = schemaIdByNodeId[n.id] || n.id
    const data = n.data as { tableName?: string }
    return { id, path: `schemas/${data.tableName || id}.schema.yaml` }
  })

  const constraints = constraintNodes
    .filter((n) => !embeddedIds.has(n.id))
    .map((n) => ({ id: n.id, path: `constraints/${n.id}.constraint.yaml` }))

  const regexRefs = regexNodes.map((n) => ({ id: n.id, path: `regex/${n.id}.regex.yaml` }))
  const transformRefs = transformNodes.map((n) => ({
    id: n.id,
    path: `transforms/${n.id}.transform.yaml`,
  }))
  const templateRefs = templateInstanceNodes.map((n) => {
    const data = (n.data || {}) as Record<string, unknown>
    return {
      id: n.id,
      template_id: (data.templateId as string) || '',
      enabled: data.enabled !== false,
      input_from_node: (data.inputFromNode as string) || '',
      params: (data.parameters as Record<string, unknown>) || {},
    }
  })

  return {
    version: 2,
    project: {
      id: sanitizeV2Id(
        options.projectPath.split(/[/\\]/).pop() || options.projectName || 'project'
      ),
      name: options.projectName || 'untitled',
    },
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
    schemas,
    constraints,
    regex_nodes: regexRefs,
    transforms: transformRefs,
    template_instances: templateRefs.length > 0 ? templateRefs : undefined,
    patterns_dir: 'patterns',
  }
}

/**
 * 构建增量 SavePlan（只包含目标节点及其依赖）
 */
export function buildIncrementalSavePlan(
  nodes: CustomNode[],
  options: BuildSavePlanOptions,
  targetNodeId: string
): SavePlan {
  const targetNode = nodes.find((n) => n.id === targetNodeId)
  if (!targetNode) {
    return buildSavePlan(nodes, options)
  }

  const dependencyIds = collectDependencies(targetNode, nodes)
  const relatedNodes = nodes.filter((n) => dependencyIds.has(n.id))

  // 如果是 schema 节点，还要包含其内嵌约束
  if (targetNode.type === 'schema' || targetNode.type === 'jsonSchema') {
    const embeddedConstraints = nodes.filter(
      (n) =>
        typeof n.type === 'string' &&
        n.type.endsWith('Constraint') &&
        (n.data as any)?.sourceRef?.nodeId === targetNode.id
    )
    for (const ec of embeddedConstraints) {
      if (!dependencyIds.has(ec.id)) {
        relatedNodes.push(ec)
        dependencyIds.add(ec.id)
      }
    }
  }

  // 增量 plan 只构建目标节点相关的文件
  const incrementalPlan = buildSavePlan(relatedNodes, options)

  // manifest 必须包含全部节点引用（避免丢失其他资源）
  // 使用轻量级构建，不触发 builder 文件生成
  const fullManifest = buildFullManifest(nodes, options)

  return {
    ...incrementalPlan,
    manifest: fullManifest,
    errors: incrementalPlan.errors,
  }
}
