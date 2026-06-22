/**
 * @file regexBuilder.ts
 * @description Regex 节点文件构建器
 *
 * 该模块负责将 Regex 节点数据构建为 .regex.yaml 文件格式，
 * 包含正则模式、匹配模式、参数定义、输出映射等。
 *
 * 功能：
 * 1. 构建 Regex 文件头部（版本、ID、名称）
 * 2. 构建正则模式配置（pattern, flags, match_mode）
 * 3. 构建参数定义列表
 * 4. 构建输出映射配置
 */

import type { RegexNodeData } from '@/types/graph'
import type { RegexNodeFileV2 } from '@/types/projectV2'

/**
 * 构建 V2 Regex 文件
 *
 * 将 Regex 节点转换为后端可解析的 YAML 格式
 *
 * @param nodeId - Regex 节点 ID
 * @param data - Regex 节点数据
 * @returns Regex 文件对象
 *
 * @example
 * ```typescript
 * const regexFile = buildV2RegexNodeFile('regex-1', regexNodeData);
 * ```
 */
export function buildV2RegexNodeFile(nodeId: string, data: RegexNodeData): RegexNodeFileV2 {
  return {
    version: 2,
    id: nodeId,
    name: data.configName || 'Unnamed Regex',
    description: data.description || '',
    pattern: data.pattern || '',
    flags: data.flags || '',
    match_mode: data.matchMode || 'full',
    enabled: data.enabled !== false,
    case_sensitive: data.caseSensitive || false,
    source_ref: data.sourceRef
      ? {
          table_id: data.sourceRef.nodeId,
          column_id: data.sourceRef.columnId,
        }
      : undefined,
    parameters: (data.parameters || []).map(
      (param: { name: string; type: string; description?: string }) => ({
        name: param.name,
        type: param.type,
        description: param.description || '',
      })
    ),
    rules: data.rules || [],
  }
}
