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
 * @fileoverview Persistence 层入口
 *
 * 导入本文件即可激活所有 builder 注册。
 */

import './builders'

export { SaveOrchestrator } from './orchestrator'
export { PreValidator } from './preValidator'
export { buildSavePlan, buildIncrementalSavePlan } from './planBuilder'
export { SchemaConflictResolver } from './schemaConflictResolver'
export {
  buildEmbeddedConstraintItem,
  CompositeCannotEmbedError,
} from './embedders/embeddedConstraintBuilder'
export { shouldEmbedInSchema, classifyConstraints } from './embedders/embeddedSelector'
export {
  buildSchemaIdByNodeId,
  normalizeTableId,
  filterPersistentNodes,
  isIncompleteDraftNode,
  looseData,
  buildNodeFile,
} from './utils'
export * from './types'
