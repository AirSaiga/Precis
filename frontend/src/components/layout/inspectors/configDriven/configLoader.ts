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
 * @file configLoader.ts
 * @description Inspector 配置加载器
 */

import { isInspectorConfigV1, type InspectorConfigV1 } from './types'

const rawConfigs = import.meta.glob('./configs/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const byNodeType: Record<string, InspectorConfigV1> = {}

for (const raw of Object.values(rawConfigs)) {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isInspectorConfigV1(parsed)) continue
    byNodeType[parsed.nodeType] = parsed
  } catch {
    continue
  }
}

export function getInspectorConfig(nodeType: string | null | undefined): InspectorConfigV1 | null {
  if (!nodeType) return null
  return byNodeType[nodeType] ?? null
}
