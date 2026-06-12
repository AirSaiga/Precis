/**
 * @file regex.ts
 * @description V2 Regex 节点读写、显示名更新 API
 */

import apiClient from '@/core/services/httpClient'
import type { RegexNodeFileV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

export async function getV2RegexNode(
  regexId: string,
  configPath?: string
): Promise<RegexNodeFileV2> {
  const { data } = await apiClient.get<RegexNodeFileV2>(
    `/project/regex/${encodeURIComponent(regexId)}`,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function putV2RegexNode(
  regexId: string,
  regexNode: RegexNodeFileV2,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    `/project/regex/${encodeURIComponent(regexId)}`,
    regexNode,
    withConfigPathHeader(configPath)
  )
}

export async function deleteV2RegexNode(regexId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/regex/${encodeURIComponent(regexId)}`,
    withConfigPathHeader(configPath)
  )
}

export async function updateV2RegexNodeDisplayName(
  regexId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/regex/${encodeURIComponent(regexId)}/display-name`,
    { name },
    withConfigPathHeader(configPath)
  )
}
