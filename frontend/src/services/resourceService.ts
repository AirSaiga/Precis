/**
 * @file resourceService.ts
 * @description 资源操作服务层
 *
 * 服务职责：
 * - 封装所有资源相关的API调用
 * - 统一错误处理
 * - 提供数据转换逻辑
 */

import type {
  ResourceItem,
  SchemaResource,
  PatternResource,
  ConstraintResource,
  RegexNodeResource,
  ResourceOperationResult,
  EmbeddedConstraintResource,
  ColumnImplicitRegexInfo,
} from '@/types/resource'
import type { FullConfigV2Response, ProjectManifestV2 } from '@/types/projectV2'
import * as projectV2Api from '@/api/projectV2Api'

/**
 * 资源操作服务接口
 */
export interface IResourceService {
  // === 资源加载 ===

  /** 加载完整配置 */
  loadFullConfig(configPath: string): Promise<FullConfigV2Response>

  /** 解析资源列表 */
  parseResources(fullConfig: FullConfigV2Response): ResourceItem[]

  // === 资源预览 ===

  /** 预览资源 */
  previewResource(
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node',
    resourceId: string,
    configPath: string
  ): Promise<unknown>

  // === 资源重命名 ===

  /** 重命名Schema */
  renameSchema(schemaId: string, newName: string, configPath: string): Promise<void>

  /** 重命名Pattern */
  renamePattern(patternId: string, newName: string, configPath: string): Promise<void>

  /** 重命名Constraint */
  renameConstraint(constraintId: string, newName: string, configPath: string): Promise<void>

  // === 资源删除 ===

  /** 删除Schema */
  deleteSchema(schemaId: string, configPath: string): Promise<void>

  /** 删除Pattern */
  deletePattern(patternId: string, configPath: string): Promise<void>

  /** 删除RegexNode */
  deleteRegexNode(regexId: string, configPath: string): Promise<void>

  /** 删除Constraint */
  deleteConstraint(constraintId: string, configPath: string): Promise<void>
}

/**
 * 资源操作服务实现
 */
export class ResourceService implements IResourceService {
  /**
   * 缓存 fullConfig 数据，用于预览时直接获取数据
   */
  private cachedFullConfig: FullConfigV2Response | null = null

  /**
   * 加载完整配置
   *
   * @param configPath - 项目配置文件路径
   * @returns 项目完整配置响应
   */
  async loadFullConfig(configPath: string): Promise<FullConfigV2Response> {
    const fullConfig = await projectV2Api.getV2FullConfig(configPath)
    this.cachedFullConfig = fullConfig
    return fullConfig
  }

