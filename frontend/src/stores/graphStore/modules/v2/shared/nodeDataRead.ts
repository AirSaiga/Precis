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
 * @fileoverview 节点 data 的零断言宽松读取（CustomNodeData 判别联合无索引签名，
 * 直接 as Record 会触发 TS2352；此处以 unknown 收参 + 运行时判型收敛，
 * 供 V2 导入器的原地刷新路径读取旧 data 键集/单键）。
 */

/** 节点 data 的键集（data 非对象时返回空数组） */
export function nodeDataKeys(data: unknown): string[] {
  return data !== null && typeof data === 'object' ? Object.keys(data) : []
}

/** 节点 data 的单键读取（值类型 unknown，调用方自行判型） */
export function nodeDataGet(data: unknown, key: string): unknown {
  if (data === null || typeof data !== 'object') return undefined
  return (data as Record<string, unknown>)[key]
}
