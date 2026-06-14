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
