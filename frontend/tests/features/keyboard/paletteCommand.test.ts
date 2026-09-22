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
import { describe, it, expect, vi } from 'vitest'
import { getPaletteShortcutCommands } from '@/features/keyboard/commands/paletteCommands'
import { eventBus } from '@/core/eventBus'

describe('palette.open 快捷键命令（Ctrl+K）', () => {
  it('清单含唯一命令，默认绑定 Ctrl+K / Mac Cmd+K', () => {
    const cmds = getPaletteShortcutCommands()
    expect(cmds).toHaveLength(1)
    const cmd = cmds[0]
    expect(cmd.id).toBe('palette.open')
    expect(cmd.defaultShortcut).toEqual({ key: 'k', ctrl: true })
    expect(cmd.platformVariants?.mac).toEqual({ key: 'k', meta: true })
    expect(cmd.platformVariants?.windows).toEqual({ key: 'k', ctrl: true })
    expect(cmd.name).toBe('shortcuts.commands.openCommandPalette')
    expect(cmd.category).toBe('palette')
  })

  it('执行经 eventBus 发射 open-command-palette（与面板组件解耦）', async () => {
    const handler = vi.fn()
    eventBus.on('open-command-palette', handler)
    try {
      await cmds_execute()
    } finally {
      eventBus.off('open-command-palette', handler)
    }
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

async function cmds_execute(): Promise<void> {
  const cmd = getPaletteShortcutCommands()[0]
  await cmd.execute({ activeComponent: null })
}
