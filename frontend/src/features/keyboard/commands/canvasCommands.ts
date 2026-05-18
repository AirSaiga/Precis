/**
 * @file canvasCommands.ts
 * @description 画布快捷键命令定义
 */
import type { Command } from '../types'
import { i18n } from '@/i18n'
import {
  zoomIn,
  zoomOut,
  resetZoom,
  fitView,
  toggleMinimap,
  centerView,
  focusToProjectRoot,
} from '../handlers/canvas'
import {
  duplicateNode,
  copyNode,
  pasteNode,
  deleteNode,
  selectAllNodes,
  moveNode,
  generateSchemaFromSource,
  bindDataSourceToSchema,
  validateSelectedNode,
} from '../handlers/node'

function showFeedback(key: string, detail?: string): void {
  const translatedText = i18n.global.t(key)
  const toast = (window as unknown as { $toast?: { info: (msg: string, detail: string) => void } })
    .$toast
  if (typeof window !== 'undefined' && toast) {
    toast.info(translatedText, detail || '')
  }
}

export function createZoomInCommand(): Command {
  return {
    id: 'canvas.zoomIn',
    name: 'shortcuts.commands.zoomIn',
    defaultShortcut: { key: '=', ctrl: true },
    platformVariants: {
      mac: { key: '=', meta: true },
      windows: { key: '=', ctrl: true },
    },
    category: 'canvas',
    priority: 50,
    execute: async (context) => {
      const result = await zoomIn()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createZoomOutCommand(): Command {
  return {
    id: 'canvas.zoomOut',
    name: 'shortcuts.commands.zoomOut',
    defaultShortcut: { key: '-', ctrl: true },
    platformVariants: {
      mac: { key: '-', meta: true },
      windows: { key: '-', ctrl: true },
    },
    category: 'canvas',
    priority: 49,
    execute: async (context) => {
      const result = await zoomOut()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createZoomResetCommand(): Command {
  return {
    id: 'canvas.zoomReset',
    name: 'shortcuts.commands.zoomReset',
    defaultShortcut: { key: '0', ctrl: true },
    platformVariants: {
      mac: { key: '0', meta: true },
      windows: { key: '0', ctrl: true },
    },
    category: 'canvas',
    priority: 48,
    execute: async (context) => {
      const result = await resetZoom()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createFitViewCommand(): Command {
  return {
    id: 'canvas.fitView',
    name: 'shortcuts.commands.fitView',
    defaultShortcut: { key: '1', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: '1', meta: true, shift: true },
      windows: { key: '1', ctrl: true, shift: true },
    },
    category: 'canvas',
    priority: 47,
    execute: async (context) => {
      const result = await fitView()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createToggleMinimapCommand(): Command {
  return {
    id: 'canvas.toggleMinimap',
    name: 'shortcuts.commands.toggleMinimap',
    defaultShortcut: { key: 'm', ctrl: true, alt: true },
    platformVariants: {
      mac: { key: 'm', meta: true, alt: true },
      windows: { key: 'm', ctrl: true, alt: true },
    },
    category: 'canvas',
    priority: 46,
    execute: async (context) => {
      const result = await toggleMinimap()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createCenterViewCommand(): Command {
  return {
    id: 'canvas.centerView',
    name: 'shortcuts.commands.centerView',
    defaultShortcut: { key: 'Home', ctrl: true },
    platformVariants: {
      mac: { key: 'Home', meta: true },
      windows: { key: 'Home', ctrl: true },
    },
    category: 'canvas',
    priority: 45,
    execute: async (context) => {
      const result = await centerView()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createCanvasSelectAllCommand(): Command {
  return {
    id: 'canvas.selectAll',
    name: 'shortcuts.commands.selectAll',
    defaultShortcut: { key: 'a', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: 'a', meta: true, shift: true },
      windows: { key: 'a', ctrl: true, shift: true },
    },
    category: 'canvas',
    priority: 44,
    execute: async (context) => {
      const result = await selectAllNodes()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createCanvasDeleteCommand(): Command {
  return {
    id: 'canvas.delete',
    name: 'shortcuts.commands.delete',
    defaultShortcut: { key: 'Delete' },
    category: 'canvas',
    priority: 43,
    execute: async (context) => {
      const result = await deleteNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return (
        graphStore.selectedNodeId !== null ||
        (graphStore.selectedNodeIds && graphStore.selectedNodeIds.length > 0)
      )
    },
  }
}

export function createCanvasDeleteBackspaceCommand(): Command {
  return {
    id: 'canvas.delete.backspace',
    name: 'shortcuts.commands.delete',
    defaultShortcut: { key: 'Backspace' },
    category: 'canvas',
    priority: 42,
    execute: async (context) => {
      const result = await deleteNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return (
        graphStore.selectedNodeId !== null ||
        (graphStore.selectedNodeIds && graphStore.selectedNodeIds.length > 0)
      )
    },
  }
}

export function createNodeCopyCommand(): Command {
  return {
    id: 'node.copy',
    name: 'shortcuts.commands.copy',
    defaultShortcut: { key: 'c', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: 'c', meta: true, shift: true },
      windows: { key: 'c', ctrl: true, shift: true },
    },
    category: 'node',
    priority: 42,
    execute: async (context) => {
      const result = await copyNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}

export function createNodePasteCommand(): Command {
  return {
    id: 'node.paste',
    name: 'shortcuts.commands.paste',
    defaultShortcut: { key: 'v', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: 'v', meta: true, shift: true },
      windows: { key: 'v', ctrl: true, shift: true },
    },
    category: 'node',
    priority: 41,
    execute: async (context) => {
      const result = await pasteNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createNodeMoveUpCommand(): Command {
  return {
    id: 'node.moveUp',
    name: 'shortcuts.commands.moveUp',
    defaultShortcut: { key: 'ArrowUp', shift: true },
    category: 'node',
    priority: 40,
    execute: async (context) => {
      const result = await moveNode('up')
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}

export function createNodeMoveDownCommand(): Command {
  return {
    id: 'node.moveDown',
    name: 'shortcuts.commands.moveDown',
    defaultShortcut: { key: 'ArrowDown', shift: true },
    category: 'node',
    priority: 39,
    execute: async (context) => {
      const result = await moveNode('down')
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}

export function createNodeMoveLeftCommand(): Command {
  return {
    id: 'node.moveLeft',
    name: 'shortcuts.commands.moveLeft',
    defaultShortcut: { key: 'ArrowLeft', shift: true },
    category: 'node',
    priority: 38,
    execute: async (context) => {
      const result = await moveNode('left')
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}

export function createNodeMoveRightCommand(): Command {
  return {
    id: 'node.moveRight',
    name: 'shortcuts.commands.moveRight',
    defaultShortcut: { key: 'ArrowRight', shift: true },
    category: 'node',
    priority: 37,
    execute: async (context) => {
      const result = await moveNode('right')
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}

export function createNodeDuplicateCommand(): Command {
  return {
    id: 'node.duplicate',
    name: 'shortcuts.commands.duplicate',
    defaultShortcut: { key: 'd', ctrl: true },
    platformVariants: {
      mac: { key: 'd', meta: true },
      windows: { key: 'd', ctrl: true },
    },
    category: 'node',
    priority: 36,
    execute: async (context) => {
      const result = await duplicateNode()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.selectedNodeId !== null
    },
  }
}

export function createFocusProjectCommand(): Command {
  return {
    id: 'canvas.focusProject',
    name: 'shortcuts.commands.focusProject',
    defaultShortcut: { key: 'h', ctrl: true },
    platformVariants: {
      mac: { key: 'h', meta: true },
      windows: { key: 'h', ctrl: true },
    },
    category: 'canvas',
    priority: 55,
    execute: async (context) => {
      const result = await focusToProjectRoot()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      const { useGraphStore } = await import('@/stores/graphStore')
      const graphStore = useGraphStore()
      return graphStore.isProjectLoaded
    },
  }
}

export function createGenerateSchemaCommand(): Command {
  return {
    id: 'canvas.generateSchema',
    name: 'shortcuts.commands.generateSchema',
    defaultShortcut: { key: 'g', ctrl: true },
    platformVariants: {
      mac: { key: 'g', meta: true },
      windows: { key: 'g', ctrl: true },
    },
    category: 'node',
    priority: 34,
    execute: async (context) => {
      const result = await generateSchemaFromSource()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}

export function createBindDataSourceCommand(): Command {
  return {
    id: 'node.bindDataSource',
    name: 'shortcuts.commands.bindDataSource',
    defaultShortcut: { key: 'b', ctrl: true },
    platformVariants: {
      mac: { key: 'b', meta: true },
      windows: { key: 'b', ctrl: true },
    },
    category: 'node',
    priority: 35,
    execute: async (context) => {
      const result = await bindDataSourceToSchema()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
    isAvailable: async () => {
      // 条件检查下沉到 validateSelectedNode handler 内部处理
      // 避免 keyboard 上下文外获取 store 的潜在问题
      return true
    },
  }
}

export function createValidateNodeCommand(): Command {
  return {
    id: 'node.validate',
    name: 'shortcuts.commands.validateNode',
    defaultShortcut: { key: 'Enter', ctrl: true },
    platformVariants: {
      mac: { key: 'Enter', meta: true },
      windows: { key: 'Enter', ctrl: true },
    },
    category: 'node',
    priority: 32,
    execute: async (context) => {
      const result = await validateSelectedNode()
      if (context.showFeedback && result.message) {
        if (result.summary && result.summary.total > 0) {
          const detail = `${result.summary.valid}/${result.summary.total} passed, ${result.summary.errors} errors`
          showFeedback(result.message, detail)
        } else {
          showFeedback(result.message)
        }
      }
    },
    isAvailable: async () => {
      // 前置检查下沉到 validateSelectedNode handler 内部，
      // 避免在 keyboard 执行上下文外通过 graphStore 做响应式查找导致的可用性误判
      return true
    },
  }
}

export function getCanvasCommands(): Command[] {
  return [
    createZoomInCommand(),
    createZoomOutCommand(),
    createZoomResetCommand(),
    createFitViewCommand(),
    createToggleMinimapCommand(),
    createCenterViewCommand(),
    createCanvasSelectAllCommand(),
    createCanvasDeleteCommand(),
    createCanvasDeleteBackspaceCommand(),
    createNodeCopyCommand(),
    createNodePasteCommand(),
    createNodeMoveUpCommand(),
    createNodeMoveDownCommand(),
    createNodeMoveLeftCommand(),
    createNodeMoveRightCommand(),
    createNodeDuplicateCommand(),
    createFocusProjectCommand(),
    createGenerateSchemaCommand(),
    createBindDataSourceCommand(),
    createValidateNodeCommand(),
  ]
}
