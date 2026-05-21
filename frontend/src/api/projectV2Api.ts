/**
 * @file projectV2Api.ts
 * @description V2 项目配置 API
 *
 * 该模块封装后端 /project/v2/* 接口：
 * - manifest/schema/constraint 的读写
 * - 全量配置读写
 * - 项目设置读写（validation/file-processing/script-security）
 * - 类型发现（constraints/datatypes/source_modes）
 */

import { isAxiosError } from 'axios'
import apiClient from '@/core/services/httpClient'
import type {
  ConstraintFileV2,
  FullConfigV2Request,
  FullConfigV2Response,
  ProjectManifestV2,
  ProjectViewV2,
  RegexNodeFileV2,
  TableSchemaFileV2,
  TransformFileV2,
  ValidationSettings,
  FileProcessingSettings,
  ScriptSecuritySettings,
  ProjectSettings,
  SchemaSaveMode,
  SchemaConflictInfo,
  WorkspacesV2Response,
} from '@/types/projectV2'
import type { ConfigComparison } from '@/api/types/conflict'

/**
 * 获取 V2 项目清单（manifest）
 *
 * @param configPath - 项目配置文件路径（可选）
 * @returns 项目清单对象
 */
export async function getV2Manifest(configPath?: string): Promise<ProjectManifestV2> {
  const { data } = await apiClient.get<ProjectManifestV2>(
    '/project/v2/manifest',
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 保存 V2 项目清单
 *
 * @param manifest - 项目清单对象
 * @param configPath - 项目配置文件路径（可选）
 * @param replace - 是否完全替换（可选，默认合并）
 */
export async function putV2Manifest(
  manifest: ProjectManifestV2,
  configPath?: string,
  replace?: boolean
): Promise<void> {
  try {
    await apiClient.put('/project/v2/manifest', manifest, {
      ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
      ...(replace ? { params: { replace: true } } : {}),
    })
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

/**
 * 更新 manifest 中的 Schema 引用
 *
 * @param schemaRef - Schema 引用对象（含 id 和 path）
 * @param configPath - 项目配置文件路径（可选）
 */
export async function updateV2ManifestSchemaRef(
  schemaRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/v2/manifest/schema',
      schemaRef,
      configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
    )
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

/**
 * 更新 manifest 中的 Constraint 引用
 *
 * @param constraintRef - Constraint 引用对象（含 id 和 path）
 * @param configPath - 项目配置文件路径（可选）
 */
export async function updateV2ManifestConstraintRef(
  constraintRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/v2/manifest/constraint',
      constraintRef,
      configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
    )
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

/**
 * 更新 manifest 中的 Regex 引用
 *
 * @param regexRef - Regex 引用对象（含 id 和 path）
 * @param configPath - 项目配置文件路径（可选）
 */
export async function updateV2ManifestRegexRef(
  regexRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/v2/manifest/regex',
      regexRef,
      configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
    )
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

/**
 * 更新 manifest 中的 Transform 引用
 *
 * @param transformRef - Transform 引用对象（含 id 和 path）
 * @param configPath - 项目配置文件路径（可选）
 */
export async function updateV2ManifestTransformRef(
  transformRef: { id: string; path: string },
  configPath?: string
): Promise<void> {
  try {
    await apiClient.put(
      '/project/v2/manifest/transform',
      transformRef,
      configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
    )
  } catch (e: any) {
    const detail = e?.response?.data?.detail
    const errorText =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ')
          : e?.response?.data?.error || e?.message || '请求失败'
    const headers = e?.config?.headers
    const configPath =
      headers?.['X-Project-Config-Path'] ||
      headers?.['x-project-config-path'] ||
      headers?.['X-PROJECT-CONFIG-PATH']
    throw new Error(configPath ? `X-Project-Config-Path=${configPath} | ${errorText}` : errorText)
  }
}

/**
 * 项目未找到错误（404）
 * 用于区分"项目路径不存在"与"服务器错误"，便于调用方选择是否静默处理
 */
export class ProjectNotFoundError extends Error {
  constructor(public readonly configPath?: string) {
    super(configPath ? `项目未找到: ${configPath}` : '项目未找到')
    this.name = 'ProjectNotFoundError'
  }
}

/**
 * 获取项目完整配置（含 manifest、schemas、constraints、regex_nodes）
 *
 * @param configPath - 项目配置文件路径（可选）
 * @returns 完整配置响应对象
 * @throws ProjectNotFoundError 当项目不存在时（404）
 */
export async function getV2FullConfig(configPath?: string): Promise<FullConfigV2Response> {
  try {
    const { data } = await apiClient.get<FullConfigV2Response>(
      '/project/v2/config/full',
      configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
    )
    return data
  } catch (e) {
    if (isAxiosError(e) && e.response?.status === 404) {
      throw new ProjectNotFoundError(configPath)
    }
    throw e
  }
}

/**
 * 获取项目完整配置的 YAML 文本
 *
 * @param configPath - 项目配置文件路径（可选）
 * @returns YAML 格式字符串
 */
export async function getV2FullConfigYaml(configPath?: string): Promise<string> {
  const res = await apiClient.get<string>(
    '/project/v2/config/full/yaml',
    configPath
      ? { headers: { 'X-Project-Config-Path': configPath }, responseType: 'text' as const }
      : { responseType: 'text' as const }
  )
  return res.data as unknown as string
}

/**
 * 保存项目完整配置
 *
 * @param payload - 完整配置请求对象
 * @param configPath - 项目配置文件路径（可选）
 */
export async function putV2FullConfig(
  payload: FullConfigV2Request,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    '/project/v2/config/full',
    payload,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 对比项目完整配置（用于预览变更）
 *
 * @param payload - 完整配置请求对象
 * @param configPath - 项目配置文件路径（可选）
 * @returns 配置对比结果
 */
export async function compareV2FullConfig(
  payload: FullConfigV2Request,
  configPath?: string
): Promise<ConfigComparison> {
  const { data } = await apiClient.post<ConfigComparison>(
    '/project/v2/config/compare',
    payload,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 获取指定 Schema 配置
 *
 * @param tableId - 表 ID
 * @param configPath - 项目配置文件路径（可选）
 * @returns Schema 文件对象
 */
export async function getV2Schema(
  tableId: string,
  configPath?: string
): Promise<TableSchemaFileV2> {
  const { data } = await apiClient.get<TableSchemaFileV2>(
    `/project/v2/schemas/${encodeURIComponent(tableId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 保存指定 Schema 配置
 *
 * @param tableId - 表 ID
 * @param schema - Schema 文件对象
 * @param configPath - 项目配置文件路径（可选）
 * @param mode - 保存模式（create/merge/overwrite，默认 overwrite）
 */
export async function putV2Schema(
  tableId: string,
  schema: TableSchemaFileV2,
  configPath?: string,
  mode: SchemaSaveMode = 'overwrite'
): Promise<void> {
  await apiClient.put(`/project/v2/schemas/${encodeURIComponent(tableId)}`, schema, {
    params: { mode },
    ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
  })
}

/**
 * 检查 Schema 保存冲突
 *
 * @param tableId - 表 ID
 * @param newSchema - 新 Schema 对象
 * @param configPath - 项目配置文件路径（可选）
 * @returns 冲突信息（含是否存在冲突、冲突字段等）
 */
export async function checkSchemaConflict(
  tableId: string,
  newSchema: TableSchemaFileV2,
  configPath?: string
): Promise<SchemaConflictInfo> {
  const { data } = await apiClient.post<SchemaConflictInfo>(
    `/project/v2/schemas/${encodeURIComponent(tableId)}/check-conflict`,
    newSchema,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 删除指定 Schema 资源（移除文件并更新 manifest）
 */
export async function deleteV2Schema(tableId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/v2/schemas/${encodeURIComponent(tableId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 更新 Schema 展示名（不改变 id）
 */
export async function updateV2SchemaDisplayName(
  tableId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/v2/schemas/${encodeURIComponent(tableId)}/display-name`,
    { name },
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 获取指定 Constraint 配置
 *
 * @param constraintId - 约束 ID
 * @param configPath - 项目配置文件路径（可选）
 * @returns Constraint 文件对象
 */
export async function getV2Constraint(
  constraintId: string,
  configPath?: string
): Promise<ConstraintFileV2> {
  const { data } = await apiClient.get<ConstraintFileV2>(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 保存指定 Constraint 配置
 *
 * @param constraintId - 约束 ID
 * @param constraint - Constraint 文件对象
 * @param configPath - 项目配置文件路径（可选）
 */
export async function putV2Constraint(
  constraintId: string,
  constraint: ConstraintFileV2,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}`,
    constraint,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 删除指定 Constraint 资源（移除文件并更新 manifest）
 */
export async function deleteV2Constraint(constraintId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 更新 Constraint 展示名（写入 description，不改变 id）
 */
export async function updateV2ConstraintDisplayName(
  constraintId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}/display-name`,
    { name },
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 获取指定 Regex 节点配置
 *
 * @param regexId - 正则节点 ID
 * @param configPath - 项目配置文件路径（可选）
 * @returns Regex 节点文件对象
 */
export async function getV2RegexNode(
  regexId: string,
  configPath?: string
): Promise<RegexNodeFileV2> {
  const { data } = await apiClient.get<RegexNodeFileV2>(
    `/project/v2/regex/${regexId}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 保存指定 Regex 节点配置
 *
 * @param regexId - 正则节点 ID
 * @param regexNode - Regex 节点文件对象
 * @param configPath - 项目配置文件路径（可选）
 */
export async function putV2RegexNode(
  regexId: string,
  regexNode: RegexNodeFileV2,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    `/project/v2/regex/${regexId}`,
    regexNode,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 保存单个 Transform 节点文件
 *
 * @param transformId - Transform 节点 ID
 * @param transformNode - Transform 节点文件对象
 * @param configPath - 项目配置文件路径（可选）
 */
export async function putV2TransformNode(
  transformId: string,
  transformNode: TransformFileV2,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    `/project/v2/transform/${transformId}`,
    transformNode,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 删除指定 Regex 资源（移除文件并更新 manifest）
 */
export async function deleteV2RegexNode(regexId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/v2/regex/${regexId}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

/**
 * 更新 Regex 展示名（写入 name，不改变 id）
 */
export async function updateV2RegexNodeDisplayName(
  regexId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/v2/regex/${regexId}/display-name`,
    { name },
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

import type { CreatePatternRequest, CreatePatternResponse } from '@/types/api'
export type { CreatePatternRequest, CreatePatternResponse } from '@/types/api'

/**
 * 创建新的 Pattern 文件
 */
export async function createV2Pattern(
  payload: CreatePatternRequest,
  configPath?: string
): Promise<CreatePatternResponse> {
  const { data } = await apiClient.post<CreatePatternResponse>(
    '/project/v2/pattern',
    payload,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 检查 Pattern 名称是否已存在
 */
export async function checkV2PatternExists(
  patternName: string,
  configPath?: string
): Promise<{ pattern_name: string; exists: boolean }> {
  const { data } = await apiClient.get<{ pattern_name: string; exists: boolean }>(
    `/project/v2/pattern/${encodeURIComponent(patternName)}/exists`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 获取项目视图文件（画布布局）
 */
export async function getV2ProjectView(configPath?: string): Promise<ProjectViewV2> {
  const { data } = await apiClient.get<ProjectViewV2>(
    '/project/v2/view',
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 更新项目视图文件（画布布局）
 */
/**
 * 保存项目视图配置（画布布局）
 *
 * @param view - 项目视图对象
 * @param configPath - 项目配置文件路径（可选）
 */
export async function putV2ProjectView(view: ProjectViewV2, configPath?: string): Promise<void> {
  await apiClient.put(
    '/project/v2/view',
    view,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

// ============================================================================
// Template（可复用约束模板）API
// ============================================================================

export interface TemplateListItem {
  id: string
  name: string
  description?: string
  parameter_count: number
  node_count: number
  path: string
}

export interface TemplateExpandResult {
  transforms: Record<string, unknown>[]
  constraints: Record<string, unknown>[]
  regex_nodes: Record<string, unknown>[]
}

/**
 * 列出所有模板定义
 */
export async function listV2Templates(configPath?: string): Promise<TemplateListItem[]> {
  const { data } = await apiClient.get<TemplateListItem[]>(
    '/project/v2/template',
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 读取指定模板定义
 */
export async function getV2Template(
  templateId: string,
  configPath?: string
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<Record<string, unknown>>(
    `/project/v2/template/${encodeURIComponent(templateId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 创建模板定义
 */
export async function createV2Template(
  templateData: Record<string, unknown>,
  configPath?: string
): Promise<{ success: boolean; message: string }> {
  const { data } = await apiClient.post<{ success: boolean; message: string }>(
    '/project/v2/template',
    templateData,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 更新模板定义
 */
export async function updateV2Template(
  templateId: string,
  templateData: Record<string, unknown>,
  configPath?: string
): Promise<{ success: boolean; message: string }> {
  const { data } = await apiClient.put<{ success: boolean; message: string }>(
    `/project/v2/template/${encodeURIComponent(templateId)}`,
    templateData,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 删除模板定义
 */
export async function deleteV2Template(
  templateId: string,
  configPath?: string
): Promise<{ success: boolean; message: string }> {
  const { data } = await apiClient.delete<{ success: boolean; message: string }>(
    `/project/v2/template/${encodeURIComponent(templateId)}`,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 预览模板展开结果（不写入文件）
 */
export async function expandV2Template(
  templateId: string,
  instanceId: string,
  params: Record<string, unknown>,
  inputFromNode?: string,
  configPath?: string
): Promise<TemplateExpandResult> {
  const { data } = await apiClient.post<TemplateExpandResult>(
    `/project/v2/template/${encodeURIComponent(templateId)}/expand`,
    {
      instance_id: instanceId,
      params,
      input_from_node: inputFromNode || '',
    },
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 更新 manifest 中的 Template 实例引用
 */
export async function updateV2ManifestTemplateInstanceRef(
  instanceRef: {
    id: string
    template_id: string
    enabled: boolean
    input_from_node: string
    params: Record<string, unknown>
  },
  configPath?: string
): Promise<void> {
  await apiClient.put(
    '/project/v2/manifest/template-instance',
    instanceRef,
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
}

// ============================================================================
// Settings / Workspaces
// ============================================================================

/**
 * 获取项目设置（从 project.precis.yaml 的 settings 字段）
 */
export async function getProjectSettings(): Promise<ProjectSettings> {
  const { data } = await apiClient.get<ProjectSettings>('/project/v2/config/settings')
  return data
}

/**
 * 更新项目设置（保存到 project.precis.yaml 的 settings 字段）
 */
export async function updateProjectSettings(settings: ProjectSettings): Promise<void> {
  await apiClient.put('/project/v2/config/settings', settings)
}

/**
 * 获取校验行为设置
 */
export async function getValidationSettings(): Promise<ValidationSettings> {
  const { data } = await apiClient.get<ValidationSettings>('/project/v2/config/validation')
  return data
}

/**
 * 更新校验行为设置
 */
export async function updateValidationSettings(settings: ValidationSettings): Promise<void> {
  await apiClient.put('/project/v2/config/validation', settings)
}

/**
 * 获取文件处理设置
 */
export async function getFileProcessingSettings(): Promise<FileProcessingSettings> {
  const { data } = await apiClient.get<FileProcessingSettings>('/project/v2/config/file-processing')
  return data
}

/**
 * 更新文件处理设置
 */
export async function updateFileProcessingSettings(
  settings: FileProcessingSettings
): Promise<void> {
  await apiClient.put('/project/v2/config/file-processing', settings)
}

/**
 * 获取脚本安全设置
 */
export async function getScriptSecuritySettings(): Promise<ScriptSecuritySettings> {
  const { data } = await apiClient.get<ScriptSecuritySettings>('/project/v2/config/script-security')
  return data
}

/**
 * 更新脚本安全设置
 */
export async function updateScriptSecuritySettings(
  settings: ScriptSecuritySettings
): Promise<void> {
  await apiClient.put('/project/v2/config/script-security', settings)
}

/**
 * 获取 V2 工作区配置
 */
export async function getV2Workspaces(configPath?: string): Promise<WorkspacesV2Response> {
  const { data } = await apiClient.get<WorkspacesV2Response>(
    '/project/v2/workspaces',
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

/**
 * 保存 V2 工作区配置
 */
export async function putV2Workspaces(
  payload: WorkspacesV2Response,
  configPath?: string
): Promise<void> {
  await apiClient.put('/project/v2/workspaces', payload, {
    ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
  })
}
