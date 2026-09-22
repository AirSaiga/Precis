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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPaletteCommands } from '@/features/command-palette/services/paletteCommandRegistry'
import type { PaletteCommandDeps } from '@/features/command-palette/services/paletteCommandRegistry'

function makeDeps(overrides: Partial<PaletteCommandDeps> = {}): PaletteCommandDeps {
  return {
    quickOrganize: vi.fn(),
    save: vi.fn(),
    openFullValidation: vi.fn(),
    focusProjectRoot: vi.fn(),
    setViewMode: vi.fn(),
    toggleErrorsOnly: vi.fn(),
    isProjectLoaded: () => true,
    hasCanvasNodes: () => true,
    ...overrides,
  }
}

function commandById(cmds: ReturnType<typeof buildPaletteCommands>, id: string) {
  const cmd = cmds.find((c) => c.id === id)
  if (!cmd) throw new Error(`command not found: ${id}`)
  return cmd
}

describe('buildPaletteCommands', () => {
  it('初版清单：整理 / 保存 / 全量校验 / 聚焦根 / 三档视图切换', () => {
    const cmds = buildPaletteCommands(makeDeps())
    expect(cmds.map((c) => c.id)).toEqual([
      'organize',
      'save',
      'validateAll',
      'focusProjectRoot',
      'viewPanorama',
      'viewFocus',
      'viewErrorsOnly',
    ])
    expect(cmds.every((c) => c.kind === 'command')).toBe(true)
    expect(cmds.every((c) => c.labelKey.startsWith('commandPalette.commands.'))).toBe(true)
  })

  it('保存与聚焦根标注既有快捷键命令 id（供 UI 显示绑定提示）', () => {
    const cmds = buildPaletteCommands(makeDeps())
    expect(commandById(cmds, 'save').shortcutCommandId).toBe('editor.save')
    expect(commandById(cmds, 'focusProjectRoot').shortcutCommandId).toBe('canvas.focusProject')
    expect(commandById(cmds, 'organize').shortcutCommandId).toBeUndefined()
  })

  it('可用性门控：未加载项目时保存/校验/聚焦根不可用，视图命令始终可用', () => {
    const cmds = buildPaletteCommands(makeDeps({ isProjectLoaded: () => false }))
    expect(commandById(cmds, 'save').isAvailable()).toBe(false)
    expect(commandById(cmds, 'validateAll').isAvailable()).toBe(false)
    expect(commandById(cmds, 'focusProjectRoot').isAvailable()).toBe(false)
    expect(commandById(cmds, 'viewPanorama').isAvailable()).toBe(true)
    expect(commandById(cmds, 'viewFocus').isAvailable()).toBe(true)
    expect(commandById(cmds, 'viewErrorsOnly').isAvailable()).toBe(true)
  })

  it('可用性门控：空画布时整理不可用', () => {
    const cmds = buildPaletteCommands(makeDeps({ hasCanvasNodes: () => false }))
    expect(commandById(cmds, 'organize').isAvailable()).toBe(false)
  })

  describe('执行分发', () => {
    let deps: PaletteCommandDeps
    let cmds: ReturnType<typeof buildPaletteCommands>

    beforeEach(() => {
      deps = makeDeps()
      cmds = buildPaletteCommands(deps)
    })

    it('organize → quickOrganize', () => {
      void commandById(cmds, 'organize').run()
      expect(deps.quickOrganize).toHaveBeenCalledTimes(1)
    })

    it('save → save', async () => {
      await commandById(cmds, 'save').run()
      expect(deps.save).toHaveBeenCalledTimes(1)
    })

    it('validateAll → openFullValidation', () => {
      void commandById(cmds, 'validateAll').run()
      expect(deps.openFullValidation).toHaveBeenCalledTimes(1)
    })

    it('focusProjectRoot → focusProjectRoot', () => {
      void commandById(cmds, 'focusProjectRoot').run()
      expect(deps.focusProjectRoot).toHaveBeenCalledTimes(1)
    })

    it('viewPanorama / viewFocus → setViewMode 对应模式', () => {
      void commandById(cmds, 'viewPanorama').run()
      void commandById(cmds, 'viewFocus').run()
      expect(deps.setViewMode).toHaveBeenNthCalledWith(1, 'panorama')
      expect(deps.setViewMode).toHaveBeenNthCalledWith(2, 'focus')
    })

    it('viewErrorsOnly → toggleErrorsOnly', () => {
      void commandById(cmds, 'viewErrorsOnly').run()
      expect(deps.toggleErrorsOnly).toHaveBeenCalledTimes(1)
    })
  })
})
