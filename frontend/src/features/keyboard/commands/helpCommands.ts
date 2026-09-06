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
 * @file helpCommands.ts
 * @description 帮助快捷键命令定义
 */

import type { Command } from '../types'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * 创建“显示快捷键”命令：打开设置面板并定位到快捷键页
 */
export function createShowShortcutsCommand(): Command {
  return {
    id: 'help.shortcuts',
    name: 'shortcuts.commands.showShortcuts',
    defaultShortcut: { key: '?', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: '?', meta: true, shift: true },
      windows: { key: '?', ctrl: true, shift: true },
    },
    category: 'help',
    priority: 10,
    execute: () => {
      const settingsStore = useSettingsStore()
      settingsStore.open('shortcuts')
    },
  }
}

/**
 * 获取帮助相关命令列表
 */
export function getHelpCommands(): Command[] {
  return [createShowShortcutsCommand()]
}
