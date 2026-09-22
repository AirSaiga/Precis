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
 * @fileoverview 命令面板国际化 - 英文
 *
 * commands.* 的 key 由 paletteCommandRegistry 的 labelKey 动态引用
 * （t(`commandPalette.commands.${id}`)，前缀已登记 audit allowlist）。
 */

const commandPalette = {
  placeholder: 'Search nodes or commands…',
  groups: {
    nodes: 'Nodes',
    commands: 'Commands',
  },
  empty: 'No matching results',
  hiddenHint: 'Hidden',
  commands: {
    organize: 'Organize nodes',
    save: 'Save project',
    validateAll: 'Full validation',
    focusProjectRoot: 'Focus project root',
    viewPanorama: 'View: Panorama',
    viewFocus: 'View: Focus',
    viewErrorsOnly: 'View: Errors only',
  },
  footer: {
    navigate: 'Navigate',
    confirm: 'Confirm',
    dismiss: 'Dismiss',
  },
}

export default commandPalette
