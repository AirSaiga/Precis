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
 * @fileoverview NodeDataBuilder 统一导出
 *
 * 导入本模块即触发各 builder 的自注册。
 * 使用方只需导入 buildNodeData 即可。
 */

export { buildNodeData, registerBuilder } from './registry'
export type {
  BuildInput,
  BuildResult,
  EdgeDescriptor,
  BuildMode,
  ColumnRef,
  FKRefs,
  ConditionalIfItem,
} from './types'

// 触发各 builder 的自注册
import './simpleConstraint'
import './foreignKey'
import './conditional'
import './regex'
