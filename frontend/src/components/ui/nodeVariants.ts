/**
 * @file nodeVariants.ts
 * @description 节点主题和状态变体定义
 *
 * 定义所有画布节点支持的主题色和状态枚举，供 NodeShell 和 GraphNodeFrame 使用。
 */

export const NODE_THEMES = [
  'primary',
  'success',
  'warning',
  'danger',
  'info',
  'purple',
  'orange',
  'sky',
  'pink',
  'script',
  'secondary',
] as const

export type NodeTheme = (typeof NODE_THEMES)[number]

export const NODE_STATES = ['idle', 'selected', 'success', 'warning', 'error', 'disabled'] as const

export type NodeState = (typeof NODE_STATES)[number]

export const NODE_BADGE_VARIANTS = ['solid', 'soft', 'outline'] as const
export type NodeBadgeVariant = (typeof NODE_BADGE_VARIANTS)[number]

export const NODE_BADGE_SIZES = ['xs', 'sm', 'md'] as const
export type NodeBadgeSize = (typeof NODE_BADGE_SIZES)[number]

export const NODE_HANDLE_SIZES = ['sm', 'md', 'lg'] as const
export type NodeHandleSize = (typeof NODE_HANDLE_SIZES)[number]

export function resolveNodeState(status?: string, selected?: boolean): NodeState {
  if (selected) {
    return 'selected'
  }

  switch (status) {
    case 'pass':
    case 'success':
      return 'success'
    case 'missing':
    case 'warning':
      return 'warning'
    case 'error':
    case 'danger':
      return 'error'
    case 'disabled':
      return 'disabled'
    default:
      return 'idle'
  }
}

export function resolveStateBadgeType(state: NodeState): NodeTheme {
  switch (state) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
      return 'danger'
    case 'selected':
      return 'primary'
    case 'disabled':
      return 'secondary'
    default:
      return 'info'
  }
}
