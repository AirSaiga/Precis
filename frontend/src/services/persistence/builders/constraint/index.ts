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
 * @fileoverview Constraint Builders 入口
 *
 * 统一注册 10 种约束类型的 standalone builder。
 */

import { registerBuilder } from '../registry'
import { notNullBuilder } from './notNull'
import { uniqueBuilder } from './unique'
import { allowedValuesBuilder } from './allowedValues'
import { rangeBuilder } from './range'
import { charsetBuilder } from './charset'
import { dateLogicBuilder } from './dateLogic'
import { foreignKeyBuilder } from './foreignKey'
import { conditionalBuilder } from './conditional'
import { scriptedBuilder } from './scripted'
import { compositeBuilder } from './composite'

const constraintBuilders = [
  notNullBuilder,
  uniqueBuilder,
  allowedValuesBuilder,
  rangeBuilder,
  charsetBuilder,
  dateLogicBuilder,
  foreignKeyBuilder,
  conditionalBuilder,
  scriptedBuilder,
  compositeBuilder,
]

constraintBuilders.forEach((builder) => registerBuilder(builder))

export {
  notNullBuilder,
  uniqueBuilder,
  allowedValuesBuilder,
  rangeBuilder,
  charsetBuilder,
  dateLogicBuilder,
  foreignKeyBuilder,
  conditionalBuilder,
  scriptedBuilder,
  compositeBuilder,
}
