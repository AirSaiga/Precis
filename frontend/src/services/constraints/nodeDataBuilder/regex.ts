/**
 * @fileoverview Regex builder — 正则节点数据构建
 *
 * 构建正则节点的完整数据，包括 pattern、matchMode、sourceRef 等。
 */

import type { BuildInput, BuildResult } from './types'
import type { ConstraintKind } from '../types'
import { registerBuilder } from './registry'

function buildRegex(input: BuildInput): BuildResult {
  const { configName, nodeId, columnRef, mode, saveState, params } = input

  const nodeData: Record<string, unknown> = {
    configName,
    pattern: (params?.pattern as string) || '',
    description: (params?.description as string) || '',
    parameters: (params?.parameters as unknown[]) || [],
    matchMode: (params?.match_mode as string) || 'full',
    enabled: params?.enabled !== false,
    caseSensitive: !!params?.case_sensitive,
    flags: (params?.flags as string) || '',
    validationRules: {},
    rules: (params?.rules as unknown[]) || [],
    validationStatus: 'idle',
    errorCount: 0,
    totalRows: 0,
    matchCount: 0,
    lastValidationTime: undefined,
    sourceRef: columnRef || undefined,
    saveState: saveState || (mode === 'connect' ? 'draft' : 'saved'),
  }

  const edgeDescriptors = columnRef
    ? [
        {
          kind: 'constraint' as const,
          sourceNodeId: input.schemaNodeId,
          targetNodeId: nodeId,
          columnId: columnRef.columnId,
        },
      ]
    : []

  return { nodeData, edgeDescriptors }
}

function buildRegexExtract(input: BuildInput): BuildResult {
  const { configName, nodeId, columnRef, mode, saveState, params } = input

  const nodeData: Record<string, unknown> = {
    configName,
    pattern: (params?.pattern as string) || '',
    description: (params?.description as string) || '',
    flags: (params?.flags as string) || '',
    caseSensitive: !!params?.case_sensitive,
    enabled: params?.enabled !== false,
    captureGroups:
      (params?.capture_groups as Array<{ name: string; group_index: number }>)?.map((g) => ({
        name: g.name,
        groupIndex: g.group_index,
      })) || [],
    outputColumns: (params?.output_columns as string[]) || [],
    inputFromNode: (params?.input_from_node as string) || undefined,
    inputColumn: (params?.input_column as string) || undefined,
    rules: (params?.rules as unknown[]) || [],
    validationStatus: 'idle',
    sourceRef: columnRef || undefined,
    saveState: saveState || (mode === 'connect' ? 'draft' : 'saved'),
  }

  const edgeDescriptors = columnRef
    ? [
        {
          kind: 'constraint' as const,
          sourceNodeId: input.schemaNodeId,
          targetNodeId: nodeId,
          columnId: columnRef.columnId,
        },
      ]
    : []

  return { nodeData, edgeDescriptors }
}

// Regex 不是 ConstraintKind，而是独立的节点类型。
// 使用独立注册函数避免类型断言。
registerBuilder('regex' as unknown as ConstraintKind, buildRegex)
registerBuilder('regexExtract' as unknown as ConstraintKind, buildRegexExtract)
