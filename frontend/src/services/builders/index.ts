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

export { toBackendType, fromBackendType } from './schemaBuilder'

export {
  buildV2ConstraintFile as buildV2ConstraintFileFromType,
  resolveSchemaAndColumnIdByName as resolveSchemaAndColumnIdByNameFromType,
} from './constraintBuilder'

export { buildV2RegexNodeFile as buildV2RegexNodeFileFromType } from '@/features/regex/services/regexBuilder'

export type {
  ProjectManifestV2,
  TableSchemaFileV2,
  ConstraintFileV2,
  RegexNodeFileV2,
} from '@/types/projectV2'
