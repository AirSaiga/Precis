/**
 * ⚠️ 本文件由 codegen 从 backend/app/shared/services/llm/actions/registry.py 自动生成。
 * 禁止手改 —— 修改 registry.py 后跑 npm run codegen。
 */

export type ActionType =
  | 'ADD_CONSTRAINT_NODE'
  | 'ADD_SCHEMA'
  | 'VALIDATE_PROJECT'
  | 'ADD_TO_CANVAS'

export const CONSTRAINT_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_CONSTRAINT_NODE',
])

export const SCHEMA_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_SCHEMA',
])

export const REGEX_ACTION_TYPES: ReadonlySet<ActionType> = new Set([])

export const TRANSFORM_ACTION_TYPES: ReadonlySet<ActionType> = new Set([])

export const READ_ONLY_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'VALIDATE_PROJECT',
  'ADD_TO_CANVAS',
])

export const WRITE_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'ADD_CONSTRAINT_NODE',
  'ADD_SCHEMA',
])