  /**
   * 解析资源列表
   *
   * 将后端返回的完整配置解析为前端资源树所需的 ResourceItem 数组。
   * 处理 Schema、Pattern、RegexNode、Constraint 四类资源，并建立关联关系。
   *
   * @param fullConfig - 后端返回的完整配置
   * @returns 资源项数组
   */
  parseResources(fullConfig: FullConfigV2Response): ResourceItem[] {
    const manifest = fullConfig.manifest
    const effectiveManifest = fullConfig.effective_manifest || manifest
    const resources: ResourceItem[] = []
    const listedSchemaIds = new Set((manifest.schemas || []).map((r) => r.id))
    const listedConstraintIds = new Set((manifest.constraints || []).map((r) => r.id))
    const listedRegexNodeIds = new Set((manifest.regex_nodes || []).map((r) => r.id))

    // 收集 schema 解析错误
    const schemaErrors: Record<string, string> =
      ((fullConfig as unknown as Record<string, unknown>).schema_errors as Record<
        string,
        string
      >) || {}

    // 收集所有 independent constraints 的 ID 和关联表
    const independentConstraintMap: Record<string, { tableId?: string; columnId?: string }> = {}
    if (effectiveManifest.constraints && Array.isArray(effectiveManifest.constraints)) {
      for (const ref of effectiveManifest.constraints) {
        const constraint = fullConfig.constraints?.[ref.id] as
          | { refs?: { table_id?: string; column_ids?: string[] } }
          | undefined
        independentConstraintMap[ref.id] = {
          tableId: constraint?.refs?.table_id,
          columnId: constraint?.refs?.column_ids?.[0],
        }
      }
    }

    // 收集 embedded constraints
    const embeddedConstraintMap: Record<string, string> = {}
    if (effectiveManifest.schemas && Array.isArray(effectiveManifest.schemas)) {
      for (const ref of effectiveManifest.schemas) {
        const schema = fullConfig.schemas?.[ref.id]
        if (schema?.constraints && Array.isArray(schema.constraints)) {
          for (const ec of schema.constraints) {
            // 防止重复拼接 schemaId (如果 ec.id 已经包含了 schemaId 前缀)
            const ecId = ec.id.startsWith(`${ref.id}_`) ? ec.id : `${ref.id}_${ec.id}`
            embeddedConstraintMap[ecId] = ref.id
          }
        }
      }
    }

    // 收集所有 Regex 节点及其关联的表/列
    const regexNodeMap: Record<string, { tableId?: string; columnId?: string }> = {}
    if (fullConfig.regex_nodes) {
      for (const [id, node] of Object.entries(fullConfig.regex_nodes)) {
        const regexNode = node as { uses_pattern?: { table_id?: string; column_id?: string } }
        regexNodeMap[id] = {
          tableId: regexNode?.uses_pattern?.table_id,
          columnId: regexNode?.uses_pattern?.column_id,
        }
      }
    }

    // 解析Schemas 并关联 Regex 节点和 Constraints
    if (effectiveManifest.schemas && Array.isArray(effectiveManifest.schemas)) {
      for (const ref of effectiveManifest.schemas) {
        const schema = fullConfig.schemas?.[ref.id]
        const listedInManifest = listedSchemaIds.has(ref.id)
        const parseError = schemaErrors[ref.id]

        // 收集关联的 Regex 节点
        const associatedRegexIds: string[] = []
        for (const [regexId, info] of Object.entries(regexNodeMap)) {
          if (info.tableId === ref.id) {
            associatedRegexIds.push(regexId)
          }
        }

        // 收集关联的 Constraints (包括 embedded 和 independent)
        const associatedConstraintIds: string[] = []

        // Embedded constraints
        for (const ecId of Object.keys(embeddedConstraintMap)) {
          if (embeddedConstraintMap[ecId] === ref.id) {
            associatedConstraintIds.push(ecId)
          }
        }

        // Independent constraints
        for (const [cId, info] of Object.entries(independentConstraintMap)) {
          if (info.tableId === ref.id) {
            associatedConstraintIds.push(cId)
          }
        }

        // 收集内嵌约束作为子节点
        const embeddedConstraints: EmbeddedConstraintResource[] = []
        if (schema?.constraints && Array.isArray(schema.constraints)) {
          for (const ec of schema.constraints) {
            // 防止重复拼接 schemaId (如果 ec.id 已经包含了 schemaId 前缀)
            const resourceId = ec.id.startsWith(`${ref.id}_`) ? ec.id : `${ref.id}_${ec.id}`
            embeddedConstraints.push({
              id: resourceId,
              name: ec.description || ec.type || ec.id,
              constraintType: ec.type || 'unknown',
              description: ec.description,
              columnId: ec.column,
              parentSchemaId: ref.id,
            })
          }
        }

        // 收集隐式正则字段信息
        const implicitRegexFields: ColumnImplicitRegexInfo[] = []
        if (schema?.columns && Array.isArray(schema.columns)) {
          for (const col of schema.columns) {
            const colData = col as {
              id?: string
              name?: string
              type?: unknown
              validator?: string
              implicit?: boolean
            }
            const colType = colData.type
            // 隐式正则：type 为 regex 但没有明确指定 validator
            const isImplicit =
              colType === 'regex' &&
              !colData.validator &&
              (colData.implicit === true || !colData.validator)
            if (isImplicit || (colType === 'regex' && !colData.validator)) {
              implicitRegexFields.push({
                columnId: colData.id || '',
                columnName: colData.name || '',
                isImplicit: true,
                inferredPatternId: undefined, // 运行时推断
              })
            }
          }
        }

        resources.push({
          id: ref.id,
          name: schema?.name || ref.id,
          kind: 'schema',
          path: ref.path,
          meta: { listedInManifest, parseError },
          tableName: schema?.name,
          associatedRegexIds,
          associatedConstraintIds,
          embeddedConstraints,
          implicitRegexFields,
        } as SchemaResource)
      }
    }

    // 解析正则表达式注册表 (regex_registries)
    // 来自 patterns/ 目录
    if (fullConfig.regex_registries) {
      for (const [key, value] of Object.entries(fullConfig.regex_registries)) {
        const registryData = value as { id: string; registry: string; definition: unknown }
        const [registryType, patternId] = key.includes('/')
          ? key.split('/', 2)
          : [registryData.registry || 'patterns', registryData.id]

        resources.push({
          id: key,
          name: patternId,
          kind: 'pattern',
          path: `${registryType}/${patternId}.yaml`,
          meta: {
            registry: registryType,
            definition: registryData.definition,
          },
          registry: registryType as 'patterns',
        })
      }
    }

    // 解析正则表达式节点 (regex_nodes)
    // 来自 manifest.regex_nodes 或 regex/ 目录
    // 注意：空数组 [] 也需要扫描目录
    if (
      effectiveManifest.regex_nodes &&
      Array.isArray(effectiveManifest.regex_nodes) &&
      effectiveManifest.regex_nodes.length > 0
    ) {
      for (const ref of effectiveManifest.regex_nodes) {
        const regexNode = fullConfig.regex_nodes?.[ref.id]

        resources.push({
          id: ref.id,
          name: regexNode?.name || ref.id,
          kind: 'regex_node',
          path: ref.path,
          meta: {
            listedInManifest: listedRegexNodeIds.has(ref.id),
            usesPattern: regexNode?.uses_pattern,
            pattern: regexNode?.pattern,
          },
        } as RegexNodeResource)
      }
    }

    // 解析Constraints
    if (effectiveManifest.constraints && Array.isArray(effectiveManifest.constraints)) {
      for (const ref of effectiveManifest.constraints) {
        const constraint = fullConfig.constraints?.[ref.id]
        resources.push({
          id: ref.id,
          name: constraint?.description || constraint?.type || ref.id,
          kind: 'constraint',
          path: ref.path,
          meta: {
            listedInManifest: listedConstraintIds.has(ref.id),
            constraintType: constraint?.type,
          },
          constraintType: constraint?.type || 'unknown',
          description: constraint?.description,
          constraintSource: 'independent',
        })
      }
    }

    // 解析 Schemas 并收集 embedded constraints
    if (effectiveManifest.schemas && Array.isArray(effectiveManifest.schemas)) {
      const embeddedConstraintIds: string[] = []
      for (const ref of effectiveManifest.schemas) {
        const schema = fullConfig.schemas?.[ref.id]
        const parentListed = listedSchemaIds.has(ref.id)
        if (schema?.constraints && Array.isArray(schema.constraints)) {
          for (const ec of schema.constraints) {
            const ecId = `${ref.id}_${ec.id}`
            embeddedConstraintIds.push(ecId)
            resources.push({
              id: ecId,
              name: ec.description || ec.type || ec.id,
              kind: 'constraint',
              path: ref.path,
              meta: {
                listedInManifest: parentListed,
                constraintType: ec.type,
                embeddedInSchema: ref.id,
              },
              constraintType: ec.type || 'unknown',
              description: ec.description,
              constraintSource: 'embedded',
            })
          }
        }
      }
    }

    return resources
  }

