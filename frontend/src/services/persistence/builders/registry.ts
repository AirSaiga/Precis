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
 * @fileoverview Builder 自注册表
 *
 * 所有 builder 通过 registerBuilder() 注册到全局 registry。
 * 新增节点类型时无需修改 orchestrator，只需添加 builder 文件并注册。
 */

import type { CustomNode } from '@/types/graph'
import type { NodeBuilder } from '../types'

const builderRegistry: NodeBuilder<unknown>[] = []

/**
 * 注册一个 builder
 *
 * @param builder - 要注册的 builder 实例
 */
export function registerBuilder<T>(builder: NodeBuilder<T>): void {
  builderRegistry.push(builder as NodeBuilder<unknown>)
}

/**
 * 获取所有已注册的 builder
 */
export function getAllBuilders(): readonly NodeBuilder<unknown>[] {
  return builderRegistry
}

/**
 * 查找能处理指定节点的 builder
 */
export function findBuilderFor(node: CustomNode): NodeBuilder<unknown> | undefined {
  return builderRegistry.find((b) => b.matches(node))
}

/**
 * 按 kind 过滤 builder
 */
export function findBuildersByKind(kind: NodeBuilder<unknown>['kind']): NodeBuilder<unknown>[] {
  return builderRegistry.filter((b) => b.kind === kind)
}

/**
 * 清空注册表（仅用于测试）
 */
export function clearBuildersForTest(): void {
  builderRegistry.length = 0
}
