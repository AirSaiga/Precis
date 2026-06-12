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
