/**
 * @file transform.ts
 * @description V2 Transform 节点保存 API
 */

import apiClient from '@/core/services/httpClient'
import type { TransformFileV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

export async function putV2TransformNode(
  transformId: string,
  transformNode: TransformFileV2,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    `/project/transform/${encodeURIComponent(transformId)}`,
    transformNode,
    withConfigPathHeader(configPath)
  )
}
