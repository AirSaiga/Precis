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
 * @fileoverview AI → 前端变更集信封（v2 契约）的类型定义与运行时校验。
 *
 * 契约权威文档：docs/contracts/frontend-instructions-v2.md。
 * 信封不携带任何实体数据，只声明"哪个磁盘实体发生了什么变化"；
 * 前端统一动作是按 kind + entityId 从磁盘重读重建画布（文件唯一事实源，D1）。
 */

/** 文件级操作语义 */
export type ChangeSetOp = 'add' | 'update' | 'remove'

/** 磁盘实体类别（manualData/template 为前后端对称预留，当前无 AI 动作产出） */
export type ChangeSetKind =
  'schema' | 'constraint' | 'regex' | 'transform' | 'manualData' | 'template'

/**
 * 变更集信封：frontend_instruction SSE 事件与 completed 快照中每条指令的形状。
 * 六字段契约（只增不减，消费方须容忍未知字段）：
 * - instructionId: 确定性标识 "{op}:{kind}:{entityId}"，供追踪与显式去重
 * - actionType: 原动作类型（展示/遥测用，不用于分发逻辑）
 * - op / kind / entityId / filePath: 见 CHANGESET_KINDS 与契约文档
 */
export interface ChangeSetEnvelope {
  instructionId: string
  actionType: string
  op: ChangeSetOp
  kind: ChangeSetKind
  /** 磁盘实体真实 id，恒等于宿主文件 id 与画布节点 id */
  entityId: string
  /** 项目相对 POSIX 路径 */
  filePath: string
}

const OPS: ReadonlySet<string> = new Set(['add', 'update', 'remove'])
const KINDS: ReadonlySet<string> = new Set([
  'schema',
  'constraint',
  'regex',
  'transform',
  'manualData',
  'template',
])

/**
 * 运行时校验并解析信封（SSE data 是 untyped unknown）。
 *
 * 契约承诺六字段必在且类型固定；字段缺失/类型不符视为契约破坏，返回 null
 * 由调用方记日志丢弃（不进失败清单——无法定位实体，报错只会制造噪音）。
 * 未知额外字段按"只增不减"承诺容忍。
 */
export function parseChangeSetEnvelope(value: unknown): ChangeSetEnvelope | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    typeof v.instructionId !== 'string' ||
    typeof v.actionType !== 'string' ||
    typeof v.op !== 'string' ||
    !OPS.has(v.op) ||
    typeof v.kind !== 'string' ||
    !KINDS.has(v.kind) ||
    typeof v.entityId !== 'string' ||
    typeof v.filePath !== 'string'
  ) {
    return null
  }
  return {
    instructionId: v.instructionId,
    actionType: v.actionType,
    op: v.op as ChangeSetOp,
    kind: v.kind as ChangeSetKind,
    entityId: v.entityId,
    filePath: v.filePath,
  }
}
