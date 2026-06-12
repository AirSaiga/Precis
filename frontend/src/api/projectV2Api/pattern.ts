/**
 * @file pattern.ts
 * @description V2 Pattern 创建与存在性检查 API
 */

import apiClient from '@/core/services/httpClient'
import type { CreatePatternRequest, CreatePatternResponse } from '@/types/api'
import { withConfigPathHeader } from './shared'

export type { CreatePatternRequest, CreatePatternResponse }

/**
 * 创建新的 Pattern 文件
 */
export async function createV2Pattern(
  payload: CreatePatternRequest,
  configPath?: string
): Promise<CreatePatternResponse> {
  const { data } = await apiClient.post<CreatePatternResponse>(
    '/project/pattern',
    payload,
    withConfigPathHeader(configPath)
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
    `/project/pattern/${encodeURIComponent(patternName)}/exists`,
    withConfigPathHeader(configPath)
  )
  return data
}
