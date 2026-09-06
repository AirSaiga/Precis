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
 * @fileoverview Builder 注册入口
 *
 * 触发所有 builder 模块的 side-effect 注册。
 * 导入本文件即可激活全部 builder。
 */

import './registry'
import { registerBuilder } from './registry'
import './constraint'
import { manualDataBuilder } from './manualDataBuilder'
import { regexBuilder } from './regexBuilder'
import { regexExtractBuilder } from './regexExtractBuilder'
import { schemaBuilder } from './schemaBuilder'
import { templateInstanceBuilder } from './templateInstanceBuilder'
import { transformBuilder } from './transformBuilder'

registerBuilder(schemaBuilder)
registerBuilder(regexBuilder)
registerBuilder(regexExtractBuilder)
registerBuilder(transformBuilder)
registerBuilder(manualDataBuilder)
registerBuilder(templateInstanceBuilder)

export {
  schemaBuilder,
  regexBuilder,
  regexExtractBuilder,
  transformBuilder,
  manualDataBuilder,
  templateInstanceBuilder,
}
export * from './registry'
export type * from '../types'
