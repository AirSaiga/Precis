/**
 * @file resourceFolderStore.ts
 * @description 资源文件夹状态管理
 *
 * 职责：
 * - 管理资源树文件夹的展开/折叠状态
 * - localStorage 持久化
 * - 文件夹资源引用初始化与计数同步
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ResourceFolder, ResourceFolderMap, ResourceItem } from '@/types/resource'

/**
 * 从 localStorage 读取文件夹展开状态
 *
 * @returns 已持久化的展开状态映射表，读取失败时返回空对象
 */
function getStoredFolderState(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem('resourceTreeExpanded')
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore
  }
  return {}
}

/**
 * 将指定文件夹的展开状态持久化到 localStorage
 *
 * 仅对预定义的旧版和新版文件夹 ID 进行持久化，
 * 避免将临时或动态文件夹状态写入存储。
 *
 * @param folderId - 文件夹唯一标识
 * @param expanded - 是否展开
 */
function saveFolderExpandedState(folderId: string, expanded: boolean): void {
  // 旧版文件夹 ID 列表（兼容历史持久化数据）
  const oldFolderIds = ['schemas', 'patterns', 'atomic', 'complex', 'constraints']
  // 新版文件夹 ID 列表（当前资源树结构）
  const newFolderIds = [
    'dataModels',
    'validationAssets',
    'independentConstraints',
    'regexCenter',
    'schemas',
    'patterns',
    'regex_nodes',
    'templates',
  ]

  if (oldFolderIds.includes(folderId) || newFolderIds.includes(folderId)) {
    localStorage.setItem(
      'resourceTreeExpanded',
      JSON.stringify({
        ...getStoredFolderState(),
        [folderId]: expanded,
      })
    )
  }
}

/**
 * 从 localStorage 恢复文件夹展开状态
 *
 * 遍历预定义的顶级文件夹和子文件夹，将存储的状态回写到文件夹对象。
 *
 * @param folders - 资源文件夹映射表
 */
function restoreFolderExpandedState(folders: ResourceFolderMap): void {
  const stored = getStoredFolderState()
  if (Object.keys(stored).length === 0) return

  for (const folderId of ['projectConfig', 'dataModels', 'validationAssets']) {
    if (stored[folderId] !== undefined && folders[folderId]) {
      folders[folderId].expanded = stored[folderId]
    }
  }

  // 恢复二级及以下文件夹的展开状态
  for (const folderId of [
    'schemas',
    'independentConstraints',
    'regexCenter',
    'patterns',
    'regex_nodes',
    'templates',
  ]) {
    if (stored[folderId] === undefined) continue

    // 在 dataModels 的子节点中查找匹配项（如 schemas）
    if (folders.dataModels.children) {
      for (const child of folders.dataModels.children) {
        if (child.id === folderId) {
          child.expanded = stored[folderId]
          break
        }
      }
    }

    // 在 validationAssets 的子节点及孙节点中查找匹配项
    // （如 independentConstraints、regexCenter/patterns、regexCenter/regex_nodes、templates）
    if (folders.validationAssets.children) {
      for (const child of folders.validationAssets.children) {
        if (child.id === folderId) {
          child.expanded = stored[folderId]
        }
        if (child.children) {
          for (const grandchild of child.children) {
            if (grandchild.id === folderId) {
              grandchild.expanded = stored[folderId]
            }
          }
        }
      }
    }
  }
}

