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
import { checkFileExists } from '@/core/utils/fileApi'
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

    // 使用标准化后的路径进行查找（同时检查 fileId 和 localPath，防止同路径重复导入）
    // 四路交叉比较：新条目的 fileId/localPath 与已有条目的 fileId/localPath 两两匹配。
    // 安全性前提：所有当前调用方 fileId === localPath，因此 4-way 等价于 2-way，
    // 此设计用于兼容旧版本配置中 fileId ≠ localPath 的历史条目。
    const existing = config.value.recent_data_sources.find((ds) => {
      const dsFileId = normalizePath(ds.fileId || '')
      const dsLocalPath = normalizePath(ds.localPath || '')
      return (
        dsFileId === normalizedFileId ||
        dsLocalPath === normalizedFileId ||
        dsFileId === normalizedLocalPath ||
        dsLocalPath === normalizedLocalPath
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

  /**
   * 从工作区移除指定数据源
   *
   * 从 recent_data_sources 列表中删除对应数据源，并立即保存配置。
   *
   * @param sourceId - 数据源唯一 ID（非 fileId）
   */
  async function removeDataSource(sourceId: string) {
    const index = config.value.recent_data_sources.findIndex((ds) => ds.id === sourceId)
    if (index !== -1) {
      // 从数组中移除该数据源
      config.value.recent_data_sources.splice(index, 1)
      // 同步更新后端配置文件
      await saveConfig()
    }
  }

  /**
   * 整体替换指定数据源（用于外部修改后写回）
   *
   * 当数据源属性在外部被批量修改后，调用此方法将修改后的完整对象写回 store。
   *
   * @param sourceId - 数据源唯一 ID
   * @param updatedDataSource - 替换后的完整数据源对象
   */
  async function updateDataSource(sourceId: string, updatedDataSource: ExternalDataSource) {
    const index = config.value.recent_data_sources.findIndex((ds) => ds.id === sourceId)
    if (index !== -1) {
      // 直接替换数组中的对象引用
      config.value.recent_data_sources[index] = updatedDataSource
      await saveConfig()
    }
  }

  /**
   * 更新数据源的可用状态（通常在文件系统检测后调用）
   *
   * 根据文件是否存在设置数据源状态为 ready 或 missing，
   * 文件不存在时自动填充默认错误信息。
   *
   * @param sourceId - 数据源唯一 ID
   * @param exists - 文件是否存在
   * @param error - 可选的自定义错误描述
   */
  async function updateDataSourceStatus(sourceId: string, exists: boolean, error?: string) {
    const source = config.value.recent_data_sources.find((ds) => ds.id === sourceId)
    if (source) {
      // 根据文件存在性设置状态
      source.status = exists ? 'ready' : 'missing'
      source.error = error
      if (!exists) {
        // 未提供错误信息时，使用国际化默认提示
        source.error = error || i18n.global.t('common.fileNotFound')
      }
      await saveConfig()
    }
  }

  /**
   * 为数据源设置别名（同时更新 alias_mappings 映射表）
   *
   * 别名用于在 UI 中显示更友好的数据源名称，替代原始文件名。
   * 设置别名后会同步更新 alias_mappings，确保一致性。
   *
   * @param sourceId - 数据源唯一 ID
   * @param alias - 用户自定义的显示别名
   */
  async function setDataSourceAlias(sourceId: string, alias: string) {
    const source = config.value.recent_data_sources.find((ds) => ds.id === sourceId)
    if (source) {
      source.alias = alias
      // 同步更新映射表，便于通过 fileId 快速查找别名
      config.value.alias_mappings[source.fileId] = alias
      await saveConfig()
    }
  }

  /**
   * 获取数据源显示名称（优先别名，回退文件名）
   *
   * @param sourceId - 数据源唯一 ID
   * @returns 显示名称。未找到时返回 'Unknown Source'
   */
  function getDataSourceDisplayName(sourceId: string): string {
    const source = config.value.recent_data_sources.find((ds) => ds.id === sourceId)
    if (!source) return 'Unknown Source'
    // 优先返回用户设置的别名，无别名时回退到原始文件名
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
   * 用于应用启动时校验数据源完整性，自动标记缺失的文件。
   */
  async function checkAllDataSourceStatus() {
    for (const source of config.value.recent_data_sources) {
      try {
        // 优先使用 localPath，回退到 fileId 作为检测路径
        const filePath = source.localPath || source.fileId
        const exists = filePath ? await checkFileExists(filePath) : false
        source.status = exists ? 'ready' : 'missing'
        if (exists) {
          // 文件恢复存在时，清除之前的错误信息
          source.error = undefined
        }
      } catch (error) {
        // 检测过程发生异常（如权限不足），标记为 missing
        source.status = 'missing'
        source.error = error instanceof Error ? error.message : i18n.global.t('common.unknownError')
      }
    }
    await saveConfig()
  }

  /**
   * 清空所有数据源
   *
   * 用于重置工作区或切换项目时清理旧项目残留的数据源数据，
   * 清空后立即保存配置。
   */
  async function clearAllDataSources() {
    config.value.recent_data_sources = []
    await saveConfig()
  }

  /**
   * 将工作区配置导出为 JSON 字符串（用于调试或备份）
   *
   * B34 修复：函数原命名 exportConfigAsYAML 但实现是 JSON.stringify，名实不符。
   * 重命名为 exportConfigAsJSON 以准确反映返回 JSON 字符串的行为。
   *
   * @returns 格式化后的 JSON 字符串，缩进为 2 个空格
   */
  function exportConfigAsJSON(): string {
    return JSON.stringify(config.value, null, 2)
  }

  // --- 初始化 ---

  /**
   * 初始化工作区配置（应用启动时调用）
   *
   * 从后端加载工作区配置，并将旧配置中的相对路径统一转换为绝对路径。
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
          // 处理 fileId：相对路径 → 绝对路径
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
          // 处理 localPath：相对路径 → 绝对路径
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
      // 加载失败时回退到默认空配置，避免应用崩溃
      config.value = createDefaultConfig()
    }
  }

  /**
   * 获取数据源列表（安全访问，自动解包 ComputedRef）
   *
   * 使用 unref 自动处理 ComputedRef 和普通 ref 的解包，
   * 返回空数组作为兜底，避免外部调用时出现 undefined。
   *
   * @returns 当前所有数据源的数组
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
    exportConfigAsJSON,
  }
})
