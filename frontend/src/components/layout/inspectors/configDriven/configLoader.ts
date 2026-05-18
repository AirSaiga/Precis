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
