/**
 * @file adapter.ts
 * @description 快捷键平台适配器
 */
import type { Shortcut } from '../types'
import { platformDetector } from './detector'

/**
 * 将快捷键转换为当前平台的格式
 *
 * @param shortcut 原始快捷键定义
 * @returns 适配当前平台的快捷键
 */
export function adaptShortcutToPlatform(shortcut: Shortcut): Shortcut {
  const result = { ...shortcut }

  if (platformDetector.isMac()) {
    if (result.ctrl && !result.meta) {
      result.meta = true
      result.ctrl = false
    }
  } else {
    if (result.meta && !result.ctrl) {
      result.ctrl = true
      result.meta = false
    }
  }

  return result
}

/**
 * 获取命令的当前平台快捷键
 *
 * 如果命令定义了平台变体，返回对应的快捷键
 * 否则返回默认快捷键并适配当前平台
 *
 * @param defaultShortcut 默认快捷键
 * @param platformVariants 平台特定快捷键
 * @returns 当前平台的快捷键
 */
export function getPlatformShortcut(
  defaultShortcut: Shortcut,
  platformVariants?: { mac?: Shortcut; windows?: Shortcut }
): Shortcut {
  if (!platformVariants) {
    return adaptShortcutToPlatform(defaultShortcut)
  }

  if (platformDetector.isMac() && platformVariants.mac) {
    return adaptShortcutToPlatform(platformVariants.mac)
  }

  if (platformDetector.isWindows() && platformVariants.windows) {
    return adaptShortcutToPlatform(platformVariants.windows)
  }

  return adaptShortcutToPlatform(defaultShortcut)
}

/**
 * 将快捷键转换为用户可读的字符串
 *
 * @param shortcut 快捷键对象
 * @param shortFormat 是否使用简短格式（用于显示）
 * @returns 格式化的快捷键字符串
 */
export function formatShortcut(shortcut: Shortcut, shortFormat = false): string {
  const parts: string[] = []

  if (shortcut.ctrl) {
    parts.push(platformDetector.isMac() ? '⌃' : 'Ctrl')
  }

  if (shortcut.meta) {
    parts.push(platformDetector.isMac() ? '⌘' : 'Win')
  }

  if (shortcut.alt) {
    parts.push(platformDetector.isMac() ? '⌥' : 'Alt')
  }

  if (shortcut.shift) {
    parts.push(platformDetector.isMac() ? '⇧' : 'Shift')
  }

  const key = shortcut.key.length === 1
    ? shortcut.key.toUpperCase()
    : getKeyDisplayName(shortcut.key)

  parts.push(shortFormat ? key.toUpperCase() : key)

  return parts.join(shortFormat ? '' : '+')
}

/**
 * 获取按键的显示名称
 *
 * @param key 按键值
 * @returns 显示名称
 */
export function getKeyDisplayName(key: string): string {
  const displayNames: Record<string, string> = {
    ' ': 'Space',
    'Escape': 'Esc',
    'Enter': 'Enter',
    'Tab': 'Tab',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    'Insert': 'Ins',
    'Delete': 'Del',
    'Backspace': 'Backspace',
    'F1': 'F1',
    'F2': 'F2',
    'F3': 'F3',
    'F4': 'F4',
    'F5': 'F5',
    'F6': 'F6',
    'F7': 'F7',
    'F8': 'F8',
    'F9': 'F9',
    'F10': 'F10',
    'F11': 'F11',
    'F12': 'F12'
  }

  return displayNames[key] || key
}

/**
 * 解析快捷键字符串
 *
 * 将格式化的快捷键字符串解析为 Shortcut 对象
 * 支持多种格式：'Ctrl+S', 'Ctrl + S', '⌘S'
 *
 * @param combo 快捷键字符串
 * @returns 解析后的 Shortcut 对象
 */
export function parseShortcut(combo: string): Shortcut {
  const shortcut: Shortcut = {
    key: '',
    ctrl: false,
    meta: false,
    shift: false,
    alt: false
  }

  const parts = combo.split(/[\s\+]+/).filter(part => part.length > 0)

  for (const part of parts) {
    const lowerPart = part.toLowerCase()

    switch (lowerPart) {
      case 'ctrl':
      case 'control':
      case '⌃':
        shortcut.ctrl = true
        break

      case 'cmd':
      case 'command':
      case '⌘':
        shortcut.meta = true
        break

      case 'alt':
      case 'option':
      case '⌥':
        shortcut.alt = true
        break

      case 'shift':
      case '⇧':
        shortcut.shift = true
        break

      default:
        shortcut.key = getOriginalKey(part)
    }
  }

  if (!shortcut.key) {
    shortcut.key = parts[parts.length - 1] || ''
  }

  return shortcut
}

/**
 * 获取原始按键值
 *
 * @param displayName 显示名称
 * @returns 原始按键值
 */
export function getOriginalKey(displayName: string): string {
  const keyMap: Record<string, string> = {
    'SPACE': ' ',
    'SP': ' ',
    'ESC': 'Escape',
    'ESCAPE': 'Escape',
    'ENTER': 'Enter',
    'TAB': 'Tab',
    'UP': 'ArrowUp',
    'DOWN': 'ArrowDown',
    'LEFT': 'ArrowLeft',
    'RIGHT': 'ArrowRight',
    'HOME': 'Home',
    'END': 'End',
    'PAGEUP': 'PageUp',
    'PAGEDOWN': 'PageDown',
    'INS': 'Insert',
    'INSERT': 'Insert',
    'DEL': 'Delete',
    'DELETE': 'Delete',
    'BACKSPACE': 'Backspace',
    'BS': 'Backspace'
  }

  return keyMap[displayName.toUpperCase()] || displayName
}

/**
 * 比较两个快捷键是否相同
 *
 * @param a 第一个快捷键
 * @param b 第二个快捷键
 * @returns 是否相同
 */
export function compareShortcuts(a: Shortcut, b: Shortcut): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase() &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.alt === b.alt
}

/**
 * 检查快捷键是否匹配
 *
 * 检查给定的键盘事件是否匹配快捷键定义
 *
 * @param event 键盘事件
 * @param shortcut 快捷键定义
 * @returns 是否匹配
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const key = event.key.toLowerCase()
  const shortcutKey = shortcut.key.toLowerCase()

  if (key !== shortcutKey) {
    return false
  }

  if (shortcut.ctrl && !event.ctrlKey) {
    return false
  }

  if (shortcut.meta && !event.metaKey) {
    return false
  }

  if (shortcut.shift && !event.shiftKey) {
    return false
  }

  if (shortcut.alt && !event.altKey) {
    return false
  }

  return true
}

/**
 * 导出单例对象
 */
export const platformAdapter = {
  adaptShortcutToPlatform,
  getPlatformShortcut,
  formatShortcut,
  getKeyDisplayName,
  parseShortcut,
  getOriginalKey,
  compareShortcuts,
  matchesShortcut
}

export default platformAdapter
