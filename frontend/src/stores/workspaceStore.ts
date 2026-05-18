/**
 * @file workspaceStore.ts
 * @description Workspace 状态管理（门面 Store）
 *
 * 管理本地数据源配置，保存到工作目录下的配置文件。
 * 后端配置加载/保存委托给 workspaceConfigService。
 */

import { logger } from '@/core/utils/logger'
import { ref, computed, unref } from 'vue'
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import type { ExternalDataSource, WorkspaceConfig } from '@/types/graph'
import i18n from '@/i18n'
import { checkFileExists } from '@/core/utils/electronDetector'
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  createDefaultConfig,
} from '@/services/workspaceConfigService'
import { useProjectStore } from '@/stores/projectStore'
import {
  normalizePath,
  ensureDirPath,
  isAbsolutePath,
  resolveRelativePath,
} from '@/core/utils/pathNormalization'

export const useWorkspaceStore = defineStore('workspace', () => {
  // --- State ---
  // 工作区配置，包含最近使用的数据源列表和别名映射
  const config = ref<WorkspaceConfig>(createDefaultConfig())

  // --- Getters ---

  /** 全部数据源（含不可用状态） */
  const dataSources = computed(() => config.value.recent_data_sources)

  /** 状态为 ready 的数据源，可用于校验 */
  const readyDataSources = computed(() =>
    config.value.recent_data_sources.filter((ds) => ds.status === 'ready')
  )

  /** 状态为 missing 的数据源，文件已不存在或路径失效 */
  const missingDataSources = computed(() =>
    config.value.recent_data_sources.filter((ds) => ds.status === 'missing')
  )

  // ============================================================================
  // 路径规范化辅助函数（已迁移至 pathNormalization.ts）
  // ============================================================================

  // --- Actions: 配置加载与保存 ---

  /** 从后端加载工作区配置（应用启动时调用） */
  async function loadConfig() {
    config.value = await loadWorkspaceConfig()
  }

  /** 将当前工作区配置保存到后端 */
  async function saveConfig() {
    await saveWorkspaceConfig(config.value)
  }

  // --- Actions: 数据源管理 ---

  /**
   * 添加或更新数据源
   *
   * 如果 fileId 已存在则更新其元信息（最后使用时间、路径等），
   * 否则创建新数据源并插入列表头部。
   *
   * @param fileId - 文件唯一标识（Electron 下为绝对路径，Web 下为文件名）
   * @param fileName - 文件显示名称
   * @param fileType - 文件类型（excel / csv / json）
   * @param _sourceMode - 来源模式，当前固定为 'localfile'
   * @param localPath - 本地文件绝对路径
   * @param folderPath - 文件所在文件夹路径
   * @param fileSize - 文件大小（字节）
   * @returns 数据源 ID
   */
  async function addDataSource(
    fileId: string,
    fileName: string,
    fileType: 'excel' | 'csv' | 'json',
    _sourceMode?: 'localfile',
    localPath?: string,
    folderPath?: string,
    fileSize?: number
  ) {
    // 将相对路径统一转换为绝对路径，确保 workspace store 中只存储绝对路径
    const projectStore = useProjectStore()
    const rawProjectRoot =
      projectStore.currentPaths?.configPath || projectStore.currentPaths?.dataPath
    // 确保 projectRoot 是目录路径而非文件路径，防止拼接出畸形路径
    const projectRoot = rawProjectRoot ? ensureDirPath(rawProjectRoot) : ''
    // 将相对路径解析为绝对路径，然后标准化
    const resolvedFileId =
      projectRoot && !isAbsolutePath(fileId)
        ? resolveRelativePath(fileId, projectRoot) || fileId
        : fileId
    const resolvedLocalPath =
      localPath && projectRoot && !isAbsolutePath(localPath)
        ? resolveRelativePath(localPath, projectRoot) || localPath
        : localPath || resolvedFileId

    // 【强制绝对路径策略】如果解析后仍然不是绝对路径，说明项目根目录未设置或传入的就是相对路径
    // 拒绝存储相对路径，防止后端无法定位文件
    if (!isAbsolutePath(resolvedFileId)) {
      logger.error(
        '[WorkspaceStore] 拒绝添加数据源：fileId 为相对路径且无法解析为绝对路径。',
        'fileId:',
        fileId,
        'projectRoot:',
        projectRoot
      )
      throw new Error('数据源路径必须是绝对路径')
    }
    if (resolvedLocalPath && !isAbsolutePath(resolvedLocalPath)) {
      logger.error(
        '[WorkspaceStore] 拒绝添加数据源：localPath 为相对路径且无法解析为绝对路径。',
        'localPath:',
        localPath,
        'projectRoot:',
        projectRoot
      )
      throw new Error('数据源路径必须是绝对路径')
    }

    // 存储层只保存标准化后的路径
    const normalizedFileId = normalizePath(resolvedFileId)
    const normalizedLocalPath = normalizePath(resolvedLocalPath)

    // 使用标准化后的路径进行查找
    const existing = config.value.recent_data_sources.find((ds) => {
      return (
        normalizePath(ds.fileId || '') === normalizedFileId ||
        normalizePath(ds.localPath || '') === normalizedFileId
      )
    })
    if (existing) {
      existing.lastUsed = new Date().toISOString()
      existing.status = 'ready'
      existing.sourceMode = 'localfile'
      // 确保现有条目也使用标准化后的绝对路径
      if (!isAbsolutePath(existing.fileId) && projectRoot) {
        const resolved = resolveRelativePath(existing.fileId, projectRoot)
        if (resolved) existing.fileId = normalizePath(resolved)
      }
      if (!isAbsolutePath(existing.localPath || '') && projectRoot) {
        const resolved = resolveRelativePath(existing.localPath || existing.fileId, projectRoot)
        if (resolved) existing.localPath = normalizePath(resolved)
      }
      if (normalizedLocalPath) {
        existing.localPath = normalizedLocalPath
      }
      if (folderPath !== undefined) {
        let fp = normalizePath(folderPath)
        if (projectRoot && isAbsolutePath(fp)) {
          const normalizedProjectRoot = normalizePath(projectRoot)
          if (fp.startsWith(normalizedProjectRoot)) {
            fp = fp.slice(normalizedProjectRoot.length).replace(/^\//, '')
          }
        }
        existing.folderPath = fp
      }
      if (fileSize !== undefined) {
        existing.size = fileSize
      }
      await saveConfig()
      return existing.id
    }

    // 对 folderPath 进行标准化，并尽可能转换为相对项目根目录的路径
    // 这样外部数据树可以按项目内目录结构分组，而不是按绝对路径的盘符分组
    let normalizedFolderPath = folderPath ? normalizePath(folderPath) : undefined
    if (normalizedFolderPath && projectRoot && isAbsolutePath(normalizedFolderPath)) {
      const normalizedProjectRoot = normalizePath(projectRoot)
      if (normalizedFolderPath.startsWith(normalizedProjectRoot)) {
        normalizedFolderPath = normalizedFolderPath
          .slice(normalizedProjectRoot.length)
          .replace(/^\//, '')
      }
    }

    const newSource: ExternalDataSource = {
      id: uuidv4(),
      name: fileName,
      fileId: normalizedFileId,
      type: fileType,
      status: 'ready',
      addedAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      sourceMode: 'localfile',
      localPath: normalizedLocalPath,
      folderPath: normalizedFolderPath,
      size: fileSize,
    }

    config.value.recent_data_sources.unshift(newSource)
    await saveConfig()
    return newSource.id
  }

  /** 从工作区移除指定数据源 @param sourceId - 数据源 ID（非 fileId） */
  async function removeDataSource(sourceId: string) {
    const index = config.value.recent_data_sources.findIndex((ds) => ds.id === sourceId)
    if (index !== -1) {
      config.value.recent_data_sources.splice(index, 1)
      await saveConfig()
    }
  }

  /** 整体替换指定数据源（用于外部修改后写回） @param sourceId - 数据源 ID @param updatedDataSource - 替换后的完整对象 */
  async function updateDataSource(sourceId: string, updatedDataSource: ExternalDataSource) {
    const index = config.value.recent_data_sources.findIndex((ds) => ds.id === sourceId)
    if (index !== -1) {
      config.value.recent_data_sources[index] = updatedDataSource
      await saveConfig()
    }
  }

  /**
   * 更新数据源的可用状态（通常在文件系统检测后调用）
   *
   * @param sourceId - 数据源 ID
   * @param exists - 文件是否存在
   * @param error - 可选的错误描述
   */
  async function updateDataSourceStatus(sourceId: string, exists: boolean, error?: string) {
    const source = config.value.recent_data_sources.find((ds) => ds.id === sourceId)
    if (source) {
      source.status = exists ? 'ready' : 'missing'
      source.error = error
      if (!exists) {
        source.error = error || i18n.global.t('common.fileNotFound')
      }
      await saveConfig()
    }
  }

  /**
   * 为数据源设置别名（同时更新 alias_mappings 映射表）
   *
   * @param sourceId - 数据源 ID
   * @param alias - 用户自定义的显示别名
   */
  async function setDataSourceAlias(sourceId: string, alias: string) {
    const source = config.value.recent_data_sources.find((ds) => ds.id === sourceId)
    if (source) {
      source.alias = alias
      config.value.alias_mappings[source.fileId] = alias
      await saveConfig()
    }
  }

  /** 获取数据源显示名称（优先别名，回退文件名） @param sourceId - 数据源 ID @returns 显示名称 */
  function getDataSourceDisplayName(sourceId: string): string {
    const source = config.value.recent_data_sources.find((ds) => ds.id === sourceId)
    if (!source) return 'Unknown Source'
    return source.alias || source.name
  }

  /**
   * 通过 fileId 查找数据源
   *
   * workspace store 中所有条目的 fileId 和 localPath 均为绝对路径，
   * 因此只需精确匹配即可（小写 + 统一斜杠），不启用模糊/后缀/basename 回退。
   *
   * 对于传入的相对路径，会自动根据当前项目根目录解析为绝对路径后再匹配，
   * 以保持与 addDataSource 的行为一致。
   *
   * @param fileId - 文件唯一标识（绝对路径或相对路径）
   * @returns 匹配的数据源或 undefined
   */
  function findDataSourceByPath(fileId: string): ExternalDataSource | undefined {
    const projectStore = useProjectStore()
    const rawProjectRoot = projectStore.currentPaths?.configPath || ''
    const projectRoot = rawProjectRoot ? ensureDirPath(rawProjectRoot) : ''

    // 先按传入的原始路径匹配
    let target = normalizePath(fileId)
    let result = config.value.recent_data_sources.find((ds) => {
      return (
        normalizePath(ds.fileId || '') === target || normalizePath(ds.localPath || '') === target
      )
    })
    if (result) return result

    // 若未找到且为相对路径，则解析为绝对路径后再匹配
    // （与 addDataSource 的解析逻辑保持一致）
    if (!isAbsolutePath(fileId) && projectRoot) {
      const resolved = resolveRelativePath(fileId, projectRoot)
      if (resolved) {
        target = normalizePath(resolved)
        result = config.value.recent_data_sources.find((ds) => {
          return (
            normalizePath(ds.fileId || '') === target ||
            normalizePath(ds.localPath || '') === target
          )
        })
      }
    }

    return result
  }

  /**
   * 批量检测所有数据源的文件可用状态
   *
   * 遍历所有数据源，通过 Electron 文件系统 API 检测文件是否存在，
   * 用于应用启动时校验数据源完整性。
   */
  async function checkAllDataSourceStatus() {
    for (const source of config.value.recent_data_sources) {
      try {
        const filePath = source.localPath || source.fileId
        const exists = filePath ? await checkFileExists(filePath) : false
        source.status = exists ? 'ready' : 'missing'
        if (exists) {
          source.error = undefined
        }
      } catch (error) {
        source.status = 'missing'
        source.error = error instanceof Error ? error.message : i18n.global.t('common.unknownError')
      }
    }
    await saveConfig()
  }

  /** 清空所有数据源（用于重置工作区或切换项目时清理旧数据） */
  async function clearAllDataSources() {
    config.value.recent_data_sources = []
    await saveConfig()
  }

  /** 将工作区配置导出为 JSON 字符串（用于调试或备份） @returns 格式化后的 JSON */
  function exportConfigAsYAML(): string {
    return JSON.stringify(config.value, null, 2)
  }

  // --- 初始化 ---

  /**
   * 初始化工作区配置（应用启动时调用）
   *
   * 加载失败时回退到默认配置，确保应用不会因配置错误而崩溃。
   */
  async function initialize() {
    logger.debug('[WorkspaceStore] 开始初始化工作区配置')
    try {
      await loadConfig()

      // 将旧配置中的相对路径统一转换为绝对路径，确保后续匹配精确可靠
      const projectStore = useProjectStore()
      const rawProjectRoot =
        projectStore.currentPaths?.configPath || projectStore.currentPaths?.dataPath
      // 确保 projectRoot 是目录路径而非文件路径，防止拼接出畸形路径
      const projectRoot = rawProjectRoot ? ensureDirPath(rawProjectRoot) : ''
      if (projectRoot && config.value.recent_data_sources.length > 0) {
        let needsSave = false
        for (const ds of config.value.recent_data_sources) {
          if (ds.fileId && !isAbsolutePath(ds.fileId)) {
            const resolved = resolveRelativePath(ds.fileId, projectRoot)
            if (resolved && isAbsolutePath(resolved)) {
              ds.fileId = normalizePath(resolved)
              needsSave = true
            } else {
              logger.warn(
                '[WorkspaceStore] 初始化时无法将相对路径解析为绝对路径，标记为 missing:',
                ds.fileId
              )
              ds.status = 'missing'
              ds.error = '路径解析失败：项目根目录未设置'
              needsSave = true
            }
          }
          if (ds.localPath && !isAbsolutePath(ds.localPath)) {
            const resolved = resolveRelativePath(ds.localPath, projectRoot)
            if (resolved && isAbsolutePath(resolved)) {
              ds.localPath = normalizePath(resolved)
              needsSave = true
            } else {
              logger.warn(
                '[WorkspaceStore] 初始化时无法将相对路径解析为绝对路径，标记为 missing:',
                ds.localPath
              )
              ds.status = 'missing'
              ds.error = '路径解析失败：项目根目录未设置'
              needsSave = true
            }
          }
          // 将绝对路径的 folderPath 转换为相对项目根目录的路径，便于外部数据树分组
          if (ds.folderPath && isAbsolutePath(ds.folderPath)) {
            const normalizedFolder = normalizePath(ds.folderPath)
            const normalizedProjectRoot = normalizePath(projectRoot)
            if (normalizedFolder.startsWith(normalizedProjectRoot)) {
              ds.folderPath = normalizedFolder
                .slice(normalizedProjectRoot.length)
                .replace(/^\//, '')
              needsSave = true
            }
          }
        }
        if (needsSave) {
          await saveConfig()
          logger.debug('[WorkspaceStore] 已将旧配置中的相对路径转换为绝对路径并保存')
        }
      }

      logger.debug(
        '[WorkspaceStore] 工作区配置初始化完成，数据源数量:',
        config.value.recent_data_sources.length
      )
    } catch (error) {
      logger.error('[WorkspaceStore] 初始化工作区配置失败:', error)
      config.value = createDefaultConfig()
    }
  }

  /**
   * 获取数据源列表（安全访问，自动解包 ComputedRef）
   */
  function getDataSources(): ExternalDataSource[] {
    return unref(dataSources) || []
  }

  return {
    config,
    dataSources,
    readyDataSources,
    missingDataSources,
    getDataSources,
    initialize,
    loadConfig,
    saveConfig,
    addDataSource,
    removeDataSource,
    updateDataSource,
    updateDataSourceStatus,
    setDataSourceAlias,
    getDataSourceDisplayName,
    findDataSourceByPath,
    checkAllDataSourceStatus,
    clearAllDataSources,
    exportConfigAsYAML,
  }
})
