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
  await apiClient.put('/project/view', view, withConfigPathHeader(configPath))
}
