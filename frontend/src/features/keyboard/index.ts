/**
 * Keyboard Shortcuts Module - 主入口
 *
 * 该模块提供快捷键功能的统一入口
 * 使用组合式函数模式，集成注册表、执行器和监听器
 */

import { ref, onMounted, onUnmounted, readonly } from 'vue'
import type { ComponentInternalInstance } from 'vue'
import type { Command, CommandContext, KeyboardListenerConfig, Shortcut, ShortcutEventData } from './types'
import { ShortcutRegistry } from './registry'
import { CommandExecutor } from './executor'
import { KeyboardListenerImpl } from './listeners'
import { DEFAULT_SHORTCUTS, DEFAULT_LISTENER_CONFIG, DEFAULT_REGISTRY_CONFIG } from './constants'
import { platformAdapter } from './platform'
import { platformDetector } from './platform'
import { getBaseCommands } from './commands/baseCommands'
import { getCanvasCommands } from './commands/canvasCommands'
import { getHelpCommands } from './commands/helpCommands'

/**
 * 快捷键管理器接口
 */
export interface KeyboardShortcutManager {
  /**
   * 注册命令
   */
  register: (command: Command) => boolean

  /**
   * 批量注册命令
   */
  registerAll: (commands: Command[]) => number

  /**
   * 注销命令
   */
  unregister: (commandId: string) => boolean

  /**
   * 执行命令
   */
  execute: (commandId: string) => Promise<{ success: boolean }>

  /**
   * 启用命令
   */
  enable: (commandId: string) => boolean

  /**
   * 禁用命令
   */
  disable: (commandId: string) => boolean

  /**
   * 开始监听
   */
  start: () => void

  /**
   * 停止监听
   */
  stop: () => void

  /**
   * 更新条件函数
   */
  updateWhen: (when: () => boolean) => void

  /**
   * 获取所有命令
   */
  getAllCommands: () => Command[]
 
  /**
   * 应用用户配置（自定义快捷键与禁用命令）
   */
  applyUserConfig: (config: {
    customShortcuts?: Record<string, Shortcut>
    disabledCommands?: string[]
  }) => void

  /**
   * 获取命令数量
   */
  get size(): number

  /**
   * 获取监听器状态
   */
  get isActive(): boolean
}

/**
 * 创建快捷键管理器
 *
 * @param options 配置选项
 * @returns 快捷键管理器实例
 */
export function createKeyboardShortcuts(
  options: {
    /**
     * 初始上下文
     */
    context?: Partial<CommandContext>
 
    /**
     * 动态上下文提供者（每次执行命令时读取）
     * 用于让 showFeedback 等配置支持运行时切换
     */
    getExecutionContext?: () => Partial<CommandContext>

    /**
     * 监听配置
     */
    listenerConfig?: Partial<KeyboardListenerConfig>

    /**
     * 注册表配置
     */
    registryConfig?: typeof DEFAULT_REGISTRY_CONFIG

    /**
     * 是否自动注册默认命令
     * @default true
     */
    autoRegisterDefaults?: boolean

    /**
     * 是否自动启动监听
     * @default true
     */
    autoStart?: boolean
 
    /**
     * 用户配置（用于初始化自定义快捷键与禁用命令）
     */
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
    userConfig
  } = options

  const registry = new ShortcutRegistry(registryConfig)
  
  const executor = new CommandExecutor(
    {
      getCommand: (commandId) => registry.getCommand(commandId),
      getCommandShortcut: (command) => registry.getCommandShortcut(command),
      isDisabled: (commandId) => registry.isDisabled(commandId)
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
    }
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

  const activeComponent = ref<ComponentInternalInstance | null>(null)
  const isActive = ref(false)

  const execute = async (commandId: string): Promise<{ success: boolean }> => {
    const runtimeContext = getExecutionContext ? getExecutionContext() : {}
    const result = await executor.execute(commandId, runtimeContext)
    return { success: result.success }
  }

  /**
   * 构建默认命令列表（用于初始化/重建）
   */
  const buildDefaultCommands = (): Command[] => {
    return autoRegisterDefaults
      ? [...getBaseCommands(), ...getCanvasCommands(), ...getHelpCommands()]
      : []
  }
 
  /**
   * 应用用户自定义快捷键：将 defaultShortcut 覆盖为用户输入，并清空平台变体
   *
   * @param commands 命令列表
   * @param customShortcuts 自定义快捷键表（commandId -> Shortcut）
   */
  const applyCustomShortcuts = (commands: Command[], customShortcuts?: Record<string, Shortcut>): Command[] => {
    if (!customShortcuts) {
      return commands
    }
    return commands.map(cmd => {
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
 
  /**
   * 重新注册命令并应用禁用列表
   *
   * @param config 用户配置
   */
  const applyUserConfig = (config: { customShortcuts?: Record<string, Shortcut>; disabledCommands?: string[] }): void => {
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
 
  // 初始化：注册命令并应用用户配置
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
    }
  }

  if (autoStart) {
    manager.start()
  }

  return manager
}

/**
 * 使用快捷键的组合式函数
 *
 * @param options 配置选项
 * @returns 快捷键管理器
 */
export function useKeyboardShortcuts(
  options: {
    /**
     * 监听配置
     */
    config?: Partial<KeyboardListenerConfig>

    /**
     * 是否自动注册默认命令
     * @default true
     */
    autoRegisterDefaults?: boolean

    /**
     * 是否自动启动
     * @default true
     */
    autoStart?: boolean
 
    /**
     * 动态上下文提供者（每次执行命令时读取）
     */
    getExecutionContext?: () => Partial<CommandContext>
 
    /**
     * 用户配置（用于初始化自定义快捷键与禁用命令）
     */
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

/**
 * 命令执行器单例
 *
 * 用于在非Vue组件中执行命令
 */
let globalExecutor: ReturnType<typeof createKeyboardShortcuts> | null = null

/**
 * 获取全局命令执行器
 *
 * @returns 全局命令执行器
 */
export function getGlobalExecutor(): ReturnType<typeof createKeyboardShortcuts> {
  if (!globalExecutor) {
    globalExecutor = createKeyboardShortcuts()
  }
  return globalExecutor
}

/**
 * 执行全局命令
 *
 * @param commandId 命令ID
 * @returns 执行结果
 */
export async function executeCommand(commandId: string): Promise<{ success: boolean }> {
  const executor = getGlobalExecutor()
  return executor.execute(commandId)
}

/**
 * 快捷键格式化工具
 */
export { platformAdapter as shortcuts }

/**
 * 快捷键检测工具
 */
export { platformDetector }

export default useKeyboardShortcuts
