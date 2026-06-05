/**
 * @file useDataSourceTree.ts
 * @description 数据源树形结构管理组合式函数
 *
 * 功能概述:
 * - 将扁平的数据源列表按 folderPath 分组为树形结构
 * - 管理文件夹展开/折叠状态
 * - 提供扁平化的树节点列表供 TransitionGroup 渲染
 *
 * 架构设计:
 * - 使用 computed 自动响应数据源变化
 * - collapsedFolders 使用 ref(new Set()) + 重新赋值确保触发更新
 * - 树节点包含文件夹节点和文件节点两种类型
 *
 * 输入示例:
 *   workspaceStore.dataSources = [
 *     { id: 'ds1', name: 'a.xlsx', folderPath: 'folder1', ... },
 *     { id: 'ds2', name: 'b.csv', folderPath: 'folder1/sub', ... }
 *   ]
 *
 * 输出示例:
 *   dataSourcesTree = [
 *     { type: 'folder', id: 'folder_folder1', name: 'folder1', level: 0, isExpanded: true },
 *     { type: 'folder', id: 'folder_folder1/sub', name: 'sub', level: 1, isExpanded: true },
 *     { type: 'file', id: 'ds2', name: 'b.csv', level: 2, dataSource: {...} },
 *     { type: 'file', id: 'ds1', name: 'a.xlsx', level: 1, dataSource: {...} }
 *   ]
 */

import { ref, computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { logger } from '@/core/utils/logger'
import type { ExternalDataSource } from '@/types/graph'

/**
 * 树形节点项类型
 */
export interface TreeNodeItem {
  type: 'folder' | 'file'
  id: string
  name: string
  folderPath?: string
  dataSource?: ExternalDataSource
  level: number
  isExpanded?: boolean
  children?: TreeNodeItem[]
}

/**
 * 使用数据源树形结构
 *
 * @returns 树形结构相关状态和操作
 */
export function useDataSourceTree() {
  /**
   * 工作区状态管理 Store
   */
  const workspaceStore = useWorkspaceStore()

  /**
   * 已折叠的文件夹路径集合
   * 使用 ref(new Set()) + 重新赋值确保触发更新
   */
  const collapsedFolders = ref<Set<string>>(new Set())

  /**
   * 构建数据源树形结构
   *
   * 将数据源按 folderPath 分组，创建文件夹节点和文件节点，
   * 支持空文件夹路径（根目录文件），最终返回扁平化数组。
   */
  const dataSourcesTree = computed<TreeNodeItem[]>(() => {
    const dataSources = workspaceStore.getDataSources()

    logger.debug(
      '[useDataSourceTree] dataSourcesTree 计算:',
      dataSources.map((ds) => ({ name: ds.name, folderPath: ds.folderPath, isFolder: ds.isFolder }))
    )

    if (dataSources.length === 0) {
      logger.debug('[useDataSourceTree] 数据源为空')
      return []
    }

    const tree: TreeNodeItem[] = []
    const folderMap = new Map<string, TreeNodeItem>()
    const folderPaths = new Set<string>()

    // 首先，收集所有需要创建的文件夹路径（包括根文件夹）
    for (const ds of dataSources) {
      if (ds.folderPath) {
        const parts = ds.folderPath.split(/[/\\]/)
        // 添加根文件夹（第一个部分）
        if (parts.length >= 1) {
          const firstPart = parts[0]
          if (firstPart !== undefined) {
            folderPaths.add(firstPart)
          }
        }
        // 添加所有中间文件夹
        let currentPath = ''
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]
          if (part === undefined) continue
          currentPath = currentPath ? `${currentPath}/${part}` : part
          folderPaths.add(currentPath)
        }
      }
    }
    logger.debug('[useDataSourceTree] 收集到的文件夹路径:', Array.from(folderPaths))

    const sortedFolderPaths = Array.from(folderPaths).sort((a, b) => a.localeCompare(b))

    for (const folderPath of sortedFolderPaths) {
      const parts = folderPath.split(/[/\\]/)
      const folderName = parts[parts.length - 1] ?? folderPath
      // 计算文件夹层级：根文件夹 level = 0，子文件夹 level = 路径中 '/' 的数量
      const level = parts.length - 1

      const folderNode: TreeNodeItem = {
        type: 'folder',
        id: `folder_${folderPath}`,
        name: folderName,
        folderPath: folderPath,
        level: level,
        isExpanded: !collapsedFolders.value.has(folderPath),
        children: [],
      }

      folderMap.set(folderPath, folderNode)

      const parentPath = parts.slice(0, -1).join('/')
      if (parentPath && folderMap.has(parentPath)) {
        const parentFolder = folderMap.get(parentPath)
        if (parentFolder && parentFolder.children) {
          parentFolder.children.push(folderNode)
        }
      } else {
        tree.push(folderNode)
      }
    }

    logger.debug('[useDataSourceTree] 文件夹节点:', folderMap.keys())

    for (const ds of dataSources) {
      // 文件节点的 level 应该是其父文件夹的 level + 1
      let fileLevel = 0
      if (ds.folderPath) {
        const parts = ds.folderPath.split(/[/\\]/)
        fileLevel = parts.length
      }

      const fileNode: TreeNodeItem = {
        type: 'file',
        id: ds.id,
        name: ds.name,
        folderPath: ds.folderPath,
        dataSource: ds,
        level: fileLevel,
      }

      if (ds.folderPath) {
        const parts = ds.folderPath.split(/[/\\]/)
        // 文件的父文件夹是 folderPath 的第一部分（根文件夹）
        const rootFolder = parts[0]

        if (rootFolder && folderMap.has(rootFolder)) {
          const parentFolder = folderMap.get(rootFolder)
          if (parentFolder && parentFolder.children) {
            parentFolder.children.push(fileNode)
          }
        } else {
          tree.push(fileNode)
        }
      } else {
        tree.push(fileNode)
      }
    }

    const flattenedTree: TreeNodeItem[] = []

    const addNodeAndChildren = (node: TreeNodeItem) => {
      flattenedTree.push(node)
      if (node.type === 'folder' && node.isExpanded && node.children) {
        for (const child of node.children) {
          addNodeAndChildren(child)
        }
      }
    }

    for (const node of tree) {
      addNodeAndChildren(node)
    }

    logger.debug(
      '[useDataSourceTree] 生成的树形结构:',
      flattenedTree.map((n) => ({ type: n.type, name: n.name, level: n.level }))
    )

    return flattenedTree
  })

  /**
   * 切换文件夹展开/折叠状态
   *
   * @param folderPath - 要切换的文件夹路径
   */
  const toggleFolder = (folderPath: string) => {
    logger.debug(
      '[useDataSourceTree] toggleFolder 调用:',
      folderPath,
      '当前状态:',
      !collapsedFolders.value.has(folderPath) ? '展开' : '折叠'
    )
    const newSet = new Set(collapsedFolders.value)
    if (newSet.has(folderPath)) {
      newSet.delete(folderPath)
      logger.debug('[useDataSourceTree] 展开文件夹:', folderPath)
    } else {
      newSet.add(folderPath)
      logger.debug('[useDataSourceTree] 折叠文件夹:', folderPath)
    }
    collapsedFolders.value = newSet
  }

  return {
    collapsedFolders,
    dataSourcesTree,
    toggleFolder,
  }
}
