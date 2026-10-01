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
 * @fileoverview 专注模式键盘操作处理器：切换专注模式与 Esc 退出。
 *
 * 功能概述：
 * - 切换专注模式（toggleFocus，Ctrl+Shift+F）
 * - 退出专注模式（exitFocus，Esc）
 *
 * exitFocus 在非专注态返回 success:false（放行其他 Esc 语义）；
 * 此外 useAppBootstrap 会按 isFocusMode 动态启停 layout.exitFocus 命令，
 * 保证非专注态下 Esc 不被注册表匹配拦截。
 */

import { useFocusModeStore } from '@/stores/focusModeStore'

export async function toggleFocus(): Promise<{ success: boolean; message?: string }> {
  const focusModeStore = useFocusModeStore()
  focusModeStore.toggleFocus()
  return { success: true }
}

export async function exitFocus(): Promise<{ success: boolean; message?: string }> {
  const focusModeStore = useFocusModeStore()
  if (!focusModeStore.isFocusMode) {
    return { success: false }
  }
  focusModeStore.setFocusMode(false)
  return { success: true }
}
