/**
 * @file constraint.ts
 * @description V2 Constraint 资源读写、显示名更新 API
 */

import apiClient from '@/core/services/httpClient'
import type { ConstraintFileV2 } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

export async function getV2Constraint(
  constraintId: string,
  configPath?: string
): Promise<ConstraintFileV2> {
  const { data } = await apiClient.get<ConstraintFileV2>(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}`,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function putV2Constraint(
  constraintId: string,
  constraint: ConstraintFileV2,
  configPath?: string
): Promise<void> {
  await apiClient.put(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}`,
    constraint,
    withConfigPathHeader(configPath)
  )
}

export async function deleteV2Constraint(constraintId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}`,
    withConfigPathHeader(configPath)
  )
}

export async function updateV2ConstraintDisplayName(
  constraintId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/v2/constraints/${encodeURIComponent(constraintId)}/display-name`,
    { name },
    withConfigPathHeader(configPath)
  )
}
