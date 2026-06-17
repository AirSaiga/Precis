/**
 * @file useMessageCopy.ts
 * @description 消息复制组合式函数
 *
 * 封装"复制消息内容 + 按钮图标反馈 + toast 提示"的完整交互，
 * 供 AIChatPanel / AIChatDrawer 等带"复制单条消息"按钮的组件复用。
 *
 * 与 useClipboard 的分工：
 * - useClipboard 只负责把文本写入剪贴板（纯 I/O，无 UI 反馈）
 * - useMessageCopy 在其基础上叠加 copiedId 图标切换 + 成功/失败 toast
 *
 * 设计动机：原先 AIChatPanel.vue 与 AIChatDrawer.vue 各自重复实现了
 * clipboard API + execCommand 降级 + copiedId 反馈，且复制失败时误用
 * toastSuccess 显示失败文案。这里统一收敛并修正该 bug。
 *
 * 使用方式：
 * ```ts
 * const { copiedId, copyMessage } = useMessageCopy()
 * // 模板：按钮图标根据 copiedId === message.id 切换
 * await copyMessage(message.content, message.id)
 * ```
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyToClipboard } from '@/composables/useClipboard'
import { toastSuccess, toastError } from '@/core/toast'

/** 复制成功后图标反馈的持续时长（ms） */
const FEEDBACK_DURATION = 2000

/**
 * 消息复制组合式函数
 *
 * @returns copiedId - 当前已复制消息的 id（用于按钮图标切换），null 表示无
 * @returns copyMessage - 复制一条消息内容，自动处理反馈与提示
 */
export function useMessageCopy() {
  const { t } = useI18n()
  const copiedId = ref<string | null>(null)

  /**
   * 复制消息内容到剪贴板
   *
   * 成功时短暂把 copiedId 置为 messageId（驱动按钮图标切换为 ✓）并提示成功；
   * 失败时提示错误（用 toastError，而非 toastSuccess）。
   *
   * @param content - 消息正文
   * @param messageId - 消息 id，用于图标反馈匹配
   */
  async function copyMessage(content: string, messageId: string): Promise<void> {
    try {
      await copyToClipboard(content)
    } catch {
      // 复制失败：用错误级别的 toast（修正原先误用 toastSuccess 的 bug）
      toastError(t('aiChat.copyFailed'))
      return
    }

    copiedId.value = messageId
    toastSuccess(t('aiChat.copied'))
    setTimeout(() => {
      // 仅当仍是这条消息时才清除，避免被后续复制覆盖后又误清
      if (copiedId.value === messageId) {
        copiedId.value = null
      }
    }, FEEDBACK_DURATION)
  }

  return {
    copiedId,
    copyMessage,
  }
}
