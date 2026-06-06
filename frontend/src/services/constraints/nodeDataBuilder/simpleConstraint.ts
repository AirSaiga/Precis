/**
 * @fileoverview 通用约束 builder — 7 种单列单边约束
 *
 * 统一处理：notNull, unique, allowedValues, range, scripted, charset, dateLogic
 * 共享基础字段：configName, table, column, sourceRef, validationStatus, validationErrors, saveState
 * 各类型通过 type-specific extras 添加特有字段。
 */

import type { ConstraintKind } from '../types'
import type { BuildInput, BuildResult } from './types'
import { registerBuilder } from './registry'

const DEFAULT_SAVE_STATE: Record<string, 'saved' | 'draft'> = {
  import: 'saved',
  embedded: 'saved',
  connect: 'draft',
}

function buildSimpleConstraint(kind: ConstraintKind, input: BuildInput): BuildResult {
  const { columnRef, tableName, configName, nodeId, params, embedded, mode, saveState } = input

  const baseData: Record<string, unknown> = {
    configName,
    table: tableName,
    column: columnRef?.columnName || '',
    sourceRef: columnRef || undefined,
    validationStatus: 'idle',
    validationErrors: [],
    saveState: saveState || DEFAULT_SAVE_STATE[mode],
  }

  if (embedded) {
    baseData.embedded = true
  }

  // 类型特有字段
  const extras = buildTypeExtras(kind, nodeId, params || {})

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

  return {
    nodeData: { ...baseData, ...extras },
    edgeDescriptors,
  }
}

function buildTypeExtras(
  kind: ConstraintKind,
  nodeId: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  switch (kind) {
    case 'allowedValues':
      return {
        allowedValues: ((params.allowed_values as unknown[]) || []),
      }

    case 'range':
      return {
        minValue: params.min,
        maxValue: params.max,
        boundaryMode: params.boundary_mode || 'inclusive',
      }

    case 'scripted':
      return {
        script: String(params.expression || ''),
        constraintName: String(params.name || nodeId),
      }

    case 'charset':
      return {
        charsetMode: params.charset_mode || 'custom',
        allowedChars: params.allowed_chars || '',
        disallowedChars: params.disallowed_chars || '',
      }

    case 'dateLogic':
      return {
        logicMode: params.logic_mode || 'compare',
        compareOp: params.compare_op || 'gt',
        referenceDate: (params.reference_date as string) || '',
        referenceColumn: (params.reference_column as string) || '',
        calculationType: (params.calculation_type as string) || 'age',
        targetType: (params.target_type as string) || 'value',
        targetValue: (params.target_value as string) || '',
        targetColumn: (params.target_column as string) || '',
      }

    case 'composite':
      const subConstraints = ((params.sub_constraints as unknown[]) || [])
      return {
        logic: params.logic || 'all',
        includedNodeIds: subConstraints
          .map((s: any) => s?.id)
          .filter((id: any): id is string => !!id),
        enabled: true,
      }

    // notNull, unique 无额外字段
    default:
      return {}
  }
}

// 注册到 registry — 使用闭包捕获 kind
const SIMPLE_KINDS: ConstraintKind[] = [
  'notNull',
  'unique',
  'allowedValues',
  'range',
  'scripted',
  'charset',
  'dateLogic',
  'composite',
]

SIMPLE_KINDS.forEach((kind) => {
  registerBuilder(kind, (input: BuildInput) => buildSimpleConstraint(kind, input))
})
