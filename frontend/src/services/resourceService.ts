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
  RegexNodeResource,
  TemplateResource,
  EmbeddedConstraintResource,
  ColumnImplicitRegexInfo,
} from '@/types/resource'
import type { FullConfigV2Response } from '@/types/projectV2'
import * as projectV2Api from '@/api/projectV2Api'

/**
 * 资源操作服务接口
 *
 * 定义资源树所需的全部 CRUD 操作，包括加载、解析、预览、重命名和删除。
 * 实现类负责封装 API 调用、缓存管理和数据转换。
 */
export interface IResourceService {
  // === 资源加载 ===

  /** 从后端加载项目完整配置 */
  loadFullConfig(configPath: string): Promise<FullConfigV2Response>

  /** 将后端完整配置解析为前端资源树所需的 ResourceItem 数组 */
  parseResources(fullConfig: FullConfigV2Response): ResourceItem[]

  // === 资源预览 ===

  /** 根据资源类型调用对应 API 获取资源详情 */
  previewResource(
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node',
    resourceId: string,
    configPath: string
  ): Promise<unknown>

  // === 资源重命名 ===

  /** 重命名 Schema 并更新后端 */
  renameSchema(schemaId: string, newName: string, configPath: string): Promise<void>

  /** 重命名 Pattern 并更新后端 */
  renamePattern(patternId: string, newName: string, configPath: string): Promise<void>

  /** 重命名 Constraint 并更新后端 */
  renameConstraint(constraintId: string, newName: string, configPath: string): Promise<void>

  // === 资源删除 ===

  /** 删除 Schema */
  deleteSchema(schemaId: string, configPath: string): Promise<void>

  /** 删除 Pattern */
  deletePattern(patternId: string, configPath: string): Promise<void>

  /** 删除 RegexNode */
  deleteRegexNode(regexId: string, configPath: string): Promise<void>

  /** 删除 Constraint */
  deleteConstraint(constraintId: string, configPath: string): Promise<void>
}

/**
 * 资源操作服务实现
 *
 * 封装所有资源相关的 API 调用，内部维护 fullConfig 缓存用于预览时快速读取。
 * parseResources 是核心方法，负责将后端扁平配置转换为前端资源树所需的层级结构。
 */
export class ResourceService implements IResourceService {
  /**
   * 缓存 fullConfig 数据，用于预览时直接获取数据（避免重复请求后端）
   */
  private cachedFullConfig: FullConfigV2Response | null = null

