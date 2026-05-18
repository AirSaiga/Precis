/**
 * @file scriptEditorStore.ts
 * @description 脚本编辑器状态管理 Store
 *
 * 管理脚本编辑器的显隐状态和当前编辑的节点 ID。
 * 用于在画布中双击 Scripted 约束节点时打开脚本编辑弹窗。
 *
 * 核心功能：
 * - open(id): 打开编辑器并绑定到指定节点
 * - close(): 关闭编辑器并清空节点绑定
 *
 * 使用场景：
 * - 画布节点双击事件 → 调用 open(nodeId) → 显示 Monaco 编辑器弹窗
 * - 保存/取消 → 调用 close() → 隐藏弹窗
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useScriptEditorStore = defineStore('scriptEditor', () => {
  const visible = ref(false)
  const nodeId = ref<string | null>(null)

  function open(id: string): void {
    nodeId.value = id
    visible.value = true
  }

  function close(): void {
    visible.value = false
    nodeId.value = null
  }

  return {
    visible,
    nodeId,
    open,
    close,
  }
})
