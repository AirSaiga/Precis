/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
