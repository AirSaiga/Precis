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
 * @file index.ts
 * @description 连接规则服务统一导出入口
 */

export type {
  NodeType,
  SourceEndpoint,
  TargetEndpoint,
  ConnectionRuleConfig,
  ConnectionRule,
  ValidationResult,
  ValidationErrorCode,
  AllowedConnection,
  ConnectionValidationContext,
} from './connectionRuleTypes'

export type { ConstraintNodeType } from '@/services/constraints/types'

export { isConstraintNodeType } from './connectionRuleTypes'

export {
  connectionRules,
  getRuleById,
  getRulesForSourceNodeType,
  getRulesForTargetNodeType,
  isConstraintNodeConnection,
  getConstraintNodeTypes,
} from './connectionRules'
