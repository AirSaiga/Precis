/**
 * @file v2Persistence.ts
 * @description V2 持久化与加载（save/load/refresh stats）
 *
 * 该模块封装 V2 配置的保存、单节点保存、项目加载与配置统计刷新逻辑。
 * 采用依赖注入方式接入 graphStore，避免循环依赖。
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import type { FullValidationSummary, ValidationStatistics } from '@/api/projectValidationApi'
import { createV2StatsOps } from './v2/persistence/stats'
import { createV2SaveOps } from './v2/persistence/save'
import { createV2LoadOps } from './v2/persistence/load'

/**
 * @description 创建 V2 持久化管理模块
 * @param {Object} params - 依赖注入参数对象
 * @param {Ref<CustomNode[]>} params.nodes - 画布节点列表的响应式引用
 * @param {Ref<Edge[]>} params.edges - 画布边列表的响应式引用
 * @param {Ref<string | null>} params.selectedNodeId - 当前被选中的节点 ID
 * @param {Ref<string>} params.projectName - 项目名称
 * @param {Ref<string>} params.projectPath - 项目路径
 * @param {Ref<boolean>} params.isProjectLoaded - 项目是否已加载
 * @param {Ref<Object>} params.projectConfigStats - 项目配置统计信息（schema/constraint/regex 数量等）
 * @param {Ref<boolean>} params.projectConfigStatsLoaded - 配置统计是否已加载
 * @param {Ref<string>} params.projectConfigStatsConfigPath - 当前统计对应的配置文件路径
 * @param {Ref<FullValidationSummary | null>} params.lastFullValidationSummary - 最近一次完整校验的摘要结果
 * @param {Ref<ValidationStatistics | null>} params.lastFullValidationStatistics - 最近一次完整校验的统计数据
 * @param {(inputPath: string) => string} params.normalizeConfigDir - 规范化配置目录路径的函数
 * @param {() => string | undefined} params.getEffectiveProjectConfigPath - 获取当前生效的项目配置文件路径
 * @param {(configDir: string | undefined, relPath: string | undefined) => string | undefined} params.resolveProjectRelativePath - 将项目内相对路径解析为绝对路径
 * @returns {Object} 合并了 statsOps、saveOps、loadOps 所有方法的对象
 */
export function createV2PersistenceModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  projectName: Ref<string>
  isProjectLoaded: Ref<boolean>
  projectConfigStats: Ref<{
    schemaCount: number
    constraintCount: number
    constraintStandaloneCount: number
    constraintInlineCount: number
    regexCount: number
    transformCount: number
    templateCount: number
  }>
  projectConfigStatsLoaded: Ref<boolean>
  projectConfigStatsConfigPath: Ref<string>
  lastFullValidationSummary: Ref<FullValidationSummary | null>
  lastFullValidationStatistics: Ref<ValidationStatistics | null>
  normalizeConfigDir: (inputPath: string) => string
  getEffectiveProjectConfigPath: () => string | undefined
  resolveProjectRelativePath: (
    configDir: string | undefined,
    relPath: string | undefined
  ) => string | undefined
  updateNodeData: (nodeId: string, newData: Partial<CustomNode['data']>) => void
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    normalizeConfigDir,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    updateNodeData,
  } = params

  // 初始化统计操作子模块
  const statsOps = createV2StatsOps({
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    normalizeConfigDir,
    getEffectiveProjectConfigPath,
  })

  // 初始化保存操作子模块
  const saveOps = createV2SaveOps({
    nodes,
    edges,
    projectName,
    getEffectiveProjectConfigPath,
    updateNodeData,
  })

  // 初始化加载操作子模块，并将 saveOps.saveProject 注入其中，以便加载后自动保存
  const loadOps = createV2LoadOps({
    nodes,
    edges,
    selectedNodeId,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    getEffectiveProjectConfigPath,
    resolveProjectRelativePath,
    saveProject: saveOps.saveProject,
  })

  return {
    ...statsOps,
    ...saveOps,
    ...loadOps,
  }
}
