/**
 * @fileoverview NodeDataBuilder 注册表
 *
 * 核心入口：buildNodeData(kind, input) → BuildResult
 * 各约束类型通过 registerBuilder 注册到 builders Map 中。
 * 未注册的类型走降级逻辑，返回最小可用数据。
 */

import type { ConstraintKind } from '../types'
import type { BuildInput, BuildResult } from './types'

type BuilderFn = (input: BuildInput) => BuildResult

const builders = new Map<ConstraintKind, BuilderFn>()

export function registerBuilder(kind: ConstraintKind, builder: BuilderFn): void {
  builders.set(kind, builder)
}

/** 主入口：根据约束类型构建节点数据 */
export function buildNodeData(kind: ConstraintKind, input: BuildInput): BuildResult {
  const builder = builders.get(kind)
  if (!builder) {
    return buildFallback(input)
  }
  return builder(input)
}

function buildFallback(input: BuildInput): BuildResult {
  return {
    nodeData: {
      configName: input.configName,
      saveState: input.saveState || (input.mode === 'connect' ? 'draft' : 'saved'),
      ...(input.embedded ? { embedded: true } : {}),
      ...(input.columnRef
        ? {
            sourceRef: input.columnRef,
            table: input.tableName,
            column: input.columnRef.columnName,
          }
        : {}),
      validationStatus: 'idle',
      validationErrors: [],
    },
    edgeDescriptors: input.columnRef
      ? [
          {
            kind: 'constraint' as const,
            sourceNodeId: input.schemaNodeId,
            targetNodeId: input.nodeId,
            columnId: input.columnRef.columnId,
          },
        ]
      : [],
  }
}
