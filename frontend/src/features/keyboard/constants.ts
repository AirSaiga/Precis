/**
 * @file constants.ts
 * @description 快捷键常量定义
 */
import type { Shortcut } from './types'

/**
 * 修饰键显示名称映射
 * 用于在 UI 中显示修饰键
 */
export const MODIFIER_KEY_LABELS: Record<string, string> = {
  ctrl: 'Ctrl',
  meta: 'Cmd',
  shift: 'Shift',
  alt: 'Alt',
}

/**
 * 功能键显示名称映射
 */
export const FUNCTION_KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Ins',
  Delete: 'Del',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
}

/**
 * 默认快捷键定义
 *
 * 这些是系统的默认快捷键配置
 * 可以在设置中修改
 */
export const DEFAULT_SHORTCUTS: Record<string, Shortcut | { mac: Shortcut; windows: Shortcut }> = {
  /**
   * 编辑器命令
   */
  'editor.save': {
    mac: { key: 's', meta: true },
    windows: { key: 's', ctrl: true },
  },

  'editor.undo': {
    mac: { key: 'z', meta: true },
    windows: { key: 'z', ctrl: true },
  },

  'editor.redo': {
    mac: { key: 'z', meta: true, shift: true },
    windows: { key: 'z', ctrl: true, shift: true },
  },

  'editor.copy': {
    mac: { key: 'c', meta: true },
    windows: { key: 'c', ctrl: true },
  },

  'editor.cut': {
    mac: { key: 'x', meta: true },
    windows: { key: 'x', ctrl: true },
  },

  'editor.paste': {
    mac: { key: 'v', meta: true },
    windows: { key: 'v', ctrl: true },
  },

  'editor.selectAll': {
    mac: { key: 'a', meta: true },
    windows: { key: 'a', ctrl: true },
  },

  'editor.find': {
    mac: { key: 'f', meta: true },
    windows: { key: 'f', ctrl: true },
  },

  /**
   * 画布命令
   */
  'canvas.selectAll': {
    mac: { key: 'a', meta: true, shift: true },
    windows: { key: 'a', ctrl: true, shift: true },
  },

  'canvas.zoomIn': {
    mac: { key: '=', meta: true },
    windows: { key: '=', ctrl: true },
  },

  'canvas.zoomOut': {
    mac: { key: '-', meta: true },
    windows: { key: '-', ctrl: true },
  },

  'canvas.zoomReset': {
    mac: { key: '0', meta: true },
    windows: { key: '0', ctrl: true },
  },

  'canvas.fitView': {
    mac: { key: '1', meta: true, shift: true },
    windows: { key: '1', ctrl: true, shift: true },
  },

  'canvas.toggleMinimap': {
    mac: { key: 'm', meta: true, alt: true },
    windows: { key: 'm', ctrl: true, alt: true },
  },

  'canvas.centerView': {
    mac: { key: 'Home', meta: true },
    windows: { key: 'Home', ctrl: true },
  },

  /**
   * 节点命令
   */
  'node.delete': { key: 'Delete' },

  'node.delete.backspace': { key: 'Backspace' },

  'node.duplicate': {
    mac: { key: 'd', meta: true },
    windows: { key: 'd', ctrl: true },
  },

  'node.copy': {
    mac: { key: 'c', meta: true, shift: true },
    windows: { key: 'c', ctrl: true, shift: true },
  },

  'node.cut': {
    mac: { key: 'x', meta: true },
    windows: { key: 'x', ctrl: true },
  },

  'node.paste': {
    mac: { key: 'v', meta: true, shift: true },
    windows: { key: 'v', ctrl: true, shift: true },
  },

  'node.selectParent': { key: 'ArrowUp', alt: true },

  'node.selectChild': { key: 'ArrowDown', alt: true },

  'node.moveUp': { key: 'ArrowUp', shift: true },

  'node.moveDown': { key: 'ArrowDown', shift: true },

  'node.moveLeft': { key: 'ArrowLeft', shift: true },

  'node.moveRight': { key: 'ArrowRight', shift: true },

  /**
   * 连接命令
   */
  'connection.create': { key: 'c', shift: true },

  'connection.delete': { key: 'Delete', shift: true },

  /**
   * 撤销/重做命令
   */
  'history.undo': {
    mac: { key: 'z', meta: true },
    windows: { key: 'z', ctrl: true },
  },

  'history.redo': {
    mac: { key: 'z', meta: true, shift: true },
    windows: { key: 'y', ctrl: true },
  },

  /**
   * 帮助命令
   */
  'help.shortcuts': {
    mac: { key: '/', meta: true, shift: true },
    windows: { key: '/', ctrl: true, shift: true },
  },
}

/**
 * 默认命令分类
 */
export const DEFAULT_CATEGORIES: Record<string, string> = {
  editor: '编辑',
  canvas: '画布',
  node: '节点',
  connection: '连接',
  history: '历史',
  help: '帮助',
}

/**
 * 命令分类排序
 */
export const CATEGORY_ORDER = ['editor', 'canvas', 'node', 'connection', 'history', 'help']

/**
 * 特殊按键映射
 * 将按键值映射为标准化的表示
 */
export const KEY_VALUE_MAP: Record<string, string> = {
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  ctrl: 'ctrl',
  option: 'alt',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  space: ' ',
  del: 'Delete',
  backspace: 'Backspace',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
}

/**
 * 需要忽略的默认按键
 * 这些按键不会触发快捷键
 */
export const IGNORED_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
])

/**
 * 快捷键字符串分隔符
 */
export const SHORTCUT_SEPARATOR = '+'

/**
 * 默认监听配置
 */
export const DEFAULT_LISTENER_CONFIG = {
  scope: 'global' as const,
  ignoreInput: true,
  preventDefault: true,
  stopPropagation: true,
}

/**
 * 默认注册表配置
 */
export const DEFAULT_REGISTRY_CONFIG = {
  autoRegisterDefaults: true,
  enablePlatformAdapter: true,
  conflictStrategy: 'warn' as const,
}

/**
 * 快捷键缓存键名
 */
export const STORAGE_KEYS = {
  SHORTCUTS: 'precis-shortcuts',
  DISABLED_COMMANDS: 'precis-disabled-commands',
  CUSTOM_SHORTCUTS: 'precis-custom-shortcuts',
}
