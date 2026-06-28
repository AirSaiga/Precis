/**
 * @file useCanvasViewportSync.ts
 * @description 画布视口同步组合式函数
 *
 * 职责：
 * - 监听选中节点变化，同步到 Store 的选中状态
 * - 监听节点整理事件，自动适配视图到所有节点
 */

import { watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { useNodeOrganizer } from '@/features/node-layout-organizer/composables/useNodeOrganizer'
import { FITVIEW_DURATION_MS } from '@/services/canvas/animationDurations'

/**
 * @description 画布视口同步组合式函数
 * @description 监听 VueFlow 选中节点变化和节点整理事件，自动同步选中状态并调整视口
 */
export function useCanvasViewportSync() {
  const store = useGraphStore()
  const { getSelectedNodes, fitView } = useVueFlow()
  const nodeOrganizer = useNodeOrganizer()

  // 监听 VueFlow 选中节点变化，将选中节点的 ID 同步到全局 Store
  watch(getSelectedNodes, (nodes) => {
    const ids = (nodes || []).map((n) => n.id)
    store.setSelection(ids)
  })

  // 监听节点整理完成事件，自动将视口适配到所有节点
  watch(
    () => nodeOrganizer.lastOrganizeTime.value,
    () => {
      // 使用动画效果将视口适配到所有节点，padding 为 0.2 表示留 20% 边距
      fitView({ padding: 0.2, duration: FITVIEW_DURATION_MS })
    }
  )
}
