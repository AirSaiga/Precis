/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
    `/project/schemas/${encodeURIComponent(tableId)}`,
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
  await apiClient.put(`/project/schemas/${encodeURIComponent(tableId)}`, schema, {
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
    `/project/schemas/${encodeURIComponent(tableId)}/check-conflict`,
    newSchema,
    withConfigPathHeader(configPath)
  )
  return data
}

export async function deleteV2Schema(tableId: string, configPath?: string): Promise<void> {
  await apiClient.delete(
    `/project/schemas/${encodeURIComponent(tableId)}`,
    withConfigPathHeader(configPath)
  )
}

export async function updateV2SchemaDisplayName(
  tableId: string,
  name: string,
  configPath?: string
): Promise<void> {
  await apiClient.post(
    `/project/schemas/${encodeURIComponent(tableId)}/display-name`,
    { name },
    withConfigPathHeader(configPath)
  )
}
