/**
 * @file template.ts
 * @description V2 Template CRUD、展开、manifest 引用更新 API
 */

import apiClient from '@/core/services/httpClient'
import { withConfigPathHeader } from './shared'

/**
 * 模板列表项接口
 */
export interface TemplateListItem {
  id: string
  name: string
  description?: string
  parameter_count: number
  node_count: number
  path: string
}

/**
 * 模板展开结果接口
 */
export interface TemplateExpandResult {
  transforms: Record<string, unknown>[]
  constraints: Record<string, unknown>[]
  regex_nodes: Record<string, unknown>[]
}

export async function listV2Templates(configPath?: string): Promise<TemplateListItem[]> {
  const { data } = await apiClient.get<TemplateListItem[]>(
    '/project/template',
    withConfigPathHeader(configPath)
  )
  return data
}

export async function getV2Template(
  templateId: string,
  configPath?: string
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<Record<string, unknown>>(
    `/project/template/${encodeURIComponent(templateId)}`,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function createV2Template(
  templateData: Record<string, unknown>,
  configPath?: string
): Promise<{ success: boolean; message: string }> {
  const { data } = await apiClient.post<{ success: boolean; message: string }>(
    '/project/template',
    templateData,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function updateV2Template(
  templateId: string,
  templateData: Record<string, unknown>,
  configPath?: string
): Promise<{ success: boolean; message: string }> {
  const { data } = await apiClient.put<{ success: boolean; message: string }>(
    `/project/template/${encodeURIComponent(templateId)}`,
    templateData,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function deleteV2Template(
  templateId: string,
  configPath?: string
): Promise<{ success: boolean; message: string }> {
  const { data } = await apiClient.delete<{ success: boolean; message: string }>(
    `/project/template/${encodeURIComponent(templateId)}`,
    withConfigPathHeader(configPath)
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
    `/project/template/${encodeURIComponent(templateId)}/expand`,
    {
      instance_id: instanceId,
      params,
      input_from_node: inputFromNode || '',
    },
    withConfigPathHeader(configPath)
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
    '/project/manifest/template-instance',
    instanceRef,
    withConfigPathHeader(configPath)
  )
}