  /**
   * 预览资源
   *
   * 根据资源类型调用对应 API 获取资源详情。
   *
   * @param resourceKind - 资源类型：schema / pattern / constraint / regex_node
   * @param resourceId - 资源唯一标识
   * @param configPath - 项目配置文件路径
   * @returns 资源详情对象
   * @throws 当资源类型不支持或缓存未加载时抛出错误
   */
  async previewResource(
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node',
    resourceId: string,
    configPath: string
  ): Promise<unknown> {
    switch (resourceKind) {
      case 'schema':
        return projectV2Api.getV2Schema(resourceId, configPath)
      case 'pattern':
        return this.getPatternFromCache(resourceId)
      case 'regex_node':
        return projectV2Api.getV2RegexNode(resourceId, configPath)
      case 'constraint':
        return projectV2Api.getV2Constraint(resourceId, configPath)
      default:
        throw new Error(`Unsupported resource kind: ${resourceKind}`)
    }
  }

  /**
   * 从缓存中获取 pattern (regex_registries) 数据
   *
   * @param resourceId - Pattern 资源标识
   * @returns Pattern 定义数据
   * @throws 当缓存未加载或 Pattern 不存在时抛出错误
   */
  private getPatternFromCache(resourceId: string): unknown {
    if (!this.cachedFullConfig?.regex_registries) {
      throw new Error('Regex registries not loaded. Please load full config first.')
    }
    const registryData = this.cachedFullConfig.regex_registries[resourceId]
    if (!registryData) {
      throw new Error(`Pattern not found: ${resourceId}`)
    }
    return registryData
  }

