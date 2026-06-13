/**
 * @file index.ts
 * @description 约束验证处理器注册入口
 *
 * side-effect import 各约束类型 handler 文件，触发 register() 自注册。
 * 消费者只需导入：
 *   import '@/services/constraints/validationRegistryHandlers'
 */

import './notNullHandler'
import './uniqueHandler'
import './allowedValuesHandler'
import './rangeHandler'
import './charsetHandler'
import './scriptedHandler'
import './foreignKeyHandler'
import './conditionalHandler'
import './dateLogicHandler'
import './compositeHandler'
