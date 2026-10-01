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
 * @fileoverview 布局快捷键命令定义：专注模式切换（Ctrl+Shift+F）与退出（Esc）。
 *
 * layout.toggleFocus 绑 Ctrl+Shift+F（进入 / 退出专注模式一体）；
 * layout.exitFocus 绑 Escape——仅在专注模式下生效，由 useAppBootstrap 按
 * isFocusMode 动态启停命令：注册表命中即无条件 preventDefault/stopPropagation
 * （isAvailable 检查发生在 executed 置位之后），若常驻绑定会拦截非专注态下
 * 其他 Esc 语义（如资源右键菜单的 window 级关闭监听）。
 */
import type { Command } from '../types'
import { toggleFocus, exitFocus } from '../handlers/layout'
import { showFeedback } from './feedback'

export function createToggleFocusCommand(): Command {
  return {
    id: 'layout.toggleFocus',
    name: 'shortcuts.commands.toggleFocus',
    defaultShortcut: { key: 'f', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: 'f', meta: true, shift: true },
      windows: { key: 'f', ctrl: true, shift: true },
    },
    category: 'layout',
    priority: 58,
    execute: async (context) => {
      const result = await toggleFocus()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createExitFocusCommand(): Command {
  return {
    id: 'layout.exitFocus',
    name: 'shortcuts.commands.exitFocus',
    defaultShortcut: { key: 'Escape' },
    category: 'layout',
    priority: 57,
    execute: async (context) => {
      const result = await exitFocus()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function getLayoutCommands(): Command[] {
  return [createToggleFocusCommand(), createExitFocusCommand()]
}
