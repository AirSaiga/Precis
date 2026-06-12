/**
 * @file workspaceApi.ts
 * @description 工作区配置 API 服务模块
 *
 * 该模块提供与后端工作区管理服务通信的接口函数，主要包括：
 * - 工作区配置的获取与更新
 * - 数据源的新增、修改、删除和清空
 *
 * 工作区用于管理用户的数据分析环境，包括数据源配置、UI偏好设置等。
 *
 * 架构说明：
 * - Electron 模式：前端可以通过此 API 或 Electron IPC 操作配置
 * - CLI/Web 模式：通过此 API 操作配置
 *
 * @module workspaceApi
 * @exports {BackendWorkspaceConfig} 工作区配置接口类型
 * @exports {getWorkspaceConfig} 获取工作区配置函数
 * @exports {updateWorkspaceConfig} 更新工作区配置函数
 * @exports {addDataSource} 添加数据源函数
 * @exports {removeDataSource} 移除数据源函数
 * @exports {updateDataSource} 更新数据源函数
 * @exports {clearAllDataSources} 清空所有数据源函数
 */

import { logger } from '@/core/utils/logger'
import apiClient from '@/core/services/httpClient'

/**
 * 工作区配置 API 基础路径
 * @constant {string}
 * @default '/workspace'
 */
const WORKSPACE_API_PATH = '/workspace'

// ========================================
// 工作区配置类型定义
// ========================================

/**
 * 数据源项接口
 *
 * 定义单个数据源的完整信息结构，包含元数据、状态、路径等信息。
 * 数据源可以关联本地文件（Excel/CSV），系统会跟踪其状态和可用性。
 *
 * @interface DataSource
 * @property {string} id - 数据源唯一标识符，由系统生成
 * @property {string} name - 数据源名称，通常为文件名
 * @property {string} fileId - 关联的文件ID，用于标识具体文件
 * @property {'excel' | 'csv'} type - 数据源类型，支持 Excel 和 CSV
 * @property {'ready' | 'missing' | 'loading' | 'error'} status - 数据源状态
 * @property {string} addedAt - 添加时间，ISO 8601 格式时间戳
 * @property {string} [lastUsed] - 最后使用时间（可选）
 * @property {string} [alias] - 数据源别名（可选），用户自定义的友好名称
 * @property {string} [error] - 错误信息（可选，状态为 error 时存在）
 * @property {string} [sourceMode] - 来源模式，如 'file', 'folder' 等
 * @property {string} [localPath] - 本地文件路径
 * @property {string} [folderPath] - 文件夹路径
 * @property {number} [size] - 文件大小（字节）
 */
export interface DataSource {
  /** 数据源唯一标识符 */
  id: string
  /** 数据源名称 */
  name: string
  /** 关联的文件ID */
  fileId: string
  /** 数据源类型：Excel 或 CSV */
  type: 'excel' | 'csv' | 'json'
  /** 数据源状态：ready-就绪、missing-缺失、loading-加载中、error-错误 */
  status: 'ready' | 'missing' | 'loading' | 'error'
  /** 添加时间，ISO格式时间戳 */
  addedAt: string
  /** 最后使用时间（可选） */
  lastUsed?: string
  /** 数据源别名（可选） */
  alias?: string
  /** 错误信息（可选，状态为error时存在） */
  error?: string
  /** 来源模式 */
  sourceMode?: string
  /** 本地路径 */
  localPath?: string
  /** 文件夹路径 */
  folderPath?: string
  /** 文件大小 */
  size?: number
}

/**
 * 后端工作区配置接口
 *
 * 定义工作区的完整配置结构，包含数据源列表、UI偏好设置等。
 * 该接口与后端 API 返回的数据结构对应。
 *
 * @interface BackendWorkspaceConfig
 * @property {string} version - 配置版本号，用于版本控制
 * @property {DataSource[]} data_sources - 数据源列表，当前工作区关联的所有数据源
 * @property {Record<string, string>} alias_mappings - 别名映射表，将文件ID映射到用户定义的别名
 * @property {Object} ui_preferences - UI偏好设置
 * @property {Record<string, boolean>} ui_preferences.expanded_folders - 文件夹展开状态记录
 * @property {boolean} [ui_preferences.startup_loading_enabled] - 是否在 Electron 启动时显示加载弹窗
 * @property {string} last_updated - 最后更新时间，ISO格式时间戳
 */
