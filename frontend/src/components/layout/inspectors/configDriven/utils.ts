/**
 * @file utils.ts
 * @description Inspector 配置驱动工具函数
 *
 * 提供 Inspector 配置解析和执行的工具函数：
 * - getByPath: 按路径从对象中取值
 * - evaluateWhen: 评估条件表达式（when）
 * - buildInspectorContext: 构建 Inspector 上下文
 */

import type { InspectorValuePath, InspectorValueSource, InspectorWhen } from './types'
import type { CustomNode } from '@/types/nodes'

export type InspectorContext = {
  data: Record<string, unknown>
  nodeId: string
  nodeType: string
  nodes?: CustomNode[]
}

export function getByPath(value: unknown, path: InspectorValuePath): unknown {
  let cur: unknown = value
  for (const seg of path) {
    if (cur == null) return undefined
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[seg]
      continue
    }
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function setByPath(value: unknown, path: InspectorValuePath, next: unknown): unknown {
  if (path.length === 0) return next
  const [head, ...rest] = path
  if (head === undefined) return value
  if (typeof head === 'number') {
    const base = Array.isArray(value) ? value.slice() : []
    base[head] = setByPath(base[head], rest, next)
    return base
  }
  const base =
    value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
  base[head] = setByPath((base as Record<string, unknown>)[head], rest, next)
  return base
}

export function getSourceValue(ctx: InspectorContext, source: InspectorValueSource): unknown {
  if (source.source === 'meta') {
    return source.key === 'nodeId' ? ctx.nodeId : ctx.nodeType
  }
  return getByPath(ctx.data, source.path)
}

export function evaluateWhen(ctx: InspectorContext, when?: InspectorWhen): boolean {
  if (!when) return true
  switch (when.op) {
    case 'exists':
      return getSourceValue(ctx, when.source) !== undefined
    case 'equals':
      return getSourceValue(ctx, when.source) === when.value
    case 'not':
      return !evaluateWhen(ctx, when.expr)
    case 'and':
      return when.exprs.every(e => evaluateWhen(ctx, e))
    case 'or':
      return when.exprs.some(e => evaluateWhen(ctx, e))
  }
}

export function getUpstreamColumns(ctx: InspectorContext): string[] {
  const inputFromNode = ctx.data.inputFromNode as string | undefined
  if (!inputFromNode || !ctx.nodes) return []

  const upstreamNode = ctx.nodes.find((n) => n.id === inputFromNode)
  if (!upstreamNode) return []

  const data = upstreamNode.data as unknown as Record<string, unknown>

  switch (upstreamNode.type) {
    case 'manualData':
    case 'transformOutput':
      return data.columnName ? [data.columnName as string] : []
    case 'schema':
    case 'jsonSchema': {
      const cols = data.columns as Array<{ columnName: string }> | undefined
      return cols?.map((c) => c.columnName) ?? []
    }
    case 'sourcePreview':
    case 'jsonSourcePreview': {
      const matrix = data.data as string[][] | undefined
      const headerRow = (data.headerRow as number) ?? 0
      return matrix?.[headerRow] ?? []
    }
    case 'transform': {
      return Array.isArray(data.outputColumns) ? (data.outputColumns as string[]) : []
    }
    default:
      return []
  }
}

export function buildShallowCompatiblePatch(
  data: Record<string, unknown>,
  source: InspectorValueSource,
  nextValue: unknown
): Record<string, unknown> {
  if (source.source !== 'data') {
    return {}
  }
  const path = source.path
  if (path.length === 0) return {}
  const root = path[0]
  if (root === undefined) return {}
  if (typeof root === 'number') return {}

  if (path.length === 1) {
    return { [root]: nextValue }
  }

  const existingRoot = data[root]
  const nextRoot = setByPath(existingRoot, path.slice(1), nextValue)
  return { [root]: nextRoot }
}

