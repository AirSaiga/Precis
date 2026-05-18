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
 * 仅在配置文件中该字段缺失时使用，避免每次都查 localStorage
 *
 * @returns true 表示默认允许启动时加载
 */
function getStartupLoadingEnabledDefault(): boolean {
  try {
    const value = localStorage.getItem('startup_loading_enabled')
    if (value === null) return true
    return value === 'true'
  } catch {
    return true
  }
}

/**
 * 创建默认工作区配置
 *
 * 用于后端配置加载失败时的降级处理，保证 UI 可以正常渲染
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
 */
export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
  logger.debug('[WorkspaceConfigService] 开始加载工作区配置')
  try {
    const backendConfig = await workspaceApi.getWorkspaceConfig()
    logger.debug(
      '[WorkspaceConfigService] 获取到工作区配置，数据源数量:',
      backendConfig.data_sources?.length || 0
    )

    const config: WorkspaceConfig = {
      recent_data_sources: (backendConfig.data_sources || []).map((ds) => {
        const dsRecord = ds as unknown as Record<string, unknown>
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
        expanded_folders: {
          'input-staging': true,
          schemas: true,
          patterns: false,
          constraints: false,
          ...backendConfig.ui_preferences?.expanded_folders,
        },
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
 */
export async function saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
  try {
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