export interface BackendWorkspaceConfig {
  /** 配置版本号，用于版本控制 */
  version: string
  /** 数据源列表，当前工作区关联的所有数据源 */
  data_sources: DataSource[]
  /** 别名映射表，将文件ID映射到用户定义的别名 */
  alias_mappings: Record<string, string>
  /** UI偏好设置 */
  ui_preferences: {
    /** 文件夹展开状态记录 */
    expanded_folders: Record<string, boolean>
    /** 是否在 Electron 启动时显示加载弹窗 */
    startup_loading_enabled?: boolean
  }
  /** 最后更新时间，ISO格式时间戳 */
  last_updated: string
}

// ========================================
// 工作区配置管理函数
// ========================================

/**
 * 获取工作区配置
 *
 * 从后端获取当前工作区的完整配置信息，包括所有数据源和UI偏好设置。
 * 该函数通常在应用初始化或刷新工作区时调用。
 *
 * @async
 * @function getWorkspaceConfig
 * @returns {Promise<BackendWorkspaceConfig>} 工作区配置数据的 Promise
 * @throws {AxiosError} 当网络请求失败或后端返回错误时抛出
 *
 * @example
 * ```typescript
 * try {
 *   const config = await getWorkspaceConfig();
 *   logger.debug('数据源数量:', config.data_sources.length);
 *   logger.debug('最后更新:', config.last_updated);
 * } catch (error) {
 *   logger.error('获取配置失败:', error);
 * }
 * ```
 */
export async function getWorkspaceConfig(): Promise<BackendWorkspaceConfig> {
  try {
    const response = await apiClient.get(`${WORKSPACE_API_PATH}/config`)
    return response.data
  } catch (error) {
    logger.error('获取工作区配置失败:', error)
    throw error
  }
}

/**
 * 更新工作区配置
 *
 * 将修改后的工作区配置提交到后端保存。支持部分更新，
 * 只需传入需要修改的字段即可。
 *
 * 注意：此操作会覆盖后端现有配置，请确保传递完整的配置对象或
 * 使用 Partial 类型进行部分更新。
 *
 * @async
 * @function updateWorkspaceConfig
 * @param {Partial<BackendWorkspaceConfig>} config - 工作区配置对象，包含要更新的字段
 * @param {string} [config.version] - 配置版本号
 * @param {DataSource[]} [config.data_sources] - 数据源列表
 * @param {Record<string, string>} [config.alias_mappings] - 别名映射表
 * @param {Object} [config.ui_preferences] - UI偏好设置
 * @returns {Promise<BackendWorkspaceConfig>} 更新后的完整工作区配置
 * @throws {AxiosError} 当网络请求失败或后端返回错误时抛出
 *
 * @example
 * ```typescript
 * // 更新 UI 偏好设置
 * await updateWorkspaceConfig({
 *   ui_preferences: {
 *     expanded_folders: { '/data': true },
 *     startup_loading_enabled: false
 *   }
 * });
 * ```
 */
export async function updateWorkspaceConfig(
  config: Partial<BackendWorkspaceConfig>
): Promise<BackendWorkspaceConfig> {
  try {
    const response = await apiClient.put(`${WORKSPACE_API_PATH}/config`, config)
    return response.data
  } catch (error) {
    logger.error('更新工作区配置失败:', error)
    throw error
  }
}

// ========================================
// 数据源管理函数
// ========================================

/**
 * 添加数据源
 *
 * 向当前工作区添加一个新的数据源。数据源可以关联本地文件（Excel/CSV），
 * 添加后系统会进行文件解析和元数据提取。
 *
 * 后端会根据提供的信息创建数据源记录，并返回更新后的完整工作区配置。
 *
 * @async
 * @function addDataSource
 * @param {Record<string, unknown>} dataSource - 数据源信息对象，包含以下字段：
 *   - name: {string} 数据源名称
 *   - fileId: {string} 文件ID
 *   - type: {'excel' | 'csv' | 'json'} 文件类型
 *   - localPath: {string} 本地文件路径
 *   - alias: {string} [可选] 别名
 *   - sourceMode: {string} [可选] 来源模式
 * @returns {Promise<BackendWorkspaceConfig>} 更新后的工作区配置，包含新添加的数据源
 * @throws {AxiosError} 当网络请求失败、参数无效或文件不存在时抛出
 *
 * @example
 * ```typescript
 * const newDataSource = {
 *   name: '销售数据.xlsx',
 *   fileId: 'file-123',
 *   type: 'excel' as const,
 *   localPath: '/path/to/file.xlsx',
 *   alias: '月度销售数据'
 * };
 * const config = await addDataSource(newDataSource);
 * ```
 */
