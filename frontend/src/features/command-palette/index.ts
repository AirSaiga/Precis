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
 * @fileoverview command-palette feature 主入口（barrel）
 *
 * 垂直切片：CommandPalette 组件 + 搜索/命令服务。Ctrl+K 的注册在
 * features/keyboard（正规命令体系），经 eventBus 'open-command-palette'
 * 与本模块解耦。
 */

export { default as CommandPalette } from './components/CommandPalette.vue'
export {
  PALETTE_EXCLUDED_NODE_TYPES,
  MAX_NODE_RESULTS,
  buildNodeSearchEntries,
  filterPaletteEntries,
  revealAndFocusNode,
  type BuildNodeSearchEntriesOptions,
  type RevealFocusDeps,
} from './services/paletteSearch'
export { buildPaletteCommands, type PaletteCommandDeps } from './services/paletteCommandRegistry'
export type { NodeSearchEntry, PaletteCommandEntry, PaletteEntry } from './types'