export const useResourceFolderStore = defineStore('resourceFolder', () => {
  const folders = ref<ResourceFolderMap>({
    projectConfig: {
      id: 'projectConfig',
      name: 'projectConfig',
      type: 'projectConfig',
      expanded: false,
      count: 0,
      resources: [],
    },
    dataModels: {
      id: 'dataModels',
      name: 'dataModels',
      type: 'dataModels',
      expanded: false,
      count: 0,
      resources: [],
      children: [
        {
          id: 'schemas',
          name: 'schemas',
          type: 'schemas',
          expanded: false,
          count: 0,
          resources: [],
        },
      ],
    },
    validationAssets: {
      id: 'validationAssets',
      name: 'validationAssets',
      type: 'validationAssets',
      expanded: false,
      count: 0,
      resources: [],
      children: [
        {
          id: 'independentConstraints',
          name: 'independentConstraints',
          type: 'independentConstraints',
          expanded: false,
          count: 0,
          resources: [],
        },
        {
          id: 'regexCenter',
          name: 'regexCenter',
          type: 'regexCenter',
          expanded: false,
          count: 0,
          resources: [],
          children: [
            {
              id: 'patterns',
              name: 'patterns',
              type: 'patterns',
              expanded: false,
              count: 0,
              resources: [],
            },
            {
              id: 'regex_nodes',
              name: 'regex_nodes',
              type: 'regex_nodes',
              expanded: false,
              count: 0,
              resources: [],
            },
          ],
        },
        {
          id: 'templates',
          name: 'templates',
          type: 'templates',
          expanded: false,
          count: 0,
          resources: [],
        },
      ],
    },
  })

  restoreFolderExpandedState(folders.value)

  /**
   * 切换指定文件夹的展开/折叠状态
   *
   * 支持顶级文件夹和任意层级的子文件夹。
   * 状态变更后会自动持久化到 localStorage。
   *
   * @param folderId - 文件夹唯一标识
   */
  function toggleFolder(folderId: string): void {
    const topLevelFolderIds = ['projectConfig', 'dataModels', 'validationAssets']
    if (topLevelFolderIds.includes(folderId) && folders.value[folderId]) {
      folders.value[folderId].expanded = !folders.value[folderId].expanded
      saveFolderExpandedState(folderId, folders.value[folderId].expanded)
      return
    }

    const toggleChildFolder = (children: unknown[], id: string): boolean => {
      for (const child of children) {
        const c = child as { id: string; expanded?: boolean; children?: unknown[] }
        if (c.id === id) {
          c.expanded = !c.expanded
          saveFolderExpandedState(id, c.expanded)
          return true
        }
        if (c.children) {
          if (toggleChildFolder(c.children, id)) return true
        }
      }
      return false
    }

    for (const folder of Object.values(folders.value)) {
      if (folder.children && toggleChildFolder(folder.children, folderId)) {
        return
      }
    }
  }

  /**
   * 设置指定文件夹的展开状态（直接赋值，不切换）
   *
   * @param folderId - 文件夹唯一标识
   * @param expanded - 是否展开
   */
  function setFolderExpanded(folderId: string, expanded: boolean): void {
    const folder = folders.value[folderId]
    if (folder) {
      folder.expanded = expanded
    }
  }

  /**
   * 更新各文件夹的资源数量统计
   *
   * 根据后端返回的计数，同步更新 dataModels、validationAssets
   * 及其子文件夹的 count 字段，用于资源树徽章显示。
   *
   * @param counts - 各类资源的数量统计
   */
  function updateFolderCounts(counts: {
    schemas: number
    independentConstraints: number
    patterns: number
    regexNodes: number
    templates: number
  }): void {
    // 更新 dataModels 及其子节点 schemas 的计数
    folders.value.dataModels.count = counts.schemas
    if (folders.value.dataModels.children?.[0]) {
      folders.value.dataModels.children[0].count = counts.schemas
    }

    // 更新 validationAssets 的总计数及其子节点计数
    // validationAssets.children[0] = independentConstraints
    // validationAssets.children[1] = regexCenter
    // validationAssets.children[1].children[0] = patterns
    // validationAssets.children[1].children[1] = regex_nodes
    folders.value.validationAssets.count =
      counts.independentConstraints + counts.patterns + counts.regexNodes + counts.templates
    if (folders.value.validationAssets.children?.[0]) {
      folders.value.validationAssets.children[0].count = counts.independentConstraints
    }
    if (folders.value.validationAssets.children?.[1]?.children) {
      const vaChildren = folders.value.validationAssets.children[1].children
      const patterns = vaChildren[0]
      const regexNodes = vaChildren[1]
      if (patterns) patterns.count = counts.patterns
      if (regexNodes) regexNodes.count = counts.regexNodes
    }
    const templatesFolder = folders.value.validationAssets.children?.find(
      (c) => c.id === 'templates'
    )
    if (templatesFolder) {
      templatesFolder.count = counts.templates
    }
  }

  /**
   * 初始化文件夹内的资源列表
   *
   * 将加载后的资源数据填充到对应的文件夹节点中，
   * 供资源树组件渲染使用。
   *
   * @param data - 按类型分类的资源数据
   */
  function initializeFolderResources(data: {
    schemas: ResourceItem[]
    independentConstraints: ResourceItem[]
    patterns: ResourceItem[]
    regexNodes: ResourceItem[]
    templates: ResourceItem[]
  }): void {
    // dataModels.children[0] = schemas
    if (folders.value.dataModels.children?.[0]) {
      folders.value.dataModels.children[0].resources = data.schemas
    }
    // validationAssets.children[0] = independentConstraints
    if (folders.value.validationAssets.children?.[0]) {
      folders.value.validationAssets.children[0].resources = data.independentConstraints
    }
    // validationAssets.children[1] = regexCenter
    // regexCenter.children[0] = patterns, regexCenter.children[1] = regex_nodes
    if (folders.value.validationAssets.children?.[1]?.children) {
      const vaChildren = folders.value.validationAssets.children[1].children
      const patterns = vaChildren[0]
      const regexNodes = vaChildren[1]
      if (patterns) patterns.resources = data.patterns
      if (regexNodes) regexNodes.resources = data.regexNodes
    }
    // templates 是 validationAssets 下的动态子节点，通过 id 查找
    const templatesFolder = folders.value.validationAssets.children?.find(
      (c) => c.id === 'templates'
    )
    if (templatesFolder) {
      templatesFolder.resources = data.templates
    }
  }

  /**
   * 清空所有文件夹状态
   *
   * 将所有文件夹及其子文件夹的展开状态重置为折叠，
   * 并清空计数。通常在切换项目或重置工作区时调用。
   */
  function clearFolders(): void {
    // 重置所有顶级文件夹为折叠状态
    folders.value.projectConfig.expanded = false
    folders.value.dataModels.expanded = false
    // 重置 dataModels 子节点（schemas）
    if (folders.value.dataModels.children?.[0]) {
      folders.value.dataModels.children[0].expanded = false
    }
    // 重置 validationAssets 及其子节点
    folders.value.validationAssets.expanded = false
    if (folders.value.validationAssets.children?.[0]) {
      folders.value.validationAssets.children[0].expanded = false
    }
    // 重置 regexCenter 及其子节点（patterns、regex_nodes）
    if (folders.value.validationAssets.children?.[1]) {
      folders.value.validationAssets.children[1].expanded = false
      if (folders.value.validationAssets.children[1].children) {
        const vaChildren = folders.value.validationAssets.children[1].children
        const patterns = vaChildren[0]
        const regexNodes = vaChildren[1]
        if (patterns) patterns.expanded = false
        if (regexNodes) regexNodes.expanded = false
      }
    }
    // 重置 templates 文件夹状态并清空资源
    const templatesFolder = folders.value.validationAssets.children?.find(
      (c) => c.id === 'templates'
    )
    if (templatesFolder) {
      templatesFolder.expanded = false
      templatesFolder.count = 0
      templatesFolder.resources = []
    }
    // 清空计数
    folders.value.dataModels.count = 0
    folders.value.validationAssets.count = 0
  }

  return {
    folders,
    toggleFolder,
    setFolderExpanded,
    updateFolderCounts,
    initializeFolderResources,
    clearFolders,
  }
})
