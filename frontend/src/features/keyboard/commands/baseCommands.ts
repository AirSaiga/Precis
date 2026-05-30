/**
 * @file baseCommands.ts
 * @description 基础快捷键命令定义
 */
import type { Command } from '../types'
import { save } from '../handlers/editor'
import { undo, redo } from '../handlers/history'
import { copyNode, cutNode, pasteNode, selectAllNodes } from '../handlers/node'
import { showFeedback } from './feedback'

export function createSaveCommand(): Command {
  return {
    id: 'editor.save',
    name: 'shortcuts.commands.save',
    defaultShortcut: { key: 's', ctrl: true },
    platformVariants: {
      mac: { key: 's', meta: true },
      windows: { key: 's', ctrl: true }
    },
    category: 'editor',
    priority: 100,
    execute: async (context) => {
      const result = await save()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    }
  }
}

export function createUndoCommand(): Command {
  return {
    id: 'editor.undo',
    name: 'shortcuts.commands.undo',
    defaultShortcut: { key: 'z', ctrl: true },
    platformVariants: {
      mac: { key: 'z', meta: true },
      windows: { key: 'z', ctrl: true }
    },
    category: 'editor',
    priority: 90,
    execute: async (context) => {
      const result = await undo()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    }
  }
}

export function createRedoCommand(): Command {
  return {
    id: 'editor.redo',
    name: 'shortcuts.commands.redo',
    defaultShortcut: { key: 'y', ctrl: true },
    platformVariants: {
      mac: { key: 'z', meta: true, shift: true },
      windows: { key: 'y', ctrl: true }
    },
    category: 'editor',
    priority: 89,
    execute: async (context) => {
      const result = await redo()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    }
  }
}

export function createCopyCommand(): Command {
  return {
    id: 'editor.copy',
    name: 'shortcuts.commands.copy',
    defaultShortcut: { key: 'c', ctrl: true },
    platformVariants: {
      mac: { key: 'c', meta: true },
      windows: { key: 'c', ctrl: true }
    },
    category: 'editor',
    priority: 85,
    execute: async (context) => {
      const result = await copyNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const selection = window.getSelection()
      if (selection && selection.toString().trim().length > 0) {
        return false
      }
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null || (graphStore.selectedNodeIds && graphStore.selectedNodeIds.length > 0)
    }
  }
}

export function createCutCommand(): Command {
  return {
    id: 'editor.cut',
    name: 'shortcuts.commands.cut',
    defaultShortcut: { key: 'x', ctrl: true },
    platformVariants: {
      mac: { key: 'x', meta: true },
      windows: { key: 'x', ctrl: true }
    },
    category: 'editor',
    priority: 79,
    execute: async (context) => {
      const result = await cutNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const selection = window.getSelection()
      if (selection && selection.toString().trim().length > 0) {
        return false
      }
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null || (graphStore.selectedNodeIds && graphStore.selectedNodeIds.length > 0)
    }
  }
}

export function createPasteCommand(): Command {
  return {
    id: 'editor.paste',
    name: 'shortcuts.commands.paste',
    defaultShortcut: { key: 'v', ctrl: true },
    platformVariants: {
      mac: { key: 'v', meta: true },
      windows: { key: 'v', ctrl: true }
    },
    category: 'editor',
    priority: 78,
    execute: async (context) => {
      const result = await pasteNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    }
  }
}

export function createSelectAllCommand(): Command {
  return {
    id: 'editor.selectAll',
    name: 'shortcuts.commands.selectAll',
    defaultShortcut: { key: 'a', ctrl: true },
    platformVariants: {
      mac: { key: 'a', meta: true },
      windows: { key: 'a', ctrl: true }
    },
    category: 'editor',
    priority: 70,
    execute: async (context) => {
      const result = await selectAllNodes()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    }
  }
}

export function getBaseCommands(): Command[] {
  return [
    createSaveCommand(),
    createUndoCommand(),
    createRedoCommand(),
    createCopyCommand(),
    createCutCommand(),
    createPasteCommand(),
    createSelectAllCommand()
  ]
}
