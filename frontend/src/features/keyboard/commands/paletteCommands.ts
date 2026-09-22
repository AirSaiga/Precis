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
 * @fileoverview paletteCommands.ts —— 命令面板相关快捷键命令定义
 *
 * Ctrl+K 打开命令面板。命令体只经 eventBus 发射 'open-command-palette'，
 * 面板组件（挂载在 AppOverlayHost）监听后显示——与 open-project-management
 * 同构的解耦方式，键盘层不感知面板实现。
 */
import type { Command } from '../types'
import { eventBus } from '@/core/eventBus'

export function createOpenCommandPaletteCommand(): Command {
  return {
    id: 'palette.open',
    name: 'shortcuts.commands.openCommandPalette',
    defaultShortcut: { key: 'k', ctrl: true },
    platformVariants: {
      mac: { key: 'k', meta: true },
      windows: { key: 'k', ctrl: true },
    },
    category: 'palette',
    priority: 60,
    execute: async () => {
      eventBus.emit('open-command-palette')
    },
  }
}

export function getPaletteShortcutCommands(): Command[] {
  return [createOpenCommandPaletteCommand()]
}
