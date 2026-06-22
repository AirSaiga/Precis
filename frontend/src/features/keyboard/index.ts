/**
 * Keyboard Shortcuts Module - 主入口
 *
 * 该模块提供快捷键功能的统一入口
 * 使用组合式函数模式，集成注册表、执行器和监听器
 */

import { ref } from 'vue'
import type {
  Command,
  CommandContext,
  KeyboardListenerConfig,
  Shortcut,
  ShortcutEventData,
} from './types'
import { ShortcutRegistry } from './registry'
import { CommandExecutor } from './executor'
import { KeyboardListenerImpl } from './listeners'
import { DEFAULT_REGISTRY_CONFIG } from './constants'
import { platformAdapter } from './platform'
import { platformDetector } from './platform'
import { getBaseCommands } from './commands/baseCommands'
import { getCanvasCommands } from './commands/canvasCommands'
import { getHelpCommands } from './commands/helpCommands'
/**
 * 快捷键管理器接口
 */
export interface KeyboardShortcutManager {
  register: (command: Command) => boolean
  registerAll: (commands: Command[]) => number
  unregister: (commandId: string) => boolean
  execute: (commandId: string) => Promise<{ success: boolean }>
  enable: (commandId: string) => boolean
  disable: (commandId: string) => boolean
  start: () => void
  stop: () => void
  updateWhen: (when: () => boolean) => void
  getAllCommands: () => Command[]
  applyUserConfig: (config: {
    customShortcuts?: Record<string, Shortcut>
    disabledCommands?: string[]
  }) => void
  get size(): number
  get isActive(): boolean
}

/**
 * 创建快捷键管理器
 */
export function createKeyboardShortcuts(
  options: {
    context?: Partial<CommandContext>
    getExecutionContext?: () => Partial<CommandContext>
    listenerConfig?: Partial<KeyboardListenerConfig>
    registryConfig?: typeof DEFAULT_REGISTRY_CONFIG
    autoRegisterDefaults?: boolean
    autoStart?: boolean
    userConfig?: {
      customShortcuts?: Record<string, Shortcut>
      disabledCommands?: string[]
    }
  } = {}
): KeyboardShortcutManager {
  const {
    context,
    getExecutionContext,
    listenerConfig,
    registryConfig,
    autoRegisterDefaults = true,
    autoStart = true,
    userConfig,
  } = options

  const registry = new ShortcutRegistry(registryConfig)

  const executor = new CommandExecutor(
    {
      getCommand: (commandId) => registry.getCommand(commandId),
      getCommandShortcut: (command) => registry.getCommandShortcut(command),
      isDisabled: (commandId) => registry.isDisabled(commandId),
    },
    context
  )

  const executorInterface = {
    execute: async (commandId: string) => {
      const runtimeContext = getExecutionContext ? getExecutionContext() : {}
      const result = await executor.execute(commandId, runtimeContext)
      return result
    },
    on: (event: string, handler: (data: ShortcutEventData) => void) => {
      executor.on(event as 'shortcut', handler)
    },
    off: (event: string, handler: (data: ShortcutEventData) => void) => {
      executor.off(event as 'shortcut', handler)
    },
  }

  const listener = new KeyboardListenerImpl(
    executorInterface as {
      execute: (commandId: string) => Promise<{ success: boolean }>
      on: (event: string, handler: (data: ShortcutEventData) => void) => void
      off: (event: string, handler: (data: ShortcutEventData) => void) => void
    },
    listenerConfig
  )

  listener.on('shortcut', (eventData: ShortcutEventData) => {
    const matchedCommand = registry.getCommandByEvent(eventData.originalEvent)
    if (matchedCommand) {
      eventData.commandId = matchedCommand.id
      eventData.executed = true
      executorInterface.execute(matchedCommand.id)
    }
  })

  const isActive = ref(false)

  const execute = async (commandId: string): Promise<{ success: boolean }> => {
    const runtimeContext = getExecutionContext ? getExecutionContext() : {}
    const result = await executor.execute(commandId, runtimeContext)
    return { success: result.success }
  }

  const buildDefaultCommands = (): Command[] => {
    return autoRegisterDefaults
      ? [...getBaseCommands(), ...getCanvasCommands(), ...getHelpCommands()]
      : []
  }

  const applyCustomShortcuts = (
    commands: Command[],
    customShortcuts?: Record<string, Shortcut>
  ): Command[] => {
    if (!customShortcuts) {
      return commands
    }
    return commands.map((cmd) => {
      const custom = customShortcuts[cmd.id]
      if (!custom) {
        return cmd
      }
      return {
        ...cmd,
        defaultShortcut: { ...custom },
        platformVariants: undefined,
      }
    })
  }

  const applyUserConfig = (config: {
    customShortcuts?: Record<string, Shortcut>
    disabledCommands?: string[]
  }): void => {
    registry.clear()
    const baseCommands = buildDefaultCommands()
    const mergedCommands = applyCustomShortcuts(baseCommands, config.customShortcuts)
    registry.registerAll(mergedCommands)

    if (config.disabledCommands) {
      for (const commandId of config.disabledCommands) {
        registry.disable(commandId)
      }
    }
  }

  applyUserConfig(userConfig ?? {})

  const manager: KeyboardShortcutManager = {
    register: (command) => registry.register(command),
    registerAll: (cmdList) => registry.registerAll(cmdList),
    unregister: (commandId) => registry.unregister(commandId),
    execute,
    enable: (commandId) => registry.enable(commandId),
    disable: (commandId) => registry.disable(commandId),
    start: () => {
      listener.start()
      isActive.value = true
    },
    stop: () => {
      listener.stop()
      isActive.value = false
    },
    updateWhen: (when) => {
      listener.register({ when })
    },
    getAllCommands: () => registry.getAllCommands(),
    applyUserConfig,
    get size() {
      return registry.size
    },
    get isActive() {
      return isActive.value
    },
  }

  if (autoStart) {
    manager.start()
  }

  return manager
}

/**
 * 使用快捷键的组合式函数
 */
export function useKeyboardShortcuts(
  options: {
    config?: Partial<KeyboardListenerConfig>
    autoRegisterDefaults?: boolean
    autoStart?: boolean
    getExecutionContext?: () => Partial<CommandContext>
    userConfig?: {
      customShortcuts?: Record<string, Shortcut>
      disabledCommands?: string[]
    }
  } = {}
): KeyboardShortcutManager {
  const manager = createKeyboardShortcuts({
    listenerConfig: options.config,
    autoRegisterDefaults: options.autoRegisterDefaults ?? true,
    autoStart: options.autoStart ?? true,
    getExecutionContext: options.getExecutionContext,
    userConfig: options.userConfig,
  })

  return manager
}

export { platformAdapter as shortcuts }
export { platformDetector }

export default useKeyboardShortcuts
