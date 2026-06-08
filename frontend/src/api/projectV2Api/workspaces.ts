/**
 * @file workspaces.ts
 * @description V2 工作区配置读写 API
 */

import apiClient from '@/core/services/httpClient'
import type { WorkspacesV2Response } from '@/types/projectV2'

export async function getV2Workspaces(configPath?: string): Promise<WorkspacesV2Response> {
  const { data } = await apiClient.get<WorkspacesV2Response>(
    '/project/v2/workspaces',
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

export async function putV2Workspaces(
  payload: WorkspacesV2Response,
  configPath?: string
): Promise<void> {
  await apiClient.put('/project/v2/workspaces', payload, {
    ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
  })
}
