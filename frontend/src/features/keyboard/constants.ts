/**
 * @file constants.ts
 * @description 快捷键常量定义
 */

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
