/**
 * @file scope.ts
 * @description 子图统计辅助模块
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * getSubGraphStats: 获取指定节点下的子图统计信息（供 Set 节点徽标显示）
 *
 * ====================================================================
 * getSubGraphStats 统计维度
 * ====================================================================
 * 统计指定节点的所有直接子节点的类型分布：
 * - totalNodes: 子节点总数
 * - schemaNodes: Schema 节点数量
 * - constraintNodes: 约束节点数量
 * - regexNodes: 正则节点数量
 * - ruleCount: 规则数量（等同于 constraintNodes）
 * - tableCount: 表数量（等同于 schemaNodes）
 *
 * ====================================================================
 * 统计计算逻辑
 * ====================================================================
 * - 通过 edges 查找所有 source 为指定节点 ID 的边
 * - 收集所有 target 节点
 * - 按节点类型分类计数
 * - 仅统计直接子节点，不递归
 *
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 轻量级模块，只关注统计
 * - 使用依赖注入获取响应式状态
 *
 * @module graphStore/modules
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

export function createScopeModule(params: { nodes: Ref<CustomNode[]>; edges: Ref<Edge[]> }) {
  const { nodes, edges } = params

  function getSubGraphStats(nodeId: string) {
    const children = nodes.value.filter((n) =>
      edges.value.some((e) => e.source === nodeId && e.target === n.id)
    )

    const schemaCount = children.filter((n) => n.type === 'schema').length
    const constraintCount = children.filter((n) => isConstraintNodeType(n.type)).length
    const regexCount = children.filter((n) => n.type === 'regex').length

    return {
      totalNodes: children.length,
      schemaNodes: schemaCount,
      constraintNodes: constraintCount,
      regexNodes: regexCount,
      ruleCount: constraintCount,
      regexCount: regexCount,
      tableCount: schemaCount,
    }
  }

  return {
    getSubGraphStats,
  }
}
