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
 * @fileoverview 命令面板命令源 —— 初版命令清单（工厂 + 依赖注入）
 *
 * 执行体经 deps 注入（eventBus 发射 / store action / 快捷键 handler），
 * 本模块只负责清单与可用性门控，保持纯逻辑可单测。带既有快捷键绑定的
 * 命令（保存 / 聚焦项目根）标注 shortcutCommandId，组件层据此读取用户
 * 实际绑定（shortcutStore 自定义优先）显示快捷键提示。
 */

import type { PaletteCommandEntry } from '../types'

export interface PaletteCommandDeps {
  /** 整理节点：经 eventBus 请求画布宿主执行 quickOrganize（useVueFlow 依赖画布注入链） */
  quickOrganize: () => void
  /** 保存项目（复用快捷键 editor.save 的 handler 逻辑） */
  save: () => void | Promise<void>
  /** 打开全量校验任务面板 */
  openFullValidation: () => void
  /** 聚焦项目根节点 */
  focusProjectRoot: () => void
  /** 切换视图模式（graphStore viewFilter 模块公开 action） */
  setViewMode: (mode: 'panorama' | 'focus') => void
  /** 切换"仅异常"（graphStore viewFilter 模块公开 action） */
  toggleErrorsOnly: () => void
  /** 项目已加载（保存 / 校验 / 聚焦根 的前置条件） */
  isProjectLoaded: () => boolean
  /** 画布上有节点（整理 的前置条件） */
  hasCanvasNodes: () => boolean
}

export function buildPaletteCommands(deps: PaletteCommandDeps): PaletteCommandEntry[] {
  return [
    {
      kind: 'command',
      id: 'organize',
      labelKey: 'commandPalette.commands.organize',
      isAvailable: () => deps.hasCanvasNodes(),
      run: () => deps.quickOrganize(),
    },
    {
      kind: 'command',
      id: 'save',
      labelKey: 'commandPalette.commands.save',
      shortcutCommandId: 'editor.save',
      isAvailable: () => deps.isProjectLoaded(),
      run: () => deps.save(),
    },
    {
      kind: 'command',
      id: 'validateAll',
      labelKey: 'commandPalette.commands.validateAll',
      isAvailable: () => deps.isProjectLoaded(),
      run: () => deps.openFullValidation(),
    },
    {
      kind: 'command',
      id: 'focusProjectRoot',
      labelKey: 'commandPalette.commands.focusProjectRoot',
      shortcutCommandId: 'canvas.focusProject',
      isAvailable: () => deps.isProjectLoaded(),
      run: () => deps.focusProjectRoot(),
    },
    {
      kind: 'command',
      id: 'viewPanorama',
      labelKey: 'commandPalette.commands.viewPanorama',
      isAvailable: () => true,
      run: () => deps.setViewMode('panorama'),
    },
    {
      kind: 'command',
      id: 'viewFocus',
      labelKey: 'commandPalette.commands.viewFocus',
      isAvailable: () => true,
      run: () => deps.setViewMode('focus'),
    },
    {
      kind: 'command',
      id: 'viewErrorsOnly',
      labelKey: 'commandPalette.commands.viewErrorsOnly',
      isAvailable: () => true,
      run: () => deps.toggleErrorsOnly(),
    },
  ]
}
