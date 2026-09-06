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
 * @fileoverview Transform composable 统一导出入口
 */

export { useTransformSave } from './useTransformSave'
export { useTransformOutputManager } from './useTransformOutputManager'
export { TRANSFORM_TYPE_I18N_KEYS, getParamsDisplay } from './transformDisplay'
export {
  MULTI_COLUMN_TRANSFORMS,
  ROW_CHANGING_TRANSFORMS,
  SINGLE_COLUMN_TRANSFORMS,
  ATOMIC_ROW_CHANGING_TRANSFORMS,
  ROW_CHANGING_TYPE_LABELS,
  hasDedicatedGenerator,
} from './transformTypeRegistry'
export {
  TRANSFORM_CATEGORIES,
  TRANSFORM_SEMANTICS,
  getCategoryForType,
  getCategoryIcon,
  getCategoryId,
  getSemanticForType,
  type TransformCategory,
  type TransformCategoryId,
  type TransformSemantic,
} from './transformCategory'
