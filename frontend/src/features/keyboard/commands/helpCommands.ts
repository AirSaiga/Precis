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
