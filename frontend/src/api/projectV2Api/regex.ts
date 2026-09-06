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
