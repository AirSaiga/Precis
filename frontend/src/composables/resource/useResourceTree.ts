/**
 * @file useResourceTree.ts
 * @description 资源树组合式函数
 *
 * 功能职责：
 * - 提供资源树的数据获取和状态管理
 * - 封装资源树的交互逻辑
 * - 与ResourceTreeStore配合使用
 */

import { logger } from '@/core/utils/logger'
import { computed, onMounted, onUnmounted, watch, ref as vueRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useResourceTreeStore } from '@/stores/resourceTreeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useGraphStore } from '@/stores/graphStore'
import { resourceService } from '@/services/resourceService'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { useToast } from '@/composables/shared'
import type { ResourceItem, FolderType } from '@/types/resource'

export function useResourceTree() {
  const { t } = useI18n()

  // Stores
  const treeStore = useResourceTreeStore()
  const projectStore = useProjectStore()
  const graphStore = useGraphStore()
  const { showConfirm } = useGlobalConfirm()
  const { error: showError } = useToast()

  // 响应式状态
  const {
    loading,
    error,
    searchQuery,
    folders,
    schemas,
    patterns,
    regexNodes,
    constraints,
    filteredResources,
    filteredFolders,
    resourceList,
  } = storeToRefs(treeStore)

  // === 多选状态管理 ===

  /** 是否处于多选模式 */
  const isMultiSelectMode = vueRef(false)

  /** 选中的资源ID集合 */
  const selectedResources = vueRef<Set<string>>(new Set())

  /** 选中的资源列表 */
  const selectedResourceList = computed(() => {
    return Array.from(selectedResources.value)
      .map((id) => treeStore.getResourceById(id))
      .filter(Boolean) as ResourceItem[]
  })

  /** 是否有多选 */
  const hasSelection = computed(() => selectedResources.value.size > 0)

  /** 切换单选 */
  const toggleSelect = (resource: ResourceItem): void => {
    const newSet = new Set(selectedResources.value)
    if (newSet.has(resource.id)) {
      newSet.delete(resource.id)
      if (newSet.size === 0) {
        isMultiSelectMode.value = false
      }
    } else {
      newSet.add(resource.id)
    }
    selectedResources.value = newSet
  }

  /** 检查资源是否被选中 */
  const isSelected = (id: string): boolean => {
    return selectedResources.value.has(id)
  }

  /** 清空选择 */
  const clearSelection = (): void => {
    selectedResources.value = new Set()
    isMultiSelectMode.value = false
  }

  /** 进入多选模式 */
  const enterMultiSelectMode = (): void => {
    isMultiSelectMode.value = true
  }

  /** 退出多选模式 */
  const exitMultiSelectMode = (): void => {
    clearSelection()
  }

  /** 全选当前可见资源 */
  const selectAll = (): void => {
    const allResources = filteredResources.value
    selectedResources.value = new Set(allResources.map((r) => r.id))
  }

  // === 资源加载 ===

  /**
   * 加载项目资源
   */
  const loadProjectResources = async (): Promise<void> => {
    const path = projectStore.currentPaths?.configPath
    if (!path) {
      logger.warn('[useResourceTree] 未设置项目路径，无法加载资源')
      return
    }

    await treeStore.loadResources(path)
  }

  /**
   * 刷新资源
   */
  const refreshResources = async (): Promise<void> => {
    await treeStore.refreshResources()
  }

  // === 资源操作 ===

  /**
   * 加载Schema到画布
   */
  const loadSchemaToCanvas = async (schema: ResourceItem): Promise<string | null> => {
    try {
      const position = { x: 200, y: 100 }
      const nodeId = await graphStore.importV2ResourceToCanvas('schema', schema.id, position, {
        includeDeps: true,
        moveIfExists: true,
      })
      logger.debug('[useResourceTree] Schema节点已创建:', nodeId)
      return nodeId
    } catch (err) {
      logger.error('[useResourceTree] 加载Schema失败:', err)
      return null
    }
  }

  /**
   * 加载Pattern到画布
   */
  const loadPatternToCanvas = async (pattern: ResourceItem): Promise<string | null> => {
    try {
      const position = { x: 300, y: 150 }
      const nodeId = await graphStore.importV2ResourceToCanvas('pattern', pattern.id, position, {
        includeDeps: true,
        moveIfExists: true,
      })
      logger.debug('[useResourceTree] Pattern节点已创建:', nodeId)
      return nodeId
    } catch (err) {
      logger.error('[useResourceTree] 加载Pattern失败:', err)
      return null
    }
  }

  /**
   * 加载Constraint到画布
   */
  const loadConstraintToCanvas = async (constraint: ResourceItem): Promise<string | null> => {
    try {
      const position = { x: 400, y: 200 }
      const nodeId = await graphStore.importV2ResourceToCanvas(
        'constraint',
        constraint.id,
        position,
        { includeDeps: true, moveIfExists: true }
      )
      logger.debug('[useResourceTree] Constraint节点已创建:', nodeId)
      return nodeId
    } catch (err) {
      logger.error('[useResourceTree] 加载Constraint失败:', err)
      return null
    }
  }

  /**
   * 根据资源类型加载到画布
   */
  const loadResourceToCanvas = async (
    resource: ResourceItem,
    customPosition?: { x: number; y: number }
  ): Promise<string | null> => {
    const position = customPosition || { x: 240, y: 120 }

    switch (resource.kind) {
      case 'schema':
        return loadSchemaToCanvas(resource)
      case 'pattern':
        return loadPatternToCanvas(resource)
      case 'constraint':
        return loadConstraintToCanvas(resource)
      default:
        logger.warn('[useResourceTree] 不支持的资源类型:', resource.kind)
        return null
    }
  }

  // === 批量操作 ===

  /**
   * 批量添加资源到画布
   * 使用 Promise.all 并行加载所有资源，提升性能
   */
  const batchAddToCanvas = async (resources: ResourceItem[]): Promise<void> => {
    if (resources.length === 0) return

    const basePosition = { x: 200, y: 100 }
    const offsetY = 80

    const loadPromises = resources.map((resource, index) => {
      const position = {
        x: basePosition.x,
        y: basePosition.y + index * offsetY,
      }

      return graphStore
        .importV2ResourceToCanvas(
          resource.kind as 'schema' | 'pattern' | 'constraint',
          resource.id,
          position,
          { includeDeps: true, moveIfExists: true }
        )
        .then(() => {
          logger.debug(`[useResourceTree] 批量添加: ${resource.name} -> 节点已创建`)
        })
        .catch((err) => {
          logger.error(`[useResourceTree] 批量添加失败: ${resource.name}`, err)
        })
    })

    await Promise.all(loadPromises)

    clearSelection()
  }

  /**
   * 批量删除资源
   */
  const batchDelete = async (resources: ResourceItem[]): Promise<void> => {
    if (resources.length === 0) return

    const count = resources.length
    const ok = await showConfirm({
      title: t('common.confirmDialog.title'),
      message: t('assetLibraryExtended.projectView.multiSelect.deleteConfirm', { count }),
      type: 'warning',
    })

    if (!ok) return

    const path = projectStore.currentPaths?.configPath
    if (!path) {
      showError(t('common.error'), t('common.error'))
      return
    }

    for (const resource of resources) {
      try {
        switch (resource.kind) {
          case 'schema':
            await resourceService.deleteSchema(resource.id, path)
            break
          case 'pattern':
            await resourceService.deletePattern(resource.id, path)
            break
          case 'regex_node':
            await resourceService.deleteRegexNode(resource.id, path)
            break
          case 'constraint':
            await resourceService.deleteConstraint(resource.id, path)
            break
          default:
            logger.error(`[useResourceTree] 未知的资源类型: ${resource.kind}`)
        }

        const node = graphStore.nodes.find((n) => n.id === resource.id)
        if (node) {
          graphStore.deleteNode(node.id)
        }
      } catch (err) {
        logger.error(`[useResourceTree] 删除资源失败: ${resource.name}`, err)
        showError(
          err instanceof Error ? err.message : t('common.unknownError'),
          t('assetLibraryExtended.projectView.resourceContext.deleteFailedTitle')
        )
      }
    }

    clearSelection()
    await treeStore.refreshResources()
  }

  // === 文件夹操作 ===

  /**
   * 切换文件夹展开状态
   */
  const toggleFolder = (folderId: string): void => {
    treeStore.toggleFolder(folderId)
  }

  /**
   * 设置搜索关键词
   */
  const setSearchQuery = (query: string): void => {
    treeStore.setSearchQuery(query)
  }

  // === 资源查找 ===

  /**
   * 根据ID查找资源
   */
  const findResourceById = (id: string): ResourceItem | undefined => {
    return treeStore.getResourceById(id)
  }

  /**
   * 根据文件夹类型获取资源
   */
  const getResourcesByFolderType = (folderType: FolderType): ResourceItem[] => {
    return treeStore.getResourcesByFolderType(folderType)
  }

  // === 画布定位 ===

  /**
   * 在画布上定位资源
   */
  const locateResourceOnCanvas = async (resource: ResourceItem): Promise<void> => {
    // 先检查是否已在画布上
    const existingNode = graphStore.nodes.find((n) => n.id === resource.id)
    if (existingNode) {
      graphStore.setSelectedNode(existingNode.id)
      return
    }

    // 不在画布上，则加载到画布
    await loadResourceToCanvas(resource)
  }

  // === 事件处理 ===

  /**
   * 处理项目应用事件
   */
  const handleProjectApplied = (): void => {
    logger.debug('[useResourceTree] 收到 project-applied 事件')
    loadProjectResources()

    // 检查是否需要展开文件夹
    const shouldExpand = localStorage.getItem('resourceTreeExpanded') === 'true'
    if (shouldExpand) {
      treeStore.setFolderExpanded('schemas', true)
      treeStore.setFolderExpanded('patterns', true)
      treeStore.setFolderExpanded('atomic', true)
      treeStore.setFolderExpanded('constraints', true)
    }
  }

  // === 初始化文件夹资源 ===

  /**
   * 初始化文件夹资源引用
   */
  const initializeFolderResources = (): void => {
    treeStore.initializeFolderResources()
  }

  // === 生命周期 ===

  onMounted(() => {
    window.addEventListener('project-applied', handleProjectApplied as EventListener)

    if (projectStore.isProjectActive) {
      loadProjectResources()
    }
  })

  onUnmounted(() => {
    window.removeEventListener('project-applied', handleProjectApplied as EventListener)
  })

  // 监听资源变化，更新文件夹引用
  watch(
    [schemas, patterns, constraints],
    () => {
      initializeFolderResources()
    },
    { deep: true }
  )

  // === 暴露接口 ===

  return {
    // 状态
    loading,
    error,
    searchQuery,
    folders,
    filteredFolders,
    schemas,
    patterns,
    regexNodes,
    constraints,
    filteredResources,
    resourceList,

    // 多选状态
    selectedResources,
    selectedResourceList,
    hasSelection,
    isMultiSelectMode,
    toggleSelect,
    isSelected,
    clearSelection,
    selectAll,
    enterMultiSelectMode,
    exitMultiSelectMode,

    // 资源加载
    loadProjectResources,
    refreshResources,

    // 资源操作
    loadSchemaToCanvas,
    loadPatternToCanvas,
    loadConstraintToCanvas,
    loadResourceToCanvas,

    // 批量操作
    batchAddToCanvas,
    batchDelete,

    // 文件夹操作
    toggleFolder,
    setSearchQuery,

    // 资源查找
    findResourceById,
    getResourcesByFolderType,

    // 画布定位
    locateResourceOnCanvas,

    // Store actions
    clear: treeStore.clear,
  }
}
