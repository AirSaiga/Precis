import type { Node, Edge } from '@vue-flow/core'
import type { DisconnectHandler, DisconnectContext } from './types'

export type { DisconnectHandler, DisconnectContext } from './types'

const handlers: DisconnectHandler[] = []

export function registerDisconnectHandler(handler: DisconnectHandler): void {
  handlers.push(handler)
  handlers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
}

export function executeDisconnectCleanup(
  edge: Edge,
  sourceNode: Node | undefined,
  targetNode: Node | undefined,
  ctx: DisconnectContext
): void {
  if (!targetNode) return
  const handler = handlers.find((h) => h.match(edge, sourceNode, targetNode, ctx))
  if (handler) {
    handler.cleanup(edge, sourceNode, targetNode, ctx)
  }
}