  /**
   * 重命名 Schema
   *
   * @param schemaId - Schema ID
   * @param newName - 新名称
   * @param configPath - 项目配置文件路径
   */
  async renameSchema(schemaId: string, newName: string, configPath: string): Promise<void> {
    await projectV2Api.updateV2SchemaDisplayName(schemaId, newName, configPath)
  }

  /**
   * 重命名 Pattern
   *
   * @param patternId - Pattern ID
   * @param newName - 新名称
   * @param configPath - 项目配置文件路径
   */
  async renamePattern(patternId: string, newName: string, configPath: string): Promise<void> {
    await projectV2Api.updateV2RegexNodeDisplayName(patternId, newName, configPath)
  }

  /**
   * 重命名 Constraint
   *
   * @param constraintId - Constraint ID
   * @param newName - 新名称
   * @param configPath - 项目配置文件路径
   */
  async renameConstraint(constraintId: string, newName: string, configPath: string): Promise<void> {
    await projectV2Api.updateV2ConstraintDisplayName(constraintId, newName, configPath)
  }

  /**
   * 删除 Schema
   *
   * @param schemaId - Schema ID
   * @param configPath - 项目配置文件路径
   */
  async deleteSchema(schemaId: string, configPath: string): Promise<void> {
    await projectV2Api.deleteV2Schema(schemaId, configPath)
  }

  /**
   * 删除 Pattern
   *
   * @param patternId - Pattern ID
   * @param configPath - 项目配置文件路径
   */
  async deletePattern(patternId: string, configPath: string): Promise<void> {
    await projectV2Api.deleteV2RegexNode(patternId, configPath)
  }

  /**
   * 删除 RegexNode
   *
   * @param regexId - Regex 节点 ID
   * @param configPath - 项目配置文件路径
   */
  async deleteRegexNode(regexId: string, configPath: string): Promise<void> {
    await projectV2Api.deleteV2RegexNode(regexId, configPath)
  }

  /**
   * 删除 Constraint
   *
   * @param constraintId - Constraint ID
   * @param configPath - 项目配置文件路径
   */
  async deleteConstraint(constraintId: string, configPath: string): Promise<void> {
    await projectV2Api.deleteV2Constraint(constraintId, configPath)
  }
}

// 导出单例
export const resourceService = new ResourceService()
