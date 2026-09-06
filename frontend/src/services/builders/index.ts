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
 * @description V2 文件构建器导出入口
 *
 * 统一导出所有 V2 项目文件构建器，便于外部模块按需导入。
 *
 * @module builders
 */

export { buildV2Manifest, sanitizeV2Id } from './manifestBuilder'

export {
  buildV2Manifest as buildV2ManifestFromNodes,
  buildV2SchemaFile,
  buildV2ConstraintFile,
  buildV2RegexNodeFile,
  buildV2TransformFile,
  buildV2FullConfig,
  buildV2ProjectView,
} from './v2ProjectBuilder'

export { toBackendType, fromBackendType, fromJsonBackendType } from './schemaBuilder'

export { buildV2ConstraintFile as buildV2ConstraintFileFromType } from './constraintBuilder'

export { buildV2RegexNodeFile as buildV2RegexNodeFileFromType } from '@/features/regex/services/regexBuilder'

export type {
  ProjectManifestV2,
  TableSchemaFileV2,
  ConstraintFileV2,
  RegexNodeFileV2,
} from '@/types/projectV2'
