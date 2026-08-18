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
    // saveProject 在预校验 BLOCKER（如 schema 缺数据源）时返回 false 而非抛异常，
    // 必须传播该结果——否则保存失败会被误报为"已保存"（QA 发现的假阳性反馈缺陷）。
    const ok = await graphStore.saveProject()
    if (!ok) {
      return { success: false, message: 'shortcuts.feedback.saveFailed' }
    }
    return { success: true, message: 'shortcuts.feedback.saved' }
  } catch (error) {
    logger.error('[EditorHandler] Save failed:', error)
    return { success: false, message: 'shortcuts.feedback.saveFailed' }
  }
}
