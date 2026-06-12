import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CommandExecutor } from '@/features/keyboard/executor/commandExecutor'
import type { Command, ShortcutEventData } from '@/features/keyboard/types'

function mockNavigator(platform: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, language: 'en-US' },
    configurable: true,
    writable: true,
  })
}

function makeRegistry(commands: Command[] = []) {
  const cmdMap = new Map<string, Command>(commands.map((c) => [c.id, c]))
  return {
    getCommand: (id: string) => cmdMap.get(id),
    getCommandShortcut: (cmd: Command) => cmd.defaultShortcut,
    isDisabled: (id: string) => cmdMap.get(id)?.isDisabled === true,
  }
}

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd.test',
    name: 'shortcuts.test',
    defaultShortcut: { key: 't', ctrl: true },
    category: 'test',
    execute: vi.fn(),
    ...overrides,
  }
}

describe('CommandExecutor - execute (async)', () => {
  beforeEach(() => {
    mockNavigator('Win32')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns error result for unknown command', async () => {
    const executor = new CommandExecutor(makeRegistry())
    const result = await executor.execute('cmd.unknown')
    expect(result.success).toBe(false)
    expect(result.commandId).toBe('cmd.unknown')
    expect(result.error?.message).toContain('not found')
  })

  it('returns error result for disabled command', async () => {
    const cmd = makeCommand({ id: 'cmd.disabled', isDisabled: true })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.disabled')
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('disabled')
  })

  it('executes sync command successfully', async () => {
    const cmd = makeCommand({ id: 'cmd.ok' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.ok')
    expect(result.success).toBe(true)
    expect(result.commandId).toBe('cmd.ok')
    expect(result.keyCombo).toBe('Ctrl+T')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('executes async command successfully', async () => {
    const cmd = makeCommand({
      id: 'cmd.async',
      execute: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
      }),
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.async')
    expect(result.success).toBe(true)
    expect(cmd.execute).toHaveBeenCalledOnce()
  })

  it('skips execution when isAvailable returns false (sync)', async () => {
    const cmd = makeCommand({
      id: 'cmd.unavail',
      isAvailable: () => false,
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.unavail')
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('not available')
  })

  it('skips execution when isAvailable returns false (async)', async () => {
    const cmd = makeCommand({
      id: 'cmd.unavail-async',
      isAvailable: async () => false,
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.unavail-async')
    expect(result.success).toBe(false)
  })

  it('executes when isAvailable returns true (async)', async () => {
    const cmd = makeCommand({
      id: 'cmd.avail-async',
      isAvailable: async () => true,
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.avail-async')
    expect(result.success).toBe(true)
  })

  it('catches errors thrown by command', async () => {
    const cmd = makeCommand({
      id: 'cmd.throws',
      execute: vi.fn(() => {
        throw new Error('boom')
      }),
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.throws')
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('boom')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('catches errors from rejected promise', async () => {
    const cmd = makeCommand({
      id: 'cmd.rejects',
      execute: vi.fn(async () => {
        throw new Error('async-boom')
      }),
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.rejects')
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('async-boom')
  })

  it('wraps non-Error thrown values as Error', async () => {
    const cmd = makeCommand({
      id: 'cmd.throws-string',
      execute: vi.fn(() => {
        throw 'string-error'
      }),
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = await executor.execute('cmd.throws-string')
    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
  })

  it('merges context with override', async () => {
    const cmd = makeCommand({ id: 'cmd.ctx' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    await executor.execute('cmd.ctx', { showFeedback: false, custom: 'value' })
    expect(cmd.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        showFeedback: false,
        custom: 'value',
      })
    )
  })

  it('uses default context showFeedback when not overridden', async () => {
    const cmd = makeCommand({ id: 'cmd.feedback' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    await executor.execute('cmd.feedback')
    expect(cmd.execute).toHaveBeenCalledWith(expect.objectContaining({ showFeedback: true }))
  })
})

describe('CommandExecutor - executeSync', () => {
  beforeEach(() => {
    mockNavigator('Win32')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns error for unknown command', () => {
    const executor = new CommandExecutor(makeRegistry())
    const result = executor.executeSync('cmd.unknown')
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('not found')
  })

  it('returns error for disabled command', () => {
    const cmd = makeCommand({ id: 'cmd.dis', isDisabled: true })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = executor.executeSync('cmd.dis')
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('disabled')
  })

  it('executes sync command and returns success', () => {
    const cmd = makeCommand({ id: 'cmd.sync' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = executor.executeSync('cmd.sync')
    expect(result.success).toBe(true)
    expect(cmd.execute).toHaveBeenCalledOnce()
  })

  it('returns error when isAvailable returns false', () => {
    const cmd = makeCommand({
      id: 'cmd.unavail',
      isAvailable: () => false,
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = executor.executeSync('cmd.unavail')
    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('not available')
  })

  it('catches thrown errors', () => {
    const cmd = makeCommand({
      id: 'cmd.thrown',
      execute: () => {
        throw new Error('sync-fail')
      },
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = executor.executeSync('cmd.thrown')
    expect(result.success).toBe(false)
    expect(result.error?.message).toBe('sync-fail')
  })

  it('warns when command returns a Promise', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cmd = makeCommand({
      id: 'cmd.promise',
      execute: () => Promise.resolve(),
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const result = executor.executeSync('cmd.promise')
    expect(result.success).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Promise'))
  })
})

describe('CommandExecutor - context management', () => {
  beforeEach(() => {
    mockNavigator('Win32')
  })

  it('initializes with default context', () => {
    const executor = new CommandExecutor(makeRegistry())
    const ctx = executor.getContext()
    expect(ctx.activeComponent).toBeNull()
    expect(ctx.showFeedback).toBe(true)
  })

  it('respects provided context', () => {
    const executor = new CommandExecutor(makeRegistry(), {
      activeComponent: null,
      showFeedback: false,
      custom: 'init',
    })
    const ctx = executor.getContext()
    expect(ctx.showFeedback).toBe(false)
    expect(ctx.custom).toBe('init')
  })

  it('updateContext merges new values', () => {
    const executor = new CommandExecutor(makeRegistry())
    executor.updateContext({ showFeedback: false, custom: 'a' })
    const ctx = executor.getContext()
    expect(ctx.showFeedback).toBe(false)
    expect(ctx.custom).toBe('a')
  })

  it('getContext returns frozen object', () => {
    const executor = new CommandExecutor(makeRegistry())
    const ctx = executor.getContext()
    expect(Object.isFrozen(ctx)).toBe(true)
  })
})

describe('CommandExecutor - event handling', () => {
  beforeEach(() => {
    mockNavigator('Win32')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits shortcut event on successful execution', async () => {
    const cmd = makeCommand({ id: 'cmd.evt' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const handler = vi.fn()
    executor.on('shortcut', handler)
    await executor.execute('cmd.evt')
    expect(handler).toHaveBeenCalledOnce()
    const data = handler.mock.calls[0][0] as ShortcutEventData
    expect(data.commandId).toBe('cmd.evt')
    expect(data.executed).toBe(true)
  })

  it('emits shortcut event on failed execution', async () => {
    const cmd = makeCommand({
      id: 'cmd.fail',
      execute: () => {
        throw new Error('x')
      },
    })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const handler = vi.fn()
    executor.on('shortcut', handler)
    await executor.execute('cmd.fail')
    expect(handler).toHaveBeenCalledOnce()
    const data = handler.mock.calls[0][0] as ShortcutEventData
    expect(data.executed).toBe(false)
    expect(data.error?.message).toBe('x')
  })

  it('does not emit on registry miss', async () => {
    const executor = new CommandExecutor(makeRegistry())
    const handler = vi.fn()
    executor.on('shortcut', handler)
    await executor.execute('cmd.miss')
    expect(handler).not.toHaveBeenCalled()
  })

  it('off removes handler', async () => {
    const cmd = makeCommand({ id: 'cmd.off' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    const handler = vi.fn()
    executor.on('shortcut', handler)
    executor.off('shortcut', handler)
    await executor.execute('cmd.off')
    expect(handler).not.toHaveBeenCalled()
  })

  it('off on unknown event is a no-op', () => {
    const executor = new CommandExecutor(makeRegistry())
    expect(() => executor.off('shortcut', vi.fn())).not.toThrow()
  })

  it('catches handler errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cmd = makeCommand({ id: 'cmd.h' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    executor.on('shortcut', () => {
      throw new Error('handler-fail')
    })
    await expect(executor.execute('cmd.h')).resolves.toMatchObject({ success: true })
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('CommandExecutor - history', () => {
  beforeEach(() => {
    mockNavigator('Win32')
  })

  it('records successful executions', async () => {
    const cmd = makeCommand({ id: 'cmd.h' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    await executor.execute('cmd.h')
    expect(executor.historyLength).toBe(1)
  })

  it('records failed executions', async () => {
    const executor = new CommandExecutor(makeRegistry())
    await executor.execute('cmd.miss')
    expect(executor.historyLength).toBe(1)
  })

  it('getHistory returns frozen list', async () => {
    const cmd = makeCommand({ id: 'cmd.h' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    await executor.execute('cmd.h')
    const history = executor.getHistory()
    expect(Object.isFrozen(history)).toBe(true)
    expect(history).toHaveLength(1)
  })

  it('clearHistory empties the history', async () => {
    const cmd = makeCommand({ id: 'cmd.h' })
    const executor = new CommandExecutor(makeRegistry([cmd]))
    await executor.execute('cmd.h')
    executor.clearHistory()
    expect(executor.historyLength).toBe(0)
  })

  it('getRecentResults returns the most recent N results', async () => {
    const cmd1 = makeCommand({ id: 'cmd.1' })
    const cmd2 = makeCommand({ id: 'cmd.2' })
    const cmd3 = makeCommand({ id: 'cmd.3' })
    const executor = new CommandExecutor(makeRegistry([cmd1, cmd2, cmd3]))
    await executor.execute('cmd.1')
    await executor.execute('cmd.2')
    await executor.execute('cmd.3')
    const recent = executor.getRecentResults(2)
    expect(recent).toHaveLength(2)
    expect(recent[0]?.commandId).toBe('cmd.2')
    expect(recent[1]?.commandId).toBe('cmd.3')
  })

  it('truncates history beyond maxHistoryLength', async () => {
    const cmd = makeCommand({ id: 'cmd.h' })
    const executor = new CommandExecutor(makeRegistry([cmd]), undefined, 3)
    for (let i = 0; i < 5; i++) {
      await executor.execute('cmd.h')
    }
    expect(executor.historyLength).toBe(3)
  })
})
