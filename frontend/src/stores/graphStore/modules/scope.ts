/**
 * @file scope.ts
 * @description 作用域管理模块 - 管理画布的分组/分区视图
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. switchScope: 切换当前的作用域/分组视图
 * 2. getSubGraphStats: 获取指定节点下的子图统计信息
 *
 * ====================================================================
 * 作用域概念
 * ====================================================================
 * 作用域用于在复杂项目中组织和隔离节点：
 * - 可以按功能模块划分节点
 * - 可以按项目结构划分节点
 * - 方便在大型项目中管理节点
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
 * - 轻量级模块，只关注统计和切换
 * - 使用依赖注入获取响应式状态
 * - switchScope 目前是占位实现
 *
 * ====================================================================
 * 潜在扩展方向
 * ====================================================================
 * - 实现节点分组/折叠功能
 * - 实现作用域隔离（只显示作用域内节点）
 * - 实现跨作用域连接可视化
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 目前无明显副作用
 * - switchScope 待实现具体逻辑
 *
 * @module graphStore/modules
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

export function createScopeModule(params: { nodes: Ref<CustomNode[]>; edges: Ref<Edge[]> }) {
  const { nodes, edges } = params

  function switchScope(scopeId: string | null) {
    logger.debug('切换作用域:', scopeId)
  }

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
    switchScope,
    getSubGraphStats,
  }
}