export async function addDataSource(
  dataSource: Record<string, unknown>
): Promise<BackendWorkspaceConfig> {
  try {
    const response = await apiClient.post(`${WORKSPACE_API_PATH}/data-sources`, dataSource)
    return response.data
  } catch (error) {
    logger.error('添加数据源失败:', error)
    throw error
  }
}

/**
 * 移除数据源
 *
 * 从当前工作区中移除指定ID的数据源。该操作仅从工作区配置中移除数据源记录，
 * 不会删除实际的本地文件。
 *
 * 移除后，该数据源将不再显示在工作区中，但可以通过重新添加恢复。
 *
 * @async
 * @function removeDataSource
 * @param {string} sourceId - 要移除的数据源唯一标识符
 * @returns {Promise<BackendWorkspaceConfig>} 更新后的工作区配置
 * @throws {AxiosError} 当网络请求失败或数据源不存在时抛出
 *
 * @example
 * ```typescript
 * try {
 *   await removeDataSource('ds-123');
 *   logger.debug('数据源已移除');
 * } catch (error) {
 *   logger.error('移除失败:', error);
 * }
 * ```
 */
export async function removeDataSource(sourceId: string): Promise<BackendWorkspaceConfig> {
  try {
    const response = await apiClient.delete(
      `${WORKSPACE_API_PATH}/data-sources/${encodeURIComponent(sourceId)}`
    )
    return response.data
  } catch (error) {
    logger.error('移除数据源失败:', error)
    throw error
  }
}

/**
 * 更新数据源
 *
 * 更新指定数据源的属性信息，如名称、别名、状态等。
 * 通常用于修改数据源的元数据或更新其状态。
 *
 * 后端会验证 sourceId 是否存在，并应用提供的更新字段。
 *
 * @async
 * @function updateDataSource
 * @param {string} sourceId - 要更新的数据源唯一标识符
 * @param {Record<string, unknown>} dataSource - 新的数据源配置信息，可包含：
 *   - name: {string} 新名称
 *   - alias: {string} 新别名
 *   - status: {'ready' | 'missing' | 'loading' | 'error'} 新状态
 *   - error: {string} 错误信息
 * @returns {Promise<BackendWorkspaceConfig>} 更新后的工作区配置
 * @throws {AxiosError} 当网络请求失败、数据源不存在或参数无效时抛出
 *
 * @example
 * ```typescript
 * // 更新数据源别名
 * await updateDataSource('ds-123', {
 *   alias: 'Q1销售报表'
 * });
 *
 * // 更新数据源状态
 * await updateDataSource('ds-123', {
 *   status: 'ready',
 *   error: undefined
 * });
 * ```
 */
export async function updateDataSource(
  sourceId: string,
  dataSource: Record<string, unknown>
): Promise<BackendWorkspaceConfig> {
  try {
    const response = await apiClient.put(
      `${WORKSPACE_API_PATH}/data-sources/${encodeURIComponent(sourceId)}`,
      dataSource
    )
    return response.data
  } catch (error) {
    logger.error('更新数据源失败:', error)
    throw error
  }
}

/**
 * 清空所有数据源
 *
 * 从当前工作区中移除所有数据源。这是一个破坏性操作，会清空 data_sources 列表，
 * 但不会删除实际的本地文件。
 *
 * 警告：此操作不可撤销，请确保用户已确认或已做好备份。
 * 通常在用户选择"清空工作区"或"重置工作区"时调用。
 *
 * @async
 * @function clearAllDataSources
 * @returns {Promise<BackendWorkspaceConfig>} 清空后的工作区配置（data_sources 为空数组）
 * @throws {AxiosError} 当网络请求失败时抛出
 *
 * @example
 * ```typescript
 * // 建议先让用户确认
 * if (confirm('确定要清空所有数据源吗？此操作不可撤销。')) {
 *   await clearAllDataSources();
 *   logger.debug('所有数据源已清空');
 * }
 * ```
 */
export async function clearAllDataSources(): Promise<BackendWorkspaceConfig> {
  try {
    const response = await apiClient.delete(`${WORKSPACE_API_PATH}/data-sources`)
    return response.data
  } catch (error) {
    logger.error('清空数据源失败:', error)
    throw error
  }
}
