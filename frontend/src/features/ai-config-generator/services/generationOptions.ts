/**
 * @file generationOptions.ts
 * @description AI 配置生成选项的默认值、范围和校验逻辑
 *
 * 该模块为纯函数，不依赖 Vue 或 UI，便于单元测试。
 */

import type { AiGenerateV2ConfigOptions } from '@/types/ai'

/** 采样参数范围定义 */
export interface SamplingParamRange {
  min: number
  max: number
  default: number
}

/** 各采样参数的范围限制 */
export const SAMPLING_PARAM_RANGES: Record<
  'sample_rows' | 'sample_values_per_column' | 'max_files' | 'max_cell_chars',
  SamplingParamRange
> = {
  sample_rows: { min: 10, max: 1000, default: 50 },
  sample_values_per_column: { min: 3, max: 100, default: 10 },
  max_files: { min: 1, max: 200, default: 50 },
  max_cell_chars: { min: 50, max: 2000, default: 200 },
}

/** 创建默认生成选项 */
export function createDefaultOptions(): AiGenerateV2ConfigOptions {
  return {
    sample_rows: SAMPLING_PARAM_RANGES.sample_rows.default,
    sample_values_per_column: SAMPLING_PARAM_RANGES.sample_values_per_column.default,
    max_files: SAMPLING_PARAM_RANGES.max_files.default,
    max_cell_chars: SAMPLING_PARAM_RANGES.max_cell_chars.default,
    generate_schemas: true,
    generate_constraints: true,
    generate_regex_nodes: true,
    keep_existing: true,
  }
}

/**
 * 将数值归一化到指定范围
 * @param value - 输入值
 * @param range - 范围定义
 * @returns 归一化后的值（ clamp 到 [min, max]）
 */
export function clampSamplingParam(value: number, range: SamplingParamRange): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return range.default
  return Math.max(range.min, Math.min(range.max, num))
}

/**
 * 校验并修复生成选项中的采样参数
 * @param options - 部分选项对象
 * @returns 修复后的完整选项
 */
export function normalizeSamplingOptions(
  options: Partial<AiGenerateV2ConfigOptions>
): Pick<
  AiGenerateV2ConfigOptions,
  'sample_rows' | 'sample_values_per_column' | 'max_files' | 'max_cell_chars'
> {
  return {
    sample_rows: clampSamplingParam(
      options.sample_rows ?? SAMPLING_PARAM_RANGES.sample_rows.default,
      SAMPLING_PARAM_RANGES.sample_rows
    ),
    sample_values_per_column: clampSamplingParam(
      options.sample_values_per_column ?? SAMPLING_PARAM_RANGES.sample_values_per_column.default,
      SAMPLING_PARAM_RANGES.sample_values_per_column
    ),
    max_files: clampSamplingParam(
      options.max_files ?? SAMPLING_PARAM_RANGES.max_files.default,
      SAMPLING_PARAM_RANGES.max_files
    ),
    max_cell_chars: clampSamplingParam(
      options.max_cell_chars ?? SAMPLING_PARAM_RANGES.max_cell_chars.default,
      SAMPLING_PARAM_RANGES.max_cell_chars
    ),
  }
}
