/**
 * @file libraryNodesFactory.ts
 * @description 资产库节点工厂模块 - 负责创建项目资产库相关的特殊节点
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. createPatternToolboxNode: 创建正则模式工具箱节点
 * 2. createConstraintDashboardNode: 创建约束仪表盘节点
 *
 * ====================================================================
 * PatternToolboxNode（正则模式工具箱）
 * ====================================================================
 * - 展示项目中定义的所有正则模式
 * - 支持按 scope 筛选（'patterns': 仅预定义模式，'all': 全部）
 * - 从 V2 配置的 manifest.regex_nodes 读取模式列表
 * - 解析模式的 registry 属性判断模式来源（预定义/自定义）
 *
 * ====================================================================
 * ConstraintDashboardNode（约束仪表盘）
 * ====================================================================
 * - 展示项目中所有约束的概览信息
 * - 从 V2 配置的 manifest.constraints 读取约束列表
 * - 自动关联约束相关的 Schema 节点 ID
 * - 显示约束类型和描述信息
 *
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 两个节点都采用单例模式：已存在则更新位置，不存在则创建
 * - 节点 ID 固定（pattern-toolbox-{scope}, constraint-dashboard）
 * - 使用 getV2FullConfig 异步加载配置数据
 * - 自动设置新创建的节点为选中状态
 *
 * ====================================================================
 * 数据来源
 * ====================================================================
 * - Pattern 数据: config.manifest.regex_nodes + config.regex_nodes
 * - Constraint 数据: config.manifest.constraints + config.constraints
 * - 配置路径: getEffectiveProjectConfigPath() 获取
 *
 * ====================================================================
 * 错误处理
 * ====================================================================
 * - 如果没有配置路径，打印警告并返回 null
 * - 配置加载失败会抛出异常，由调用方处理
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 异步加载 V2 配置（可能触发 API 请求）
 * - 创建后自动设为选中状态
 * - 节点 saveState 初始为 'saved'（表示无需额外保存）
 *
 * @module graphStore/modules/factories
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { getV2FullConfig } from '@/api/projectV2Api'

export function createLibraryNodesFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  getEffectiveProjectConfigPath: () => string | undefined
}) {
  const { nodes, selectedNodeId, getEffectiveProjectConfigPath } = params

  async function createPatternToolboxNode(
    position: { x: number; y: number },
    scope: 'patterns' | 'all'
  ) {
    const existing = nodes.value.find(
      (n) => n.type === 'patternToolbox' && ((n.data as unknown) as Record<string, unknown>)?.scope === scope
    )
    if (existing) {
      existing.position = { ...position }
      selectedNodeId.value = existing.id
      return existing.id
    }

    const configPath = getEffectiveProjectConfigPath()
    if (!configPath) {
      logger.warn('[createPatternToolboxNode] No config path found')
      return null
    }

    const config = await getV2FullConfig(configPath)
    logger.debug('[createPatternToolboxNode] Loaded config:', {
      regexCount: (((config.manifest as unknown) as Record<string, unknown>).regex_nodes as unknown[])?.length,
      regexKeys: Object.keys((((config as unknown) as Record<string, unknown>).regex_nodes || {}) as Record<string, unknown>),
      manifestRegex: ((config.manifest as unknown) as Record<string, unknown>).regex_nodes,
    })

    const manifestRegexRefs =
      ((((config.manifest as unknown) as Record<string, unknown>).regex_nodes || []) as Array<{ id: string; path?: string }>) || []

    const resolvePatterns = (targetScope: 'patterns' | 'all') =>
      manifestRegexRefs
        .filter((r) => {
          if (targetScope === 'all') return true
          const node = ((config as unknown) as Record<string, unknown>).regex_nodes as Record<string, unknown> | undefined
          const nodeRec = node?.[r.id] as Record<string, unknown> | undefined
          let registry = ((nodeRec as Record<string, unknown> | undefined)?.uses_pattern as Record<string, unknown> | undefined)?.registry
          if (!registry && r.path) {
            if (r.path.startsWith('patterns/') || r.path.includes('/patterns/')) {
              registry = 'patterns'
            }
          }

          return registry === targetScope
        })
        .map((r) => {
          const node2 = ((config as unknown) as Record<string, unknown>).regex_nodes as Record<string, unknown> | undefined
          const nodeRec2 = node2?.[r.id] as Record<string, unknown> | undefined
          return { id: r.id, name: nodeRec2?.name || r.id }
        })

    let patterns = resolvePatterns(scope)
    if (patterns.length === 0 && scope !== 'all') {
      patterns = resolvePatterns('all')
    }

    const nodeId = `pattern-toolbox-${scope}`
    const node: CustomNode = {
      id: nodeId,
      type: 'patternToolbox',
      position,
      data: {
        scope,
        patterns,
        saveState: 'saved',
      } as unknown as CustomNodeData,
    }

    nodes.value.push(node)
    selectedNodeId.value = node.id
    return node.id
  }

  async function createConstraintDashboardNode(position: { x: number; y: number }) {
    const existing = nodes.value.find((n) => n.type === 'constraintDashboard')
    if (existing) {
      existing.position = { ...position }
      selectedNodeId.value = existing.id
      return existing.id
    }

    const configPath = getEffectiveProjectConfigPath()
    if (!configPath) {
      logger.warn('[createConstraintDashboardNode] No config path found')
      return null
    }

    const config = await getV2FullConfig(configPath)
    logger.debug('[createConstraintDashboardNode] Loaded config:', {
      constraintsCount: config.manifest.constraints?.length,
      constraintKeys: Object.keys((((config as unknown) as Record<string, unknown>).constraints || {}) as Record<string, unknown>),
      manifestConstraints: config.manifest.constraints,
    })

    const items = (config.manifest.constraints || []).map((ref) => {
      const c = ((config as unknown) as Record<string, unknown>).constraints as Record<string, unknown> | undefined
      const cRec = c?.[ref.id] as Record<string, unknown> | undefined
      const name = cRec?.description || cRec?.type || ref.id
      const refs = cRec?.refs || {}
      const relatedSchemaIds: string[] = []
      if (cRec?.type === 'ForeignKey') {
        if ((refs as Record<string, unknown>)?.from_table_id) relatedSchemaIds.push(String((refs as Record<string, unknown>).from_table_id))
        if ((refs as Record<string, unknown>)?.to_table_id) relatedSchemaIds.push(String((refs as Record<string, unknown>).to_table_id))
      } else if ((refs as Record<string, unknown>)?.table_id) {
        relatedSchemaIds.push(String((refs as Record<string, unknown>).table_id))
      }
      return { id: ref.id, name, type: cRec?.type, relatedSchemaIds }
    })

    const node: CustomNode = {
      id: 'constraint-dashboard',
      type: 'constraintDashboard',
      position,
      data: { items, saveState: 'saved' } as unknown as CustomNodeData,
    }

    nodes.value.push(node)
    selectedNodeId.value = node.id
    return node.id
  }

  return {
    createPatternToolboxNode,
    createConstraintDashboardNode,
  }
}
