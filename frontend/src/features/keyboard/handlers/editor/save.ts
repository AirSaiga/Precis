/**
 * @file save.ts
 * @description 编辑器保存操作处理器
 *
 * 功能概述：
 * - 调用 graphStore 保存当前项目
 * - 返回保存成功或失败状态及对应提示
 */

import { logger } from '@/core/utils/logger'
import { useGraphStore } from '@/stores/graphStore'

export async function save(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  try {
    await graphStore.saveProject()
    return { success: true, message: 'shortcuts.feedback.saved' }
  } catch (error) {
    logger.error('[EditorHandler] Save failed:', error)
    return { success: false, message: 'shortcuts.feedback.saveFailed' }
  }
}
