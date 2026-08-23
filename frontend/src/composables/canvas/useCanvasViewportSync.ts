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
import { SAFE_FITVIEW_PADDING } from '@/features/node-layout-organizer/constants'

/**
 * @description 画布视口同步组合式函数
 * @description 监听 VueFlow 选中节点变化和节点整理事件，自动同步选中状态并调整视口
 */
export function useCanvasViewportSync() {
  const store = useGraphStore()
  const { getSelectedNodes, fitView } = useVueFlow()
  const nodeOrganizer = useNodeOrganizer()

  // 监听 VueFlow 选中集变化，将选中节点 ID 同步到全局 Store。
  //
  // 必须以"选中 ID 集合"（join 后的字符串）为监听键，而非 getSelectedNodes 本身：
  // getSelectedNodes 是 computed，任何节点变动（入场动画 class 清除、尺寸/handleBounds
  // 测量等无关变化）都会让它产出新数组引用——直接 watch 会在无关变动时触发回调，
  // 用 VF 侧的旧选中集覆写 Store。"仅写 Store"的选中操作（如 Ctrl+A 全选）
  // 会被随后到达的无关变动静默清掉，表现为全选随机失效（画布越慢越易复现）。
  watch(
    () => getSelectedNodes.value.map((n) => n.id).join('\u0000'),
    (key) => {
      store.setSelection(key === '' ? [] : key.split('\u0000'))
    }
  )

  // 监听节点整理完成事件，自动将视口适配到所有节点
  watch(
    () => nodeOrganizer.lastOrganizeTime.value,
    () => {
      // 安全留白与整理/加载适配取景一致（右侧检查器/底部状态栏/MiniMap）
      fitView({ padding: { ...SAFE_FITVIEW_PADDING }, duration: FITVIEW_DURATION_MS })
    }
  )
}
