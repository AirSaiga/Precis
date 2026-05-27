/**
 * @file projectLifecycle.ts
 * @description 项目生命周期管理模块 - 管理项目的创建、加载、清理等生命周期操作
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. createProject: 创建新项目，初始化项目状态
 * 2. clearProject: 清理当前项目，重置所有状态
 * 3. resetCanvas: 重置画布（保留项目但清空画布内容）
 * 4. createProjectRootNode: 创建项目根节点
 * 5. createProjectConsoleNode: 创建项目控制台节点（向后兼容）
 *
 * ====================================================================
 * createProject 初始化流程
 * ====================================================================
 * 1. 清空画布状态（nodes, edges）
 * 2. 清空选中状态
 * 3. 设置项目名称和路径
 * 4. 标记项目已加载
 * 5. 重置统计信息
 * 6. 持久化到 projectStore
 *
 * ====================================================================
 * clearProject 清理流程
 * ====================================================================
 * 1. 清空画布状态（nodes, edges）
 * 2. 清空资产列表
 * 3. 清空选中状态
 * 4. 清空项目信息
 * 5. 重置统计信息
 * 6. 清理 projectStore
 * 7. 清理资源树
 *
 * ====================================================================
 * ProjectRoot 节点设计
 * ====================================================================
 * - 单例模式：只允许存在一个 ProjectRoot 节点
 * - 节点 ID 固定为 'project-root'
 * - 不可拖拽（draggable: false）
 * - 包含项目统计信息（schemaCount, constraintCount, regexCount）
 * - 包含项目设置（projectSettings）
 *
 * ====================================================================
 * 项目路径管理
 * ====================================================================
 * - 使用 normalizeConfigDir 标准化路径
 * - 同时更新 projectPath.value 和 projectStore（双重同步）
 * - 确保刷新后路径不会丢失
 *
 * ====================================================================
 * 向后兼容
 * ====================================================================
 * - createProjectConsoleNode 是 createProjectRootNode 的别名
 * - 旧版本使用 'projectConsole' 作为节点类型
 * - load.ts 中会自动迁移旧节点
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - createProject: 重置多个响应式状态
 * - clearProject: 重置多个响应式状态，调用其他 store 的清理方法
 * - createProjectRootNode: 可能更新 selectedNodeId
 *
 * @module graphStore/modules
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, TableAsset } from '@/types/graph'
import type { ProjectNodeData } from '@/types/nodes'
import type { FullValidationSummary, ValidationStatistics } from '@/api/projectValidationApi'
import { useProjectStore } from '@/stores/projectStore'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'

export function createProjectLifecycleModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  assets: Ref<TableAsset[]>
  selectedNodeId: Ref<string | null>
  selectedNodeIds: Ref<string[]>
  selectionBox: Ref<{ x: number; y: number; width: number; height: number } | null>
  projectName: Ref<string>
  isProjectLoaded: Ref<boolean>
  projectConfigStats: Ref<{
    schemaCount: number
    constraintCount: number
    regexCount: number
    transformCount: number
  }>
  projectConfigStatsLoaded: Ref<boolean>
  projectConfigStatsConfigPath: Ref<string>
  lastFullValidationSummary: Ref<FullValidationSummary | null>
  lastFullValidationStatistics: Ref<ValidationStatistics | null>
  designModalVisible: Ref<boolean>
  activeRegexNodeId: Ref<string | null>
  regexEditSampleData: Ref<string>
  copiedNodes: Ref<CustomNode[]>
  normalizeConfigDir: (inputPath: string) => string
  refreshProjectConfigStats: (configPath?: string) => Promise<boolean>
}) {
  const {
    nodes,
    edges,
    assets,
    selectedNodeId,
    selectedNodeIds,
    selectionBox,
    projectName,
    isProjectLoaded,
    projectConfigStats,
    projectConfigStatsLoaded,
    projectConfigStatsConfigPath,
    lastFullValidationSummary,
    lastFullValidationStatistics,
    designModalVisible,
    activeRegexNodeId,
    regexEditSampleData,
    copiedNodes,
    normalizeConfigDir,
    refreshProjectConfigStats,
  } = params

  function createProject(name: string, path: string) {
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
    selectedNodeIds.value = []
    selectionBox.value = null

    projectName.value = name
    const normalizedPath = normalizeConfigDir(path)
    isProjectLoaded.value = true
    projectConfigStats.value = {
      schemaCount: 0,
      constraintCount: 0,
      regexCount: 0,
      transformCount: 0,
    }
    projectConfigStatsLoaded.value = false
    projectConfigStatsConfigPath.value = ''

    // 清理跨项目可能泄漏的状态（F10）
    lastFullValidationSummary.value = null
    lastFullValidationStatistics.value = null
    designModalVisible.value = false
    activeRegexNodeId.value = null
    regexEditSampleData.value = ''
    copiedNodes.value = []

    const projectStore = useProjectStore()
    projectStore.setProjectPaths({ configPath: normalizedPath, dataPath: normalizedPath })
  }

  function clearProject() {
    nodes.value = []
    edges.value = []
    assets.value = []
    selectedNodeId.value = null
    selectedNodeIds.value = []
    selectionBox.value = null
    projectName.value = ''
    isProjectLoaded.value = false
    projectConfigStats.value = {
      schemaCount: 0,
      constraintCount: 0,
      regexCount: 0,
      transformCount: 0,
    }
    projectConfigStatsLoaded.value = false
    projectConfigStatsConfigPath.value = ''

    // 清理跨项目可能泄漏的状态（F10）
    lastFullValidationSummary.value = null
    lastFullValidationStatistics.value = null
    designModalVisible.value = false
    activeRegexNodeId.value = null
    regexEditSampleData.value = ''
    copiedNodes.value = []

    const projectStore = useProjectStore()
    projectStore.clearProject()

    const resourceTreeStore = useResourceTreeStore()
    resourceTreeStore.clear()
  }

  function resetCanvas() {
    nodes.value = []
    edges.value = []
    assets.value = []
    selectedNodeId.value = null
    selectedNodeIds.value = []
    selectionBox.value = null
    // 注意：保留 projectName/projectPath/isProjectLoaded，
    // 因为 resetCanvas 主要用于工作区切换场景（F11）
  }

  function createProjectConsoleNode(position: { x: number; y: number }) {
    return createProjectRootNode(position)
  }

  function createProjectRootNode(position: { x: number; y: number }) {
    const existing = nodes.value.find((n) => n.type === 'projectRoot')
    if (existing) {
      existing.position = { ...position }
      selectedNodeId.value = existing.id
      return existing.id
    }

    const projectStore = useProjectStore()

    const node: CustomNode = {
      id: 'project-root',
      type: 'projectRoot',
      position,
      draggable: false,
      data: {
        projectName: projectName.value || 'Project',
        projectPath: projectStore.currentPaths?.configPath || '',
        configPath: projectStore.currentPaths?.configPath || '',
      } as ProjectNodeData,
    }

    nodes.value.push(node)
    selectedNodeId.value = node.id
    return node.id
  }

  return {
    createProject,
    clearProject,
    resetCanvas,
    createProjectConsoleNode,
    createProjectRootNode,
  }
}
