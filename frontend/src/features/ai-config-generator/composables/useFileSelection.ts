/**
 * @file useFileSelection.ts
 * @description AI 配置生成中的文件选择状态管理组合式函数
 *
 * 功能概述:
 * - 管理用户选择的数据源文件/文件夹路径
 * - 调用后端展开文件夹为文件列表
 * - 维护文件勾选状态（全选/反选/单选）
 * - 从工作区和画布中自动收集已关联的数据源
 * - 支持 Electron 文件/文件夹选择对话框
 *
 * 架构设计:
 * - 依赖 Pinia store（graphStore / workspaceStore）获取现有数据源
 * - 依赖 configPath 计算属性向后端请求路径展开
 * - selectedPaths 变更时自动触发 expandedFiles 更新
 *
 * 输入示例:
 *   const fileSelection = useFileSelection(effectiveConfigPath)
 *   fileSelection.selectedPaths.value = ['/path/to/data.csv']
 *
 * 输出示例:
 *   fileSelection.expandedFiles.value   // ['C:\\project\\data.csv']
 *   fileSelection.checkedFiles.value    // Set { 'C:\\project\\data.csv' }
 */
import { logger } from '@/core/utils/logger'
import { ref, watch, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { postExpandPaths } from '@/api/aiApi'
import { getV2Manifest } from '@/api/projectV2Api'

export function useFileSelection(
  configPath: ComputedRef<string | undefined>
) {
  const { t } = useI18n()
  const graphStore = useGraphStore()
  const workspaceStore = useWorkspaceStore()

  /** 用户原始选择的输入路径列表 */
  const selectedPaths = ref<string[]>([])

  /** 展开后的文件路径列表 */
  const expandedFiles = ref<string[]>([])

  /** 当前勾选的文件路径集合 */
  const checkedFiles = ref<Set<string>>(new Set())

  /** 是否正在展开路径 */
  const isExpanding = ref(false)

  /**
   * 调用后端将 selectedPaths 展开为具体文件列表
   */
  const updateExpandedFiles = async () => {
    if (selectedPaths.value.length === 0) {
      expandedFiles.value = []
      checkedFiles.value = new Set()
      return
    }

    isExpanding.value = true
    try {
      const files = await postExpandPaths(selectedPaths.value, configPath.value)
      expandedFiles.value = files
      // 默认全选
      checkedFiles.value = new Set(files)
    } catch (e) {
      logger.error('Failed to expand paths', e)
      expandedFiles.value = []
      checkedFiles.value = new Set()
    } finally {
      isExpanding.value = false
    }
  }

  // selectedPaths 变更时自动展开
  watch(selectedPaths, () => {
    void updateExpandedFiles()
  })

  /**
   * 切换单个文件的勾选状态
   */
  const toggleFile = (file: string) => {
    const next = new Set(checkedFiles.value)
    if (next.has(file)) {
      next.delete(file)
    } else {
      next.add(file)
    }
    checkedFiles.value = next
  }

  /**
   * 全选或反选所有展开的文件
   */
  const toggleAllFiles = () => {
    if (checkedFiles.value.size === expandedFiles.value.length) {
      checkedFiles.value = new Set()
    } else {
      checkedFiles.value = new Set(expandedFiles.value)
    }
  }

  /**
   * 从工作区数据源和画布节点中收集已关联的数据源文件路径
   */
  const collectExistingDataSources = (): string[] => {
    const paths = new Set<string>()
    // 1. 从 workspaceStore 的 ready 数据源收集
    for (const ds of workspaceStore.readyDataSources) {
      if (ds.fileId) {
        paths.add(ds.fileId)
      }
    }
    // 2. 从画布节点收集（作为补充）
    for (const node of graphStore.nodes) {
      const data = (node.data || {}) as Record<string, unknown>
      const path = (data.localPath as string) || ''
      if (path && typeof path === 'string') {
        paths.add(path)
      }
    }
    return Array.from(paths)
  }

  /**
   * 规范化并合并用户新选择的路径，避免重复项
   */
  const mergeSelectedPaths = (paths: string[]) => {
    const cleaned = paths
      .filter((p: unknown): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    if (cleaned.length === 0) return

    const existing = new Set(selectedPaths.value)
    const merged = [...selectedPaths.value]
    for (const p of cleaned) {
      if (!existing.has(p)) {
        existing.add(p)
        merged.push(p)
      }
    }
    selectedPaths.value = merged
  }

  /**
   * 选择数据文件（支持多选）
   */
  const pickFiles = async () => {
    const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as
      | { showOpenDialog?: (opts: unknown) => Promise<unknown> }
      | undefined
    if (!electronAPI?.showOpenDialog) {
      window.$toast?.error(t('common.error'), t('aiConfigGenerator.errors.electronOnly'))
      return
    }

    const res = await electronAPI.showOpenDialog({
      title: t('aiConfigGenerator.dialog.title'),
      buttonLabel: t('aiConfigGenerator.dialog.confirm'),
      filters: [{ name: 'Data Files', extensions: ['csv', 'xlsx', 'xls'] }],
      properties: ['openFile', 'multiSelections'],
    })

    const paths = Array.isArray((res as Record<string, unknown>)?.filePaths)
      ? ((res as Record<string, unknown>).filePaths as string[])
      : []
    mergeSelectedPaths(paths)
  }

  /**
   * 选择数据文件夹（支持多选）
   */
  const pickFolders = async () => {
    const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as
      | { showOpenDialog?: (opts: unknown) => Promise<unknown> }
      | undefined
    if (!electronAPI?.showOpenDialog) {
      window.$toast?.error(t('common.error'), t('aiConfigGenerator.errors.electronOnly'))
      return
    }

    const res = await electronAPI.showOpenDialog({
      title: t('aiConfigGenerator.dialog.folderTitle'),
      buttonLabel: t('aiConfigGenerator.dialog.confirm'),
      properties: ['openDirectory', 'multiSelections'],
    })

    const paths = Array.isArray((res as Record<string, unknown>)?.filePaths)
      ? ((res as Record<string, unknown>).filePaths as string[])
      : []
    mergeSelectedPaths(paths)
  }

  /**
   * 从项目 manifest 的 data_sources 中加载配置的目录路径
   */
  const loadProjectDataSources = async () => {
    if (!configPath.value) return
    try {
      const manifest = await getV2Manifest(configPath.value)
      const paths: string[] = []
      for (const ds of manifest.data_sources || []) {
        if (ds.mode === 'absolute') {
          paths.push(ds.path)
        } else if (configPath.value) {
          // 相对路径基于 configPath 解析
          const base = configPath.value.replace(/\\/g, '/')
          const absPath = `${base}/${ds.path}`.replace(/\//g, '\\')
          paths.push(absPath)
        }
      }
      if (paths.length > 0) {
        mergeSelectedPaths(paths)
      }
    } catch (e) {
      logger.warn('Failed to load project data sources from manifest', e)
    }
  }

  /**
   * 清空所有选择状态
   */
  const clearSelection = () => {
    selectedPaths.value = []
    expandedFiles.value = []
    checkedFiles.value = new Set()
    isExpanding.value = false
  }

  return {
    selectedPaths,
    expandedFiles,
    checkedFiles,
    isExpanding,
    updateExpandedFiles,
    toggleFile,
    toggleAllFiles,
    mergeSelectedPaths,
    pickFiles,
    pickFolders,
    collectExistingDataSources,
    loadProjectDataSources,
    clearSelection,
  }
}