  /**
   * 加载完整配置
   *
   * 调用后端 API 获取项目完整配置，并将结果缓存到 cachedFullConfig。
   * 后续 previewResource 中的 pattern 预览会直接从缓存读取。
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
   * 处理 Schema、Pattern、RegexNode、Constraint、Template 五类资源，并建立关联关系。
   *
   * 解析流程：
   * 1. 预处理：收集 manifest 中列出的 ID、schema 解析错误、independent/embedded 约束映射、regex 节点映射
   * 2. 解析 Schemas：创建 SchemaResource，关联 regex 和 constraint，提取内嵌约束和隐式正则字段
   * 3. 解析 Regex Registries：创建 PatternResource
   * 4. 解析 Regex Nodes：创建 RegexNodeResource
   * 5. 解析 Independent Constraints：创建 ConstraintResource（source='independent'）
   * 6. 解析 Embedded Constraints：创建 ConstraintResource（source='embedded'）
   * 7. 解析 Templates：创建 TemplateResource
   *
   * @param fullConfig - 后端返回的完整配置
   * @returns 资源项数组
   */
  parseResources(fullConfig: FullConfigV2Response): ResourceItem[] {
    const manifest = fullConfig.manifest
    // effective_manifest 是后端合并后的实际生效配置（可能包含目录扫描结果）
    const effectiveManifest = fullConfig.effective_manifest || manifest
    const resources: ResourceItem[] = []

    // === 预处理：收集 manifest 中列出的各类资源 ID ===
    const listedSchemaIds = new Set((manifest.schemas || []).map((r) => r.id))
    const listedConstraintIds = new Set((manifest.constraints || []).map((r) => r.id))
    const listedRegexNodeIds = new Set((manifest.regex_nodes || []).map((r) => r.id))

    // 收集 schema 解析错误（后端在 schema_errors 中记录 YAML 解析失败的 schema）
    const schemaErrors: Record<string, string> =
      ((fullConfig as unknown as Record<string, unknown>).schema_errors as Record<
        string,
        string
      >) || {}

    // === 预处理：收集所有 independent constraints 的 ID 和关联表/列 ===
    // independent constraints 是单独文件定义的约束，通过 manifest.constraints 索引
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

    // === 预处理：收集 embedded constraints 与所属 schema 的映射 ===
    // embedded constraints 内嵌在 schema YAML 的 constraints 数组中
    const embeddedConstraintMap: Record<string, string> = {}
    if (effectiveManifest.schemas && Array.isArray(effectiveManifest.schemas)) {
      for (const ref of effectiveManifest.schemas) {
        const schema = fullConfig.schemas?.[ref.id]
        if (schema?.constraints && Array.isArray(schema.constraints)) {
          for (const ec of schema.constraints) {
            // 防止重复拼接 schemaId（如果 ec.id 已经包含了 schemaId 前缀）
            const ecId = ec.id.startsWith(`${ref.id}_`) ? ec.id : `${ref.id}_${ec.id}`
            embeddedConstraintMap[ecId] = ref.id
          }
        }
      }
    }

    // === 预处理：收集所有 Regex 节点及其关联的表/列 ===
    // regexNodeMap 用于后续 schema 解析时快速查找关联的 regex 节点
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

    // === 阶段 1：解析 Schemas ===
    // 每个 Schema 需要关联 regex 节点、约束（embedded + independent）、内嵌约束子节点、隐式正则字段
    if (effectiveManifest.schemas && Array.isArray(effectiveManifest.schemas)) {
      for (const ref of effectiveManifest.schemas) {
        const schema = fullConfig.schemas?.[ref.id]
        const listedInManifest = listedSchemaIds.has(ref.id)
        const parseError = schemaErrors[ref.id]

        // 收集关联到当前 schema 的 Regex 节点（通过 uses_pattern.table_id 匹配）
        const associatedRegexIds: string[] = []
        for (const [regexId, info] of Object.entries(regexNodeMap)) {
          if (info.tableId === ref.id) {
            associatedRegexIds.push(regexId)
          }
        }

        // 收集关联到当前 schema 的 Constraints（包括 embedded 和 independent）
        const associatedConstraintIds: string[] = []

        // Embedded constraints：通过 embeddedConstraintMap 反向查找
        for (const ecId of Object.keys(embeddedConstraintMap)) {
          if (embeddedConstraintMap[ecId] === ref.id) {
            associatedConstraintIds.push(ecId)
          }
        }

        // Independent constraints：通过 independentConstraintMap 的 tableId 匹配
        for (const [cId, info] of Object.entries(independentConstraintMap)) {
          if (info.tableId === ref.id) {
            associatedConstraintIds.push(cId)
          }
        }

        // 收集内嵌约束作为 SchemaResource 的子节点（用于资源树展开显示）
        const embeddedConstraints: EmbeddedConstraintResource[] = []
        if (schema?.constraints && Array.isArray(schema.constraints)) {
          for (const ec of schema.constraints) {
            // 防止重复拼接 schemaId（如果 ec.id 已经包含了 schemaId 前缀）
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

        // 收集隐式正则字段信息（type='regex' 但未指定 validator 的列）
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
            // 隐式正则判定：type 为 regex 且没有明确指定 validator
            const isImplicit =
              colType === 'regex' &&
              !colData.validator &&
              (colData.implicit === true || !colData.validator)
            if (isImplicit || (colType === 'regex' && !colData.validator)) {
              implicitRegexFields.push({
                columnId: colData.id || '',
                columnName: colData.name || '',
                isImplicit: true,
                inferredPatternId: undefined, // 运行时推断，此处仅标记
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

    // === 阶段 2：解析正则表达式注册表 (regex_registries) ===
    // 来自 patterns/ 目录，key 格式可能为 "patterns/xxx" 或直接为 ID
    if (fullConfig.regex_registries) {
      for (const [key, value] of Object.entries(fullConfig.regex_registries)) {
        const registryData = value as { id: string; registry: string; definition: unknown }
        const [registryType, patternId] = key.includes('/')
          ? key.split('/', 2)
          : [registryData.registry || 'patterns', registryData.id]
        const safeRegistryType = registryType ?? 'patterns'
        const safePatternId = patternId ?? ''

        resources.push({
          id: key,
          name: safePatternId,
          kind: 'pattern',
          path: `${safeRegistryType}/${safePatternId}.yaml`,
          meta: {
            registry: safeRegistryType,
            definition: registryData.definition,
          },
          registry: safeRegistryType as 'patterns',
        })
      }
    }

    // === 阶段 3：解析正则表达式节点 (regex_nodes) ===
    // 来自 manifest.regex_nodes 或 regex/ 目录
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

    // === 阶段 4：解析 Independent Constraints ===
    // 独立约束文件，通过 manifest.constraints 索引
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

    // === 阶段 5：解析 Embedded Constraints ===
    // 再次遍历 schemas，将内嵌约束也作为独立的 ConstraintResource 加入资源树
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

    // === 阶段 6：解析 Templates ===
    if (effectiveManifest.templates && Array.isArray(effectiveManifest.templates)) {
      for (const ref of effectiveManifest.templates) {
        resources.push({
          id: ref.id,
          name: ref.id,
          kind: 'template',
          path: ref.path,
          meta: {
            listedInManifest: true,
          },
        } as TemplateResource)
      }
    }

    return resources
  }

  /**
   * 预览资源
   *
   * 根据资源类型调用对应 API 或从缓存获取资源详情。
   *
   * 数据来源：
   * - schema / regex_node / constraint / template：直接调用后端 API
   * - pattern：从 cachedFullConfig.regex_registries 缓存中读取（需先调用 loadFullConfig）
   *
   * @param resourceKind - 资源类型：schema / pattern / constraint / regex_node / template
   * @param resourceId - 资源唯一标识
   * @param configPath - 项目配置文件路径
   * @returns 资源详情对象
   * @throws 当资源类型不支持或缓存未加载时抛出错误
   */
  async previewResource(
    resourceKind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template',
    resourceId: string,
    configPath: string
  ): Promise<unknown> {
    switch (resourceKind) {
      case 'schema':
        return projectV2Api.getV2Schema(resourceId, configPath)
      case 'pattern':
        // Pattern 预览从缓存读取，避免重复请求（regex_registries 数据已在 loadFullConfig 时获取）
        return this.getPatternFromCache(resourceId)
      case 'regex_node':
        return projectV2Api.getV2RegexNode(resourceId, configPath)
      case 'constraint':
        return projectV2Api.getV2Constraint(resourceId, configPath)
      case 'template':
        return projectV2Api.getV2Template(resourceId, configPath)
      default:
        throw new Error(`Unsupported resource kind: ${resourceKind}`)
    }
  }

  /**
   * 从缓存中获取 pattern (regex_registries) 数据
   *
   * Pattern 资源在 loadFullConfig 时已随完整配置一起返回，因此无需额外 API 请求。
   *
   * @param resourceId - Pattern 资源标识（即 regex_registries 中的 key）
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

/**
 * 资源服务全局单例
 *
 * 整个应用生命周期内共享同一实例，维护统一的 fullConfig 缓存。
 * 在资源树加载、预览、重命名、删除等操作中复用。
 */
export const resourceService = new ResourceService()
