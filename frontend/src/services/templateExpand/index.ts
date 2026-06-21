/**
 * 模板展开后置钩子服务入口
 *
 * 导出 registerTemplateExpandHandler / executeTemplateExpandHooks，
 * 并通过 side-effect import 触发所有 handler 的自注册。
 */
export { registerTemplateExpandHandler, executeTemplateExpandHooks } from './registryCore'
export { resetRelationshipSyncRound } from './registryHandlers/relationshipSync'
export type { TemplateExpandDagNode, TemplateExpandContext, TemplateExpandHandler } from './types'
import './registryHandlers'
