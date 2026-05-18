/**
 * @file shortcutConfigService.ts
 * @description 快捷键配置持久化服务
 *
 * 职责：
 * - localStorage 读写
 * - 配置默认值/导入/导出
 *
 * 数据流：
 * 1. loadUserConfig() 从 localStorage 读取并与默认配置合并
 * 2. saveUserConfig() 持久化到 localStorage
 * 3. importConfig() 校验并规范化外部配置
 * 4. exportConfig() 深拷贝以防意外修改
 */

import { logger } from '@/core/utils/logger'
import { STORAGE_KEYS } from '@/features/keyboard/constants'

export interface ShortcutUserConfig {
  customShortcuts: Record<
    string,
    {
      key: string
      ctrl?: boolean
      meta?: boolean
      shift?: boolean
      alt?: boolean
    }
  >
  disabledCommands: string[]
  enabled: boolean
  showFeedback: boolean
}

export const DEFAULT_CONFIG: ShortcutUserConfig = {
  customShortcuts: {},
  disabledCommands: [],
  enabled: true,
  showFeedback: true,
}

/**
 * 从 localStorage 加载用户快捷键配置
 *
 * 读取失败时返回 DEFAULT_CONFIG 副本而非抛出异常，保证功能可用
 *
 * @returns 用户配置（与默认配置合并后的完整配置）
 */
export function loadUserConfig(): ShortcutUserConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SHORTCUTS)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        customShortcuts: parsed.customShortcuts || {},
        disabledCommands: parsed.disabledCommands || [],
      }
    }
  } catch (error) {
    logger.error('[ShortcutConfigService] Failed to load config:', error)
  }
  return {
    ...DEFAULT_CONFIG,
    customShortcuts: { ...DEFAULT_CONFIG.customShortcuts },
    disabledCommands: [...DEFAULT_CONFIG.disabledCommands],
  }
}

/**
 * 保存用户快捷键配置到 localStorage
 *
 * 写入失败仅记录日志，不抛出异常，避免阻断业务流程
 *
 * @param config - 要保存的完整配置对象
 */
export function saveUserConfig(config: ShortcutUserConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SHORTCUTS, JSON.stringify(config))
  } catch (error) {
    logger.error('[ShortcutConfigService] Failed to save config:', error)
  }
}

/**
 * 创建默认配置副本
 *
 * 返回深拷贝以避免外部引用修改 DEFAULT_CONFIG
 *
 * @returns 新的默认配置对象
 */
export function createDefaultConfig(): ShortcutUserConfig {
  return {
    ...DEFAULT_CONFIG,
    customShortcuts: { ...DEFAULT_CONFIG.customShortcuts },
    disabledCommands: [...DEFAULT_CONFIG.disabledCommands],
  }
}

/**
 * 导出配置（深拷贝）
 *
 * 用于生成可分享/备份的配置文件，通过 JSON 序列化打破引用链
 *
 * @param config - 要导出的配置
 * @returns 深拷贝后的配置对象
 */
export function exportConfig(config: ShortcutUserConfig): ShortcutUserConfig {
  return JSON.parse(JSON.stringify(config))
}

/**
 * 导入并规范化外部配置
 *
 * 将用户提供的部分配置与默认配置合并，缺失字段使用默认值填充
 *
 * @param userConfig - 用户提供的部分配置
 * @returns 规范化后的完整配置
 */
export function importConfig(userConfig: Partial<ShortcutUserConfig>): ShortcutUserConfig {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    customShortcuts: userConfig.customShortcuts || {},
    disabledCommands: userConfig.disabledCommands || [],
  }
}
