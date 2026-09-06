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
 * @file schemaSourceHandlers.ts
 * @description Schema 数据源连接处理（E5/E6：SourcePreview → Schema）
 *
 * - E5 sourcePreview → schema：绑定数据源（异步）
 * - E6 jsonSourcePreview → jsonSchema：JSON 数据源绑定（异步）
 *
 * 这两个分支调用子 composable（schemaConnection/jsonSchemaHandler），
 * 子 composable 内部可能直接调 store.updateNodeData（绕过 tx）——这是现状，不改。
 */

import type { ConnectionContext } from './types'

/**
 * 处理 Schema 数据源连接（E5/E6）
 *
 * 类型条件互斥，串联执行安全。不匹配时 no-op。
 */
export async function handleSchemaSourceConnection(ctx: ConnectionContext): Promise<void> {
  const { sourceNode, targetNode, connection } = ctx

  // E5: sourcePreview → schema（异步绑定数据源）
  if (sourceNode.type === 'sourcePreview' && targetNode.type === 'schema') {
    await ctx.schemaConnection.handleSourceToSchemaConnection(sourceNode.id, targetNode.id)
    return
  }

  // E6: jsonSourcePreview → jsonSchema（异步 JSON 数据源绑定）
  if (sourceNode.type === 'jsonSourcePreview' && targetNode.type === 'jsonSchema') {
    await ctx.jsonSchemaHandler.handleSourceConnection({
      source: connection.source,
      target: connection.target,
    })
    return
  }
}
