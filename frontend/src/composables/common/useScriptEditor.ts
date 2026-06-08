import { logger } from '@/core/utils/logger'

/**
 * @file useScriptEditor.ts
 * @description 脚本编辑器组合式函数
 *
 * 核心功能：
 * - 管理脚本草稿的本地存储
 * - 提供脚本的保存和加载功能
 * - 支持自动恢复未保存的脚本
 *
 * 数据存储：
 * - 使用 localStorage 存储脚本草稿
 * - 存储键格式：precis_script_{nodeId}
 *
 * 接口说明：
 * - ScriptDraft.script: 脚本内容
 * - ScriptDraft.scriptName: 脚本名称
 */
export type ScriptDraft = {
  script: string
  scriptName: string
}

const STORAGE_KEY_PREFIX = 'precis_script_'

function getStorageKey(nodeId: string): string {
  return `${STORAGE_KEY_PREFIX}${nodeId}`
}

/** 从 localStorage 加载指定节点的脚本草稿，不存在则返回空 */
export function loadScriptDraft(nodeId: string): ScriptDraft {
  try {
    const stored = localStorage.getItem(getStorageKey(nodeId))
    if (!stored) {
      return { script: '', scriptName: '' }
    }
    const parsed = JSON.parse(stored) as Partial<ScriptDraft> | null
    return {
      script: parsed?.script ?? '',
      scriptName: parsed?.scriptName ?? '',
    }
  } catch (e) {
    logger.warn('[useScriptEditor] 加载脚本草稿失败:', e)
    return { script: '', scriptName: '' }
  }
}

/** 将脚本草稿保存到 localStorage */
export function saveScriptDraft(nodeId: string, draft: ScriptDraft): void {
  try {
    localStorage.setItem(getStorageKey(nodeId), JSON.stringify(draft))
  } catch (e) {
    logger.warn('[useScriptEditor] 保存脚本草稿失败:', e)
  }
}

/** 从 localStorage 清除指定节点的脚本草稿 */
export function clearScriptDraft(nodeId: string): void {
  try {
    localStorage.removeItem(getStorageKey(nodeId))
  } catch (e) {
    logger.warn('[useScriptEditor] 保存脚本草稿失败:', e)
  }
}
