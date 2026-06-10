/**
 * @file resourceTreeStore.ts
 * @description 资源树状态管理
 *
 * Store职责：
 * - 集中管理资源树状态
 * - 提供资源操作的状态更新
 * - 缓存加载的资源数据
 */

import { logger } from '@/core/utils/logger'
import { defineStore, storeToRefs } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { ResourceItem, FolderType, ResourceFolderMap } from '@/types/resource'
import { resourceService } from '@/services/resourceService'
import { ProjectNotFoundError } from '@/api/projectV2Api'
import { toastWarning } from '@/core/toast'
import { useI18n } from 'vue-i18n'
import { useResourceFolderStore } from './resourceFolderStore'
import { useResourceSearchStore } from './resourceSearchStore'
import { useProjectStore } from './projectStore'

/**
 * 资源树 Store 工厂函数
 *
 * 使用 Pinia Setup Store 模式，集中管理项目资源树的状态。
 * 职责：
 * - 维护资源映射表（Schema、Constraint、Pattern、Regex Node、Template）
 * - 提供按类型分类的计算属性列表
 * - 协调 resourceFolderStore（文件夹展开/折叠）与 resourceSearchStore（搜索过滤）
 * - 处理资源加载、刷新、清空等生命周期操作
 */
export const useResourceTreeStore = defineStore('resourceTree', () => {
  const { t } = useI18n()
  const folderStore = useResourceFolderStore()

  // === 状态定义 ===

  /** 加载状态 */
  const loading = ref(false)

  /** 错误信息 */
  const error = ref<string | null>(null)

  /** 资源映射表 */
  const resources = ref<Record<string, ResourceItem>>({})

  /** 文件夹状态（委托给 resourceFolderStore） */
  const { folders } = storeToRefs(folderStore) as unknown as { folders: Ref<ResourceFolderMap> }

  // === 计算属性 ===

  /** 资源列表（数组形式） */
  const resourceList = computed(() => Object.values(resources.value))

  /** Schema资源列表 */
  const schemas = computed(() => resourceList.value.filter((r) => r.kind === 'schema'))

  /** 已列入 manifest 的 Schema 数量（用于资源树徽章显示） */
  const schemasManifestCount = computed(
    () =>
      schemas.value.filter(
        (r) => (r.meta as { listedInManifest?: boolean } | undefined)?.listedInManifest === true
      ).length
  )
  /** 未列入 manifest 的 Schema 数量 */
  const schemasUnlistedCount = computed(() =>
    Math.max(0, schemas.value.length - schemasManifestCount.value)
  )

  /** Pattern资源列表 */
  const patterns = computed(() => resourceList.value.filter((r) => r.kind === 'pattern'))

  /** Regex Node资源列表 */
  const regexNodes = computed(() => resourceList.value.filter((r) => r.kind === 'regex_node'))

  /** 已列入 manifest 的 Regex Node 数量 */
  const regexNodesManifestCount = computed(
    () =>
      regexNodes.value.filter(
        (r) => (r.meta as { listedInManifest?: boolean } | undefined)?.listedInManifest === true
      ).length
  )
  /** 未列入 manifest 的 Regex Node 数量 */
  const regexNodesUnlistedCount = computed(() =>
    Math.max(0, regexNodes.value.length - regexNodesManifestCount.value)
  )

  /** Constraint资源列表 */
  const constraints = computed(() => resourceList.value.filter((r) => r.kind === 'constraint'))

  /** Template资源列表 */
  const templates = computed(() => resourceList.value.filter((r) => r.kind === 'template'))

  /** 独立约束资源列表（constraintSource === 'independent'） */
  const independentConstraints = computed(() =>
    constraints.value.filter(
      (r) => (r as { constraintSource?: string }).constraintSource === 'independent'
    )
  )
  /** 内嵌约束资源列表（constraintSource === 'embedded'） */
  const embeddedConstraints = computed(() =>
    constraints.value.filter(
      (r) => (r as { constraintSource?: string }).constraintSource === 'embedded'
    )
  )

  /** 已列入 manifest 的独立约束数量 */
  const independentConstraintsManifestCount = computed(
    () =>
      independentConstraints.value.filter(
        (r) => (r.meta as { listedInManifest?: boolean } | undefined)?.listedInManifest === true
      ).length
  )
  /** 未列入 manifest 的独立约束数量 */
  const independentConstraintsUnlistedCount = computed(() =>
    Math.max(0, independentConstraints.value.length - independentConstraintsManifestCount.value)
  )

  /** 已列入 manifest 的内嵌约束数量 */
  const embeddedConstraintsManifestCount = computed(
    () =>
      embeddedConstraints.value.filter(
        (r) => (r.meta as { listedInManifest?: boolean } | undefined)?.listedInManifest === true
      ).length
  )
  /** 未列入 manifest 的内嵌约束数量 */
  const embeddedConstraintsUnlistedCount = computed(() =>
    Math.max(0, embeddedConstraints.value.length - embeddedConstraintsManifestCount.value)
  )

  const searchStore = useResourceSearchStore()

  /** 过滤后的资源（委托给 resourceSearchStore） */
  const filteredResources = computed(() => searchStore.filterResources(resourceList.value))

  /** 过滤后的文件夹状态（根据搜索关键词） */
  const filteredFolders = computed(() => {
    const isSearching = searchStore.searchQuery.trim().length > 0

    // 获取目标资源列表（根据搜索状态选择源）
    const getTargetResources = (
      kind: string,
      sourceComputed: ResourceItem[],
      registryFilter?: (r: ResourceItem) => boolean
    ) => {
      if (isSearching) {
        return filteredResources.value.filter((r) => {
          if (r.kind !== kind) return false
          return registryFilter ? registryFilter(r) : true
        })
      }
      return sourceComputed
    }

    const targetSchemas = getTargetResources('schema', schemas.value)
    const targetConstraints = getTargetResources('constraint', constraints.value)

    const targetPatterns = getTargetResources('pattern', patterns.value)
    const targetRegexNodes = getTargetResources('regex_node', regexNodes.value)
    const targetTemplates = getTargetResources('template', templates.value)

    // 过滤独立约束（constraintSource === 'independent'）
    const targetIndependentConstraints = targetConstraints.filter(
      (c) => (c as { constraintSource?: string }).constraintSource === 'independent'
    )

    return {
      projectConfig: {
        ...folders.value.projectConfig,
        expanded: isSearching
          ? folders.value.projectConfig.count > 0
          : folders.value.projectConfig.expanded,
      },
      dataModels: {
        ...folders.value.dataModels,
        expanded: isSearching ? targetSchemas.length > 0 : folders.value.dataModels.expanded,
        children: [
          {
            ...folders.value.dataModels.children?.[0],
            id: 'schemas',
            name: 'schemas',
            type: 'schemas' as const,
            expanded: isSearching
              ? targetSchemas.length > 0
              : (folders.value.dataModels.children?.[0]?.expanded ?? false),
            count: targetSchemas.length,
            resources: targetSchemas,
          },
        ],
      },
      validationAssets: {
        ...folders.value.validationAssets,
        expanded: isSearching
          ? targetIndependentConstraints.length > 0 ||
            targetPatterns.length > 0 ||
            targetRegexNodes.length > 0 ||
            targetTemplates.length > 0
          : folders.value.validationAssets.expanded,
        children: [
          {
            ...folders.value.validationAssets.children?.[0],
            id: 'independentConstraints',
            name: 'independentConstraints',
            type: 'independentConstraints' as const,
            expanded: isSearching
              ? targetIndependentConstraints.length > 0
              : (folders.value.validationAssets.children?.[0]?.expanded ?? false),
            count: targetIndependentConstraints.length,
            resources: targetIndependentConstraints,
          },
          {
            ...folders.value.validationAssets.children?.[1],
            id: 'regexCenter',
            name: 'regexCenter',
            type: 'regexCenter' as const,
            expanded: isSearching
              ? targetPatterns.length > 0 || targetRegexNodes.length > 0
              : (folders.value.validationAssets.children?.[1]?.expanded ?? false),
            count: targetPatterns.length + targetRegexNodes.length,
            resources: [],
            children: [
              {
                ...folders.value.validationAssets.children?.[1]?.children?.[0],
                id: 'patterns',
                name: 'patterns',
                type: 'patterns' as const,
                expanded: isSearching
                  ? targetPatterns.length > 0
                  : (folders.value.validationAssets.children?.[1]?.children?.[0]?.expanded ??
                    false),
                count: targetPatterns.length,
                resources: targetPatterns,
              },
              {
                ...folders.value.validationAssets.children?.[1]?.children?.[1],
                id: 'regex_nodes',
                name: 'regex_nodes',
                type: 'regex_nodes' as const,
                expanded: isSearching
                  ? targetRegexNodes.length > 0
                  : (folders.value.validationAssets.children?.[1]?.children?.[1]?.expanded ??
                    false),
                count: targetRegexNodes.length,
                resources: targetRegexNodes,
              },
            ],
          },
          {
            ...(folders.value.validationAssets.children?.find((c) => c.id === 'templates') || {
              id: 'templates',
              name: 'templates',
              type: 'templates',
              expanded: false,
              count: 0,
              resources: [],
            }),
            id: 'templates',
            name: 'templates',
            type: 'templates' as const,
            expanded: isSearching
              ? targetTemplates.length > 0
              : (folders.value.validationAssets.children?.find((c) => c.id === 'templates')
                  ?.expanded ?? false),
            count: targetTemplates.length,
            resources: targetTemplates,
          },
        ],
      },
    }
  })

  /**
   * 根据文件夹类型获取对应的资源列表
   *
   * 用于资源树渲染时按文件夹类型获取要展示的资源数据。
   *
   * @param folderType - 文件夹类型标识
   * @returns 该类型对应的资源列表
   */
  const getResourcesByFolderType = (folderType: FolderType): ResourceItem[] => {
    switch (folderType) {
      case 'schemas':
        return schemas.value
      case 'patterns':
        return patterns.value
      case 'regex_nodes':
        return regexNodes.value
      case 'constraints':
      case 'independentConstraints':
        return constraints.value.filter(
          (c) => (c as { constraintSource?: string }).constraintSource === 'independent'
        )
      case 'dataModels':
        return schemas.value
      case 'validationAssets':
        return []
      case 'regexCenter':
        return []
      case 'templates':
        return templates.value
      case 'projectConfig':
        return []
      default:
        return []
    }
  }

  // === Actions ===

  /**
   * 加载项目资源（Schema、Constraint、Pattern、Regex Node）
   *
   * 流程：
   * 1. 调用 resourceService 解析项目配置
   * 2. 更新资源映射表和文件夹计数
   * 3. 处理配置文件解析错误（如果有）
   *
   * @param path - 项目配置根目录路径
   */
  async function loadResources(path: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const fullConfig = await resourceService.loadFullConfig(path)
      const resourceItems = resourceService.parseResources(fullConfig)

      // 更新资源映射
      resources.value = resourceItems.reduce(
        (acc, item) => {
          acc[item.id] = item
          return acc
        },
        {} as Record<string, ResourceItem>
      )

      const independentConstraints = constraints.value.filter(
        (c) => (c as { constraintSource?: string }).constraintSource === 'independent'
      )

      folderStore.updateFolderCounts({
        schemas: schemas.value.length,
        independentConstraints: independentConstraints.length,
        patterns: patterns.value.length,
        regexNodes: regexNodes.value.length,
        templates: templates.value.length,
      })

      folderStore.initializeFolderResources({
        schemas: schemas.value,
        independentConstraints,
        patterns: patterns.value,
        regexNodes: regexNodes.value,
        templates: templates.value,
      })

      // 兼容旧代码：schemas, patterns, regex_nodes, constraints 保持引用
      ;(folders.value as unknown as Record<string, unknown>).schemas = {
        resources: schemas.value,
        count: schemas.value.length,
      }
      ;(folders.value as unknown as Record<string, unknown>).patterns = {
        resources: patterns.value,
        count: patterns.value.length,
      }
      ;(folders.value as unknown as Record<string, unknown>).regex_nodes = {
        resources: regexNodes.value,
        count: regexNodes.value.length,
      }
      ;(folders.value as unknown as Record<string, unknown>).constraints = {
        resources: constraints.value,
        count: constraints.value.length,
      }

      // 提示配置文件解析错误
      const schemaErrors = fullConfig.schema_errors
      if (schemaErrors && Object.keys(schemaErrors).length > 0) {
        const errorList = Object.entries(schemaErrors)
          .map(([id, msg]) => `${id}: ${msg}`)
          .join('\n')
        toastWarning(
          t('messages.persistence.configParseFailed', { list: errorList }),
          t('messages.persistence.configWarningTitle')
        )
      }

      // 路径由调用方提供，不维护本地副本
    } catch (e) {
      // 项目路径不存在时静默处理（无项目时的正常状态）
      if (e instanceof ProjectNotFoundError) {
        logger.debug('[ResourceTreeStore] 项目路径不存在，跳过加载:', e.configPath)
        error.value = null
      } else {
        error.value = e instanceof Error ? e.message : t('messages.error.loadResourceFailed')
        logger.error('[ResourceTreeStore] 加载资源失败:', e)
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * 刷新资源列表
   *
   * 重新调用 loadResources 加载当前配置路径下的资源，
   * 用于用户在项目外修改配置文件后同步最新状态。
   */
  async function refreshResources(): Promise<void> {
    const projectStore = useProjectStore()
    const path = projectStore.currentPaths?.configPath
    if (path) {
      await loadResources(path)
    }
  }

  /**
   * 切换文件夹展开状态（委托给 resourceFolderStore）
   */
  function toggleFolder(folderId: string): void {
    folderStore.toggleFolder(folderId)
  }

  /**
   * 设置文件夹展开状态（委托给 resourceFolderStore）
   */
  function setFolderExpanded(folderId: string, expanded: boolean): void {
    folderStore.setFolderExpanded(folderId, expanded)
  }

  /**
   * 设置搜索关键词（委托给 resourceSearchStore）
   */
  function setSearchQuery(query: string): void {
    searchStore.setSearchQuery(query)
  }

  /**
   * 根据资源 ID 获取资源对象
   *
   * @param id - 资源唯一标识
   * @returns 对应的资源对象，未找到时返回 undefined
   */
  function getResourceById(id: string): ResourceItem | undefined {
    return resources.value[id]
  }

  /**
   * 轻量级更新资源显示名称
   *
   * 仅更新内存中的 name 字段，不触发后端 API 调用。
   * 用于画布上名称变更后同步资源树显示。
   *
   * @param resourceId - 资源 ID
   * @param newName - 新的显示名称
   */
  function updateResourceName(resourceId: string, newName: string): void {
    const resource = resources.value[resourceId]
    if (resource) {
      resources.value = {
        ...resources.value,
        [resourceId]: { ...resource, name: newName },
      }
    }
  }

  /**
   * 清空资源树所有状态
   *
   * 重置资源映射、搜索词、加载状态及配置路径，
   * 并委托 folderStore 清空文件夹状态。
   * 通常在关闭项目或切换项目时调用。
   */
  function clear(): void {
    resources.value = {}
    searchStore.clearSearch()
    error.value = null
    loading.value = false
    folderStore.clearFolders()
  }

  /**
   * 初始化文件夹资源引用（委托给 resourceFolderStore）
   */
  function initializeFolderResources(): void {
    const independentConstraints = constraints.value.filter(
      (c) => (c as { constraintSource?: string }).constraintSource === 'independent'
    )

    folderStore.initializeFolderResources({
      schemas: schemas.value,
      independentConstraints,
      patterns: patterns.value,
      regexNodes: regexNodes.value,
      templates: templates.value,
    })
  }

  // === 导出 ===
  /**
   * Store 对外暴露的响应式状态、计算属性与操作方法
   *
   * 状态：loading / error / searchQuery / resources / folders
   * 计算属性：resourceList / schemas / patterns / regexNodes / constraints / templates 及其 manifest/unlisted 计数
   * 方法：loadResources / refreshResources / toggleFolder / setFolderExpanded / setSearchQuery / getResourceById / getResourcesByFolderType / clear / initializeFolderResources
   */
  return {
    // 状态
    loading,
    error,
    searchQuery: searchStore.searchQuery,
    resources,
    folders,

    // 计算属性
    resourceList,
    schemas,
    schemasManifestCount,
    schemasUnlistedCount,
    patterns,
    regexNodes,
    regexNodesManifestCount,
    regexNodesUnlistedCount,
    constraints,
    independentConstraints,
    embeddedConstraints,
    independentConstraintsManifestCount,
    independentConstraintsUnlistedCount,
    embeddedConstraintsManifestCount,
    embeddedConstraintsUnlistedCount,
    templates,
    filteredResources,
    filteredFolders,

    // 方法
    loadResources,
    refreshResources,
    toggleFolder,
    setFolderExpanded,
    setSearchQuery,
    getResourceById,
    updateResourceName,
    getResourcesByFolderType,
    clear,
    initializeFolderResources,
  }
})
