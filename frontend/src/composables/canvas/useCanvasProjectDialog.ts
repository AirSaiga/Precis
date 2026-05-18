/**
 * @file useCanvasProjectDialog.ts
 * @description 画布项目创建对话框管理组合式函数
 *
 * 职责：
 * - 管理项目创建对话框的 DOM 引用
 * - 提供打开对话框的便捷方法
 */

import { ref } from 'vue'
import ProjectCreateDialog from '@/components/canvas/ProjectCreateDialog.vue'

export function useCanvasProjectDialog() {
  const projectCreateDialogRef = ref<InstanceType<typeof ProjectCreateDialog> | null>(null)

  const handleOpenCreateProjectDialog = () => {
    projectCreateDialogRef.value?.open()
  }

  return {
    projectCreateDialogRef,
    handleOpenCreateProjectDialog,
  }
}
