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
 * @file regex.ts
 * @description 正则节点类型判断工具
 */

const REGEX_NODE_TYPE_VALUES = ['regex', 'regexExtract'] as const

export type RegexNodeType = (typeof REGEX_NODE_TYPE_VALUES)[number]

export const REGEX_NODE_TYPES = Object.freeze(new Set(REGEX_NODE_TYPE_VALUES))

export function isRegexNodeType(type: string | undefined): type is RegexNodeType {
  return !!type && REGEX_NODE_TYPES.has(type as RegexNodeType)
}
