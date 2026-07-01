/**
 * @file fullConfig.ts
 * @description V2 全量配置读写、对比、自检 API
 */

import apiClient from '@/core/services/httpClient'
import type {
  FullConfigV2Request,
  FullConfigV2Response,
  InspectionResultV2,
} from '@/types/projectV2'
import type { ConfigComparison } from '@/api/types/conflict'
import { isProjectNotFound, ProjectNotFoundError, withConfigPathHeader } from './shared'

/**
 * 获取项目完整配置（含 manifest、schemas、constraints、regex_nodes）
 *
 * @throws ProjectNotFoundError 当项目不存在时（404）
 */
export async function getV2FullConfig(
  configPath?: string,
  options?: { inspect?: boolean }
): Promise<FullConfigV2Response> {
  try {
    const { data } = await apiClient.get<FullConfigV2Response>('/project/config/full', {
      ...(options?.inspect ? { params: { inspect: true } } : {}),
      ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
    })
    return data
  } catch (e) {
    if (isProjectNotFound(e)) {
      throw new ProjectNotFoundError(configPath)
    }
    throw e
  }
}

/**
 * 执行配置文件格式自检
 *
 * 注意:后端在 inspect=true 时应始终返回 inspection 字段。
 * 若缺失(后端异常/版本不匹配),抛错而非静默返回空结果 ——
 * 否则 recheck 会用空结果覆盖 store,让徽章错误地显示绿色"全通过"。
 */
export async function inspectV2Config(configPath?: string): Promise<InspectionResultV2> {
  try {
    const { data } = await apiClient.get<FullConfigV2Response>('/project/config/full', {
      params: { inspect: true },
      ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
    })
    if (!data.inspection) {
      throw new Error('后端未返回 inspection 结果')
    }
    return data.inspection
  } catch (e) {
    if (isProjectNotFound(e)) {
      throw new ProjectNotFoundError(configPath)
    }
    throw e
  }
}

/**
 * 保存项目完整配置
 */
export async function putV2FullConfig(
  payload: FullConfigV2Request,
  configPath?: string
): Promise<void> {
  await apiClient.put('/project/config/full', payload, withConfigPathHeader(configPath))
}

/**
 * 对比项目完整配置（用于预览变更）
 */
export async function compareV2FullConfig(
  payload: FullConfigV2Request,
  configPath?: string
): Promise<ConfigComparison> {
  const { data } = await apiClient.post<ConfigComparison>(
    '/project/config/compare',
    payload,
    withConfigPathHeader(configPath)
  )
  return data
}
