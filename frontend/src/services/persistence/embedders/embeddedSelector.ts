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
 * @fileoverview Embedded Selector
 *
 * 决定一个约束节点是写入 schema 文件的内嵌位置，还是独立的 .constraint.yaml 文件。
 */

import type { CustomNode } from '@/types/graph'

/**
 * 判断约束节点是否应该嵌入 schema
 */
export function shouldEmbedInSchema(node: CustomNode, schemaNodes: CustomNode[]): boolean {
  // 规则 0: Composite 强制独立（后端 ConstraintItem Literal 不支持）
  if (node.type === 'compositeConstraint') {
    return false
  }

  const nodeData = (node.data || {}) as Record<string, unknown>

  // 规则 1: 显式标记为内嵌
  if (nodeData.embedded === true) {
    return true
  }

  // 规则 2: 有 sourceRef 且指向 schema 节点
  const sourceRef = nodeData.sourceRef as { nodeId?: string } | undefined
  if (sourceRef?.nodeId) {
    const target = schemaNodes.find((n) => n.id === sourceRef.nodeId)
    if (target && (target.type === 'schema' || target.type === 'jsonSchema')) {
      return true
    }
  }

  // 默认独立
  return false
}

/**
 * 分类节点：哪些内嵌、哪些独立
 */
export function classifyConstraints(
  constraintNodes: CustomNode[],
  schemaNodes: CustomNode[]
): { embedded: CustomNode[]; standalone: CustomNode[] } {
  const embedded: CustomNode[] = []
  const standalone: CustomNode[] = []

  for (const node of constraintNodes) {
    if (shouldEmbedInSchema(node, schemaNodes)) {
      embedded.push(node)
    } else {
      standalone.push(node)
    }
  }

  return { embedded, standalone }
}
