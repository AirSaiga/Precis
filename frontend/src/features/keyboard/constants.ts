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
