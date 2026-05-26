/**
 * @file workspaceConfigService.ts
 * @description 工作区配置服务
 *
 * 职责：
 * - 与后端 API 交互，加载和保存工作区配置
 * - 前后端配置格式转换
 *
 * 数据流：
 * 1. loadWorkspaceConfig() 从后端获取配置并转换为前端格式
 * 2. saveWorkspaceConfig() 将前端格式转换后保存到后端
 * 3. createDefaultConfig() 生成默认配置用于 fallback
 */

import { logger } from '@/core/utils/logger'
import * as workspaceApi from '@/api/workspaceApi'
import type { ExternalDataSource, WorkspaceConfig } from '@/types/graph'

/**
 * 从 localStorage 读取启动时自动加载数据源的偏好设置
 *
 * 作为降级默认值：当后端返回的配置中缺少 startup_loading_enabled 字段时，
 * 使用 localStorage 中保存的用户偏好。若 localStorage 也未设置，默认返回 true（允许自动加载）。
 *
 * @returns true 表示默认允许启动时加载数据源
 */
function getStartupLoadingEnabledDefault(): boolean {
  try {
    const value = localStorage.getItem('startup_loading_enabled')
    if (value === null) return true
    return value === 'true'
  } catch {
    // localStorage 不可用（如隐私模式），返回默认值
    return true
  }
}

/**
 * 创建默认工作区配置
 *
 * 用于后端配置加载失败时的降级处理，保证 UI 可以正常渲染。
 * 默认展开 input-staging 和 schemas 文件夹，关闭 patterns 和 constraints。
 *
 * @returns 包含所有字段的默认配置对象
 */
function createDefaultConfig(): WorkspaceConfig {
  return {
    recent_data_sources: [],
    alias_mappings: {},
    ui_preferences: {
      expanded_folders: {
        'input-staging': true,
        schemas: true,
        patterns: false,
        constraints: false,
      },
      startup_loading_enabled: getStartupLoadingEnabledDefault(),
    },
    last_updated: new Date().toISOString(),
  }
}

/**
 * 从后端加载工作区配置
 *
 * 调用后端 API 获取工作区配置，并将后端格式转换为前端 WorkspaceConfig 格式。
 *
 * 字段映射说明：
 * - 后端 data_sources → 前端 recent_data_sources（ExternalDataSource 数组）
 * - 后端 alias_mappings → 前端 alias_mappings（直接透传）
 * - 后端 ui_preferences → 前端 ui_preferences（合并默认值）
 * - 后端 last_updated → 前端 last_updated（降级为当前时间）
 *
 * 数据源转换：
 * - fileId 优先取后端 fileId，其次 fullPath，最后 fallback 到 id
 * - sourceMode 默认 'localfile'
 * - localPath 默认与 fileId 相同
 * - status 默认 'ready'
 * - addedAt / lastUsed 默认当前时间
 *
 * 错误处理：加载失败时返回 createDefaultConfig() 的默认配置，避免 UI 崩溃。
 *
 * @returns 前端格式的工作区配置
 */
export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
  logger.debug('[WorkspaceConfigService] 开始加载工作区配置')
  try {
    const backendConfig = await workspaceApi.getWorkspaceConfig()
    logger.debug(
      '[WorkspaceConfigService] 获取到工作区配置，数据源数量:',
      backendConfig.data_sources?.length || 0
    )

    // === 数据源转换：后端格式 → 前端 ExternalDataSource ===
    const config: WorkspaceConfig = {
      recent_data_sources: (backendConfig.data_sources || []).map((ds) => {
        const dsRecord = ds as unknown as Record<string, unknown>
        // fileId 优先级：fileId > fullPath > id（兼容不同后端版本）
        const fileId =
          (dsRecord.fileId as string | undefined) ||
          (dsRecord.fullPath as string | undefined) ||
          ds.id
        return {
          id: ds.id,
          name: ds.name,
          fileId: fileId,
          type: ds.type,
          status: ds.status || 'ready',
          addedAt: ds.addedAt || new Date().toISOString(),
          lastUsed: ds.lastUsed || new Date().toISOString(),
          alias: ds.alias,
          error: ds.error,
          sourceMode: (dsRecord.sourceMode as string | undefined) || 'localfile',
          localPath: (dsRecord.localPath as string | undefined) || fileId,
          folderPath: dsRecord.folderPath as string | undefined,
          size: ds.size,
        } as ExternalDataSource
      }),
      alias_mappings: backendConfig.alias_mappings || {},
      ui_preferences: {
        // 合并默认值与后端返回的展开状态（后端缺失时使用默认展开配置）
        expanded_folders: {
          'input-staging': true,
          schemas: true,
          patterns: false,
          constraints: false,
          ...backendConfig.ui_preferences?.expanded_folders,
        },
        // 后端缺失时使用 localStorage 降级默认值
        startup_loading_enabled:
          backendConfig.ui_preferences?.startup_loading_enabled ??
          getStartupLoadingEnabledDefault(),
      },
      last_updated: backendConfig.last_updated || new Date().toISOString(),
    }

    logger.debug('[WorkspaceConfigService] 配置加载完成')
    return config
  } catch (error) {
    logger.error('[WorkspaceConfigService] 加载工作区配置失败:', error)
    return createDefaultConfig()
  }
}

/**
 * 保存工作区配置到后端
 *
 * 将前端 WorkspaceConfig 格式转换为后端 API 所需格式后提交。
 *
 * 字段映射说明：
 * - 前端 recent_data_sources → 后端 data_sources（保留全部字段）
 * - 前端 alias_mappings → 后端 alias_mappings（直接透传）
 * - 前端 ui_preferences → 后端 ui_preferences（直接透传）
 * - last_updated 由前端设置为当前时间（后端可能以此做乐观锁）
 *
 * 错误处理：保存失败时记录错误并抛出，由调用方决定重试或提示用户。
 *
 * @param config - 前端格式的工作区配置
 * @throws 当后端 API 调用失败时抛出错误
 */
export async function saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
  try {
    // === 配置对象构建：前端格式 → 后端格式 ===
    const backendConfig = {
      version: '1.0',
      data_sources: config.recent_data_sources.map((ds) => ({
        id: ds.id,
        name: ds.name,
        fileId: ds.fileId,
        type: ds.type,
        status: ds.status,
        addedAt: ds.addedAt,
        lastUsed: ds.lastUsed,
        alias: ds.alias,
        error: ds.error,
        sourceMode: ds.sourceMode || 'localfile',
        localPath: ds.localPath,
        folderPath: ds.folderPath,
        size: ds.size,
      })),
      alias_mappings: config.alias_mappings,
      ui_preferences: {
        expanded_folders: config.ui_preferences.expanded_folders,
        startup_loading_enabled: config.ui_preferences.startup_loading_enabled,
      },
      last_updated: new Date().toISOString(),
    }

    await workspaceApi.updateWorkspaceConfig(backendConfig)
  } catch (error) {
    logger.error('[WorkspaceConfigService] 保存工作区配置失败:', error)
    throw error
  }
}

export { createDefaultConfig }
