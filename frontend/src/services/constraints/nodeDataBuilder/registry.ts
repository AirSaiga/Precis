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
 * @fileoverview NodeDataBuilder 注册表
 *
 * 核心入口：buildNodeData(kind, input) → BuildResult
 * 各约束类型通过 registerBuilder 注册到 builders Map 中。
 * 未注册的类型走降级逻辑，返回最小可用数据。
 */

import type { ConstraintKind } from '../types'
import type { BuildInput, BuildResult } from './types'

type BuilderFn = (_input: BuildInput) => BuildResult

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
