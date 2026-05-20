/**
 * @file generationOptions.ts
 * @description AI 配置生成选项的默认值
 *
 * 高级参数（采样范围、校验等）已随 OptionsPanel 移除，
 * 现在只保留默认选项的创建。
 */

import type { AiGenerateV2ConfigOptions } from '@/types/ai'

/** 创建默认生成选项 */
export function createDefaultOptions(): AiGenerateV2ConfigOptions {
  return {
    sample_rows: 50,
    sample_values_per_column: 10,
    max_files: 50,
    max_cell_chars: 200,
    generate_schemas: true,
    generate_constraints: true,
    generate_regex_nodes: true,
    keep_existing: true,
  }
}
