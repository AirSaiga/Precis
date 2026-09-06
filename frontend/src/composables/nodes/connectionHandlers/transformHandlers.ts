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
 * @file transformHandlers.ts
 * @description Transform 连接处理（E15）
 *
 * - E15 → transform(transform-input)：更新 transform 节点的上游输入引用
 *   支持 manualData / transformOutput 作为输入源，自动填充默认参数（StringSplit）
 */

import type { ConnectionContext } from './types'

/**
 * 处理 Transform 连接（E15）
 *
 * 仅当 targetNode.type === 'transform' 且 targetHandle === 'transform-input' 时处理。
 * 不匹配时 no-op。
 */
export function handleTransformConnection(ctx: ConnectionContext): void {
  const { sourceNode, targetNode, targetHandle, connection, tx } = ctx

  if (targetNode.type !== 'transform' || targetHandle !== 'transform-input') {
    return
  }

  let inputColumn: string | undefined

  if (sourceNode.type === 'manualData') {
    const manualData = sourceNode.data as unknown as Record<string, unknown>
    inputColumn = (manualData.columnName as string) || 'Column1'
  } else if (sourceNode.type === 'transformOutput') {
    const outputData = sourceNode.data as unknown as Record<string, unknown>
    inputColumn = (outputData.columnName as string) || 'Column1'
  }

  const transformData = targetNode.data as unknown as Record<string, unknown>
  const currentParams = (transformData.params as Record<string, unknown>) || {}
  const transformType = (transformData.transformType as string) || 'StringSplit'

  // 如果参数为空，自动填充该类型的默认参数
  const nextParams: Record<string, unknown> =
    Object.keys(currentParams).length === 0
      ? transformType === 'StringSplit'
        ? { delimiter: ',', maxsplit: -1 }
        : currentParams
      : currentParams

  tx.patchNodeData(targetNode.id, {
    inputFromNode: connection.source,
    inputColumn,
    params: nextParams,
    saveState: 'draft',
  })
}
