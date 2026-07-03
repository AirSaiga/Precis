/**
 * @file actions.ts — 自动生成,禁止手改
 *
 * 由 frontend/scripts/codegen.mjs 从后端 registry.py 生成。
 * 改动作类型后跑 `npm run codegen` 重新生成;CI 会校验生成物与提交一致。
 */

// 动作类型联合(单一事实源:后端 registry.ACTIONS)
export type ActionType =
  | 'ADD_CONSTRAINT_NODE'
  | 'UPDATE_CONSTRAINT_NODE'
  | 'DELETE_CONSTRAINT_NODE'
  | 'ADD_SCHEMA'
  | 'UPDATE_SCHEMA'
  | 'DELETE_SCHEMA'
  | 'ADD_REGEX'
  | 'UPDATE_REGEX'
  | 'DELETE_REGEX'
  | 'ADD_TRANSFORM'
  | 'UPDATE_TRANSFORM'
  | 'DELETE_TRANSFORM'
  | 'UPDATE_SETTINGS'
  | 'VALIDATE_PROJECT'
  | 'ADD_TO_CANVAS'

// 全部动作类型列表(顺序与后端 ACTIONS 插入序一致)
export const ALL_ACTION_TYPES: ActionType[] = [
  'ADD_CONSTRAINT_NODE',
  'UPDATE_CONSTRAINT_NODE',
  'DELETE_CONSTRAINT_NODE',
  'ADD_SCHEMA',
  'UPDATE_SCHEMA',
  'DELETE_SCHEMA',
  'ADD_REGEX',
  'UPDATE_REGEX',
  'DELETE_REGEX',
  'ADD_TRANSFORM',
  'UPDATE_TRANSFORM',
  'DELETE_TRANSFORM',
  'UPDATE_SETTINGS',
  'VALIDATE_PROJECT',
  'ADD_TO_CANVAS',
]

export const CONSTRAINT_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_CONSTRAINT_NODE',
  'DELETE_CONSTRAINT_NODE',
  'UPDATE_CONSTRAINT_NODE',
])

export const SCHEMA_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_SCHEMA',
  'DELETE_SCHEMA',
  'UPDATE_SCHEMA',
])

export const REGEX_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_REGEX',
  'DELETE_REGEX',
  'UPDATE_REGEX',
])

export const TRANSFORM_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_TRANSFORM',
  'DELETE_TRANSFORM',
  'UPDATE_TRANSFORM',
])

export const READ_ONLY_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_TO_CANVAS',
  'VALIDATE_PROJECT',
])

export const WRITE_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_CONSTRAINT_NODE',
  'ADD_REGEX',
  'ADD_SCHEMA',
  'ADD_TRANSFORM',
  'DELETE_CONSTRAINT_NODE',
  'DELETE_REGEX',
  'DELETE_SCHEMA',
  'DELETE_TRANSFORM',
  'UPDATE_CONSTRAINT_NODE',
  'UPDATE_REGEX',
  'UPDATE_SCHEMA',
  'UPDATE_SETTINGS',
  'UPDATE_TRANSFORM',
])
