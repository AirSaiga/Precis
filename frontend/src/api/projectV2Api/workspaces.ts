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
 * @file workspaces.ts
 * @description V2 工作区配置读写 API
 */

import apiClient from '@/core/services/httpClient'
import type { WorkspacesV2Response } from '@/types/projectV2'

export async function getV2Workspaces(configPath?: string): Promise<WorkspacesV2Response> {
  const { data } = await apiClient.get<WorkspacesV2Response>(
    '/project/workspaces',
    configPath ? { headers: { 'X-Project-Config-Path': configPath } } : undefined
  )
  return data
}

export async function putV2Workspaces(
  payload: WorkspacesV2Response,
  configPath?: string
): Promise<void> {
  await apiClient.put('/project/workspaces', payload, {
    ...(configPath ? { headers: { 'X-Project-Config-Path': configPath } } : {}),
  })
}
