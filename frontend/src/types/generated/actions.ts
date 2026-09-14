/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview actions.ts — 自动生成,禁止手改
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

// 约束类型标准名（PascalCase，sorted；单一事实源：后端 registry.CONSTRAINT_TYPES）
export const CANONICAL_CONSTRAINT_TYPES: readonly string[] = [
  'AllowedValues',
  'Charset',
  'Composite',
  'Conditional',
  'DateLogic',
  'ForeignKey',
  'NotNull',
  'Range',
  'Scripted',
  'Unique',
]

// 约束类型映射（单一事实源：后端 registry.CONSTRAINT_TYPES + CONSTRAINT_TYPE_ALIASES）
// key = PascalCase 正名 + 大写别名（LLM 两种写法都可能回），value = 前端 ConstraintKind（camelCase）
export const CONSTRAINT_TYPE_MAP: Record<string, string> = {
  ALLOWED_VALUES: 'allowedValues',
  AllowedValues: 'allowedValues',
  Charset: 'charset',
  CHARSET: 'charset',
  Composite: 'composite',
  COMPOSITE: 'composite',
  Conditional: 'conditional',
  CONDITIONAL: 'conditional',
  DATE_LOGIC: 'dateLogic',
  DateLogic: 'dateLogic',
  FOREIGN_KEY: 'foreignKey',
  ForeignKey: 'foreignKey',
  NOT_NULL: 'notNull',
  NotNull: 'notNull',
  Range: 'range',
  RANGE: 'range',
  REGEX: 'scripted',
  Scripted: 'scripted',
  Unique: 'unique',
  UNIQUE: 'unique',
}

// 约束类型别名声明（alias → PascalCase 正名；单一事实源：后端 registry.CONSTRAINT_TYPE_ALIASES）
export const CONSTRAINT_TYPE_ALIASES: Record<string, string> = {
  ALLOWED_VALUES: 'AllowedValues',
  CHARSET: 'Charset',
  COMPOSITE: 'Composite',
  CONDITIONAL: 'Conditional',
  DATE_LOGIC: 'DateLogic',
  FOREIGN_KEY: 'ForeignKey',
  NOT_NULL: 'NotNull',
  RANGE: 'Range',
  REGEX: 'Scripted',
  UNIQUE: 'Unique',
}
