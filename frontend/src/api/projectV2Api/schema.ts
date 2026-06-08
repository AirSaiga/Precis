/**
 * @file schema.ts
 * @description V2 Schema 资源读写、冲突检查、显示名更新 API
 */

import apiClient from '@/core/services/httpClient'
import type { TableSchemaFileV2, SchemaSaveMode, SchemaConflictInfo } from '@/types/projectV2'
import { withConfigPathHeader } from './shared'

export async function getV2Schema(
  tableId: string,
  configPath?: string
): Promise<TableSchemaFileV2> {
  const { data } = await apiClient.get<TableSchemaFileV2>(
    `/project/v2/schemas/${encodeURIComponent(tableId)}`,
    withConfigPathHeader(configPath)
  )
  return data
}

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

export async function checkSchemaConflict(
  tableId: string,
  newSchema: TableSchemaFileV2,
  configPath?: string
): Promise<SchemaConflictInfo> {
  const { data } = await apiClient.post<SchemaConflictInfo>(
    `/project/v2/schemas/${encodeURIComponent(tableId)}/check-conflict`,
    newSchema,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function deleteV2Schema(tableId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/v2/schemas/${encodeURIComponent(tableId)}`,
    withConfigPathHeader(configPath)
  )
}

export async function updateV2SchemaDisplayName(
  tableId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/v2/schemas/${encodeURIComponent(tableId)}/display-name`,
    { name },
    withConfigPathHeader(configPath)
  )
}
