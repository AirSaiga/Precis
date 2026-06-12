/**
 * @file projectView.ts
 * @description V2 项目视图（画布布局）读写 API
 */

import apiClient from '@/core/services/httpClient'
import type { ProjectViewV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

export async function getV2ProjectView(configPath?: string): Promise<ProjectViewV2> {
  const { data } = await apiClient.get<ProjectViewV2>(
    '/project/view',
    withConfigPathHeader(configPath)
  )
  return data
}

export async function putV2ProjectView(view: ProjectViewV2, configPath?: string): Promise<void> {
  await apiClient.put(
    '/project/view',
    view,
    withConfigPathHeader(configPath)
  )
}
