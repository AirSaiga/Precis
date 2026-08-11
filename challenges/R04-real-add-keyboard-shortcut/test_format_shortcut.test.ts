/**
 * R04 — format canvas 快捷键校验
 *
 * 本测试由 verify.mjs 复制进 frontend/tests/features/keyboard/ 后以 vitest 运行。
 * 用 @/ 别名导入真实源码，与仓库内现有键盘测试的写法一致。
 *
 * 校验目标：一个触发「格式化画布」的新快捷键命令已按
 *   命令定义 + 平台变体 + 注册（聚合出口）
 * 全链路接入快捷键系统。
 */
import { describe, it, expect } from 'vitest'
import { getCanvasCommands } from '@/features/keyboard/commands/canvasCommands'
import { getBaseCommands } from '@/features/keyboard/commands/baseCommands'
import { getHelpCommands } from '@/features/keyboard/commands/helpCommands'
import type { Command } from '@/features/keyboard/types'

/** 把三类默认命令聚合，模拟快捷键系统主入口的默认命令集合 */
function getAllDefaultCommands(): Command[] {
  return [...getBaseCommands(), ...getCanvasCommands(), ...getHelpCommands()]
}

/** 按命令 id 包含 'format'（不区分大小写）查找格式化画布命令 */
function findFormatCommand(cmds: Command[]): Command | undefined {
  return cmds.find((c) => c.id.toLowerCase().includes('format'))
}

describe('R04 — format canvas 快捷键命令', () => {
  const allCommands = getAllDefaultCommands()
  const formatCommand = findFormatCommand(allCommands)

  it('在已注册命令中存在一个 format 命令', () => {
    expect(formatCommand, '应存在一个 id 含 "format" 的命令').toBeDefined()
  })

  describe('命令字段完整性', () => {
    it('拥有非空 id', () => {
      expect(formatCommand).toBeDefined()
      expect(typeof formatCommand!.id).toBe('string')
      expect(formatCommand!.id.length).toBeGreaterThan(0)
    })

    it('拥有非空 name（i18n 键）', () => {
      expect(formatCommand).toBeDefined()
      expect(typeof formatCommand!.name).toBe('string')
      expect(formatCommand!.name.length).toBeGreaterThan(0)
    })

    it('execute 是函数', () => {
      expect(formatCommand).toBeDefined()
      expect(typeof formatCommand!.execute).toBe('function')
    })

    it('属于 canvas 分类', () => {
      expect(formatCommand).toBeDefined()
      expect(formatCommand!.category).toBe('canvas')
    })
  })

  describe('默认快捷键为 Ctrl+Shift+F', () => {
    it('defaultShortcut 已定义且 key 为 f', () => {
      expect(formatCommand).toBeDefined()
      const s = formatCommand!.defaultShortcut
      expect(s).toBeDefined()
      expect(typeof s.key).toBe('string')
      expect(s.key.toLowerCase()).toBe('f')
    })

    it('defaultShortcut 含 ctrl 与 shift 修饰键', () => {
      expect(formatCommand).toBeDefined()
      const s = formatCommand!.defaultShortcut
      expect(s.ctrl).toBe(true)
      expect(s.shift).toBe(true)
    })
  })

  describe('Mac 平台变体为 Cmd+Shift+F', () => {
    it('platformVariants.mac 已定义', () => {
      expect(formatCommand).toBeDefined()
      expect(formatCommand!.platformVariants).toBeDefined()
      expect(formatCommand!.platformVariants!.mac).toBeDefined()
    })

    it('mac 变体 key 为 f 且含 meta + shift', () => {
      expect(formatCommand).toBeDefined()
      const mac = formatCommand!.platformVariants!.mac!
      expect(mac.key.toLowerCase()).toBe('f')
      expect(mac.meta).toBe(true)
      expect(mac.shift).toBe(true)
    })
  })

  describe('Windows 平台变体为 Ctrl+Shift+F', () => {
    it('platformVariants.windows 已定义', () => {
      expect(formatCommand).toBeDefined()
      expect(formatCommand!.platformVariants).toBeDefined()
      expect(formatCommand!.platformVariants!.windows).toBeDefined()
    })

    it('windows 变体 key 为 f 且含 ctrl + shift', () => {
      expect(formatCommand).toBeDefined()
      const win = formatCommand!.platformVariants!.windows!
      expect(win.key.toLowerCase()).toBe('f')
      expect(win.ctrl).toBe(true)
      expect(win.shift).toBe(true)
    })
  })

  describe('通过画布命令聚合出口注册', () => {
    it('getCanvasCommands() 返回值中包含该 format 命令', () => {
      const canvasCommands = getCanvasCommands()
      const found = canvasCommands.some((c) => c.id.toLowerCase().includes('format'))
      expect(found, 'format 命令应出现在画布命令聚合数组中').toBe(true)
    })

    it('format 命令能从默认命令总集合中被遍历到', () => {
      const ids = allCommands.map((c) => c.id)
      const hasFormat = ids.some((id) => id.toLowerCase().includes('format'))
      expect(hasFormat).toBe(true)
    })
  })
})
