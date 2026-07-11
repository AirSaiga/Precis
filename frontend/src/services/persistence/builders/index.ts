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
