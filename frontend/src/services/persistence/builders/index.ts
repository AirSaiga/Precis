/**
 * @fileoverview Builder 注册入口
 *
 * 触发所有 builder 模块的 side-effect 注册。
 * 导入本文件即可激活全部 builder。
 */

import './registry'
import { registerBuilder } from './registry'
import { schemaBuilder } from './schemaBuilder'
import { regexBuilder } from './regexBuilder'
import { transformBuilder } from './transformBuilder'
import { templateInstanceBuilder } from './templateInstanceBuilder'
import './constraint'

registerBuilder(schemaBuilder)
registerBuilder(regexBuilder)
registerBuilder(transformBuilder)
registerBuilder(templateInstanceBuilder)

export { schemaBuilder, regexBuilder, transformBuilder, templateInstanceBuilder }
export * from './constraint'
export * from './registry'
export type * from '../types'
