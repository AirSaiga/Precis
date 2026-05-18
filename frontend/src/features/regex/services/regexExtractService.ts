/**
 * @file regexExtractService.ts
 * @description 正则表达式"批量校验 + 命名捕获组提取"服务
 *
 * 【业务场景】
 * 该服务是前端正则校验功能的核心网络层，
 * 负责调用后端的 /utils/regex/validate-extract 接口，
 * 实现正则表达式的批量校验和命名捕获组数据提取。
 *
 * 【设计目标】
 * 1. 前端只传入"目标列的值列表（values）"，避免对文件路径/文件内容的依赖
 * 2. 后端返回命名捕获组的列式结果（extracted_columns），前端可将其物化为"派生列"写回节点数据
 * 3. 通过统一的返回结构，确保校验统计与提取结果可以被同一处 UI 消费
 *
 * 【数据流】
 * 前端: RegexNode → values列表 → API请求 → 后端处理 → 响应数据
 * 后端: 匹配校验 → 统计计算 → 命名捕获组提取 → 返回列式结果
 *
 * 【重要约束】
 * - 该服务只负责网络调用与返回结构校验
 * - 不参与任何 IndexedDB 文件存储读写，避免影响原始文件数据
 * - 使用 apiClient 而非 fetch，确保在不同环境下都能正确访问 API
 *
 * 【与后端接口的对应关系】
 * - POST /utils/regex/validate-extract
 *   - 请求参数：RegexValidateExtractRequest
 *   - 响应结构：RegexValidateExtractResponse
 */

export type RegexMatchMode = 'full' | 'partial' | 'extract'

/**
 * 校验/提取请求数据结构
 *
 * 【业务用途】
 * 定义调用正则校验接口时需要传递的参数。
 *
 * 【数据来源】
 * - regex_pattern, regex_flags, caseSensitive, matchMode: 来自 RegexNode.data
 * - values: 来自 SourcePreview 节点的指定列数据
 *
 * 【与 RegexNodeData 的映射】
 * - pattern → regex_pattern
 * - flags → regex_flags
 * - caseSensitive → case_sensitive
 * - matchMode → match_mode
 * - (从 SourcePreview 提取) → values
 */
export interface RegexValidateExtractRequest {
  /**
   * 正则表达式模式字符串
   *
   * 【格式要求】
   * - JavaScript 兼容的正则语法
   * - 建议使用命名捕获组 (?P<name>) 以支持 extract 模式
   *
   * 【示例】
   * - 邮箱验证：^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
   * - 金额提取：(?P<amount>\d+\.?\d*)
   */
  regex_pattern: string

  /**
   * 正则 flags 字符串
   *
   * 【常见标志】
   * - g: 全局匹配
   * - i: 忽略大小写
   * - m: 多行模式
   *
   * 【生成来源】
   * - 由前端模式编辑器 (InteractiveBuilder) 产生
   * - 用户选择启用哪些标志
   *
   * 【默认值】
   * 'g' (全局匹配)
   */
  regex_flags: string

  /**
   * 是否区分大小写
   *
   【后端处理逻辑】
   * - true: 使用正则原样匹配
   * - false: 后端会自动附加 ignorecase 标志
   *
   * 【使用场景】
   * - 用户在正则设计器中切换"区分大小写"选项
   */
  case_sensitive: boolean

  /**
   * 匹配模式
   *
   * 【模式说明】
   * - full: 完整匹配 (必须完全匹配整个字符串)
   * - partial: 子串匹配 (只需部分匹配)
   * - extract: 子串匹配 + 命名捕获组提取
   *
   * 【后端行为差异】
   * - full/partial: 返回 match_count, error_count 统计
   * - extract: 额外返回 extracted_columns (命名捕获组的列式结果)
   */
  match_mode: RegexMatchMode

  /**
   * 目标列的值列表
   *
   * 【数据来源】
   * - 从 SourcePreview 节点提取指定列的所有数据
   * - 每个元素对应一行数据
   *
   * 【示例】
   * ['user@example.com', 'admin@test.org', 'invalid-email']
   *
   * 【处理流程】
   * 1. 获取 SourcePreview.data (二维矩阵)
   * 2. 根据 headerRow 定位列索引
   * 3. 提取 dataStartIndex 之后所有行的该列值
   * 4. 转换为字符串数组
   *
   * 【注意事项】
   * - 空值会被转换为空字符串
   * - 非字符串值会被 String() 转换
   */
  values: string[]
}

/**
 * 校验/提取响应数据
 *
 * 【业务用途】
 * 定义后端返回的校验结果数据结构。
 *
 * 【数据来源】
 * 由后端 /utils/regex/validate-extract 接口返回
 */
export interface RegexValidateExtractData {
  /**
   * 输入行数
   *
   * 【计算逻辑】
   * values 数组的长度
   *
   * 【使用场景】
   * - 显示在节点详情面板
   * - 计算校验通过率
   */
  total_rows: number

  /**
   * 匹配成功的行数
   *
   * 【计算逻辑】
   * - full 模式：完全匹配的字符串数量
   * - partial 模式：包含子串匹配的数量
   * - extract 模式：至少匹配到一个命名捕获组的数量
   */
  match_count: number

  /**
   * 匹配失败的行数
   *
   * 【计算逻辑】
   * total_rows - match_count
   *
   * 【使用场景】
   * - 显示错误数量
   * - 判断校验是否通过 (error_count === 0)
   */
  error_count: number

  /**
   * 命名捕获组名称列表
   *
   * 【数据来源】
   * - 从正则表达式的命名捕获组定义中提取
   * - 顺序来自正则中定义捕获组的顺序
   *
   * 【示例】
   * 正则: (?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})
   * 返回: ['year', 'month', 'day']
   *
   * 【使用场景】
   * - 生成派生列的列名
   * - 验证 extracted_columns 的 key 完整性
   */
  group_names: string[]

  /**
   * 按命名捕获组返回的列式结果
   *
   * 【数据结构】
   * - key: 命名捕获组名称
   * - value: 该组捕获的所有值的数组
   *
   * 【示例】
   * {
   *   'year': ['2024', '2023', '2024'],
   *   'month': ['01', '02', '03'],
   *   'day': ['15', '28', '31']
   * }
   *
   * 【长度一致性】
   * 每个数组的长度都等于 total_rows
   * 未匹配的位置填充空字符串
   *
   * 【使用场景】
   * - extract 模式下生成派生列
   * - 将提取的数据写回 SourcePreview 和 Schema
   */
  extracted_columns: Record<string, string[]>
}

/**
 * API 响应包装结构
 *
 * 【设计考量】
 * 使用统一的响应包装格式，包含 success、data、error 字段，
 * 便于前端统一处理成功和失败两种情况。
 */
export interface RegexValidateExtractResponse {
  /**
   * 请求是否成功
   *
   * 【true 的情况】
   * - 正则编译成功
   * - 校验/提取逻辑正常执行完成
   *
   * 【false 的情况】
   * - 正则表达式语法错误
   * - 后端内部错误
   * - 参数验证失败
   */
  success: boolean

  /**
   * 成功时返回的数据
   *
   【可选性说明】
   * - success 为 true 时必有值
   * - success 为 false 时为 undefined
   */
  data?: RegexValidateExtractData

  /**
   * 失败时的错误消息
   *
   * 【消息来源】
   * - 正则语法错误：正则引擎返回的错误信息
   * - 参数错误：参数验证失败的描述
   * - 内部错误：服务器内部错误的描述
   *
   * 【使用场景】
   * - 显示错误提示给用户
   * - 记录错误日志
   */
  error?: string
}

import apiClient from '@/core/services/httpClient'

/**
 * 调用后端批量正则校验/提取接口
 *
 * 【业务目的】
 * 封装与后端 /utils/regex/validate-extract 接口的调用逻辑，
 * 提供类型安全的请求和响应处理。
 *
 * 【接口行为差异】
 * - match_mode='extract' 时：
 *   后端会返回命名捕获组的 extracted_columns
 *   用于生成派生列
 *
 * - match_mode!='extract' 时：
 *   extracted_columns 可能为空对象
 *   但仍会返回 match_count、error_count 统计
 *
 * 【请求构建流程】
 * 1. 从 RegexNode.data 获取 regex_pattern、flags、matchMode、caseSensitive
 * 2. 从 SourcePreview 节点提取 values 列表
 * 3. 构建 RegexValidateExtractRequest 对象
 * 4. 通过 apiClient.post 发送请求
 *
 * 【错误处理】
 * - 网络错误：抛出异常，消息包含 "Validate request failed"
 * - 业务错误 (success=false)：抛出异常，消息为 error 字段内容
 * - 数据缺失 (无 data)：抛出异常，消息为 "Request failed"
 *
 * 【返回数据使用场景】
 * - 更新 RegexNode.validationStatus
 * - 更新 matchCount、errorCount、totalRows
 * - extract 模式：提取 extracted_columns 生成派生列
 *
 * @param request - 校验/提取请求（仅包含 regex 配置与 values 列表）
 * @returns 后端返回的统计与提取结果
 * @throws 当请求失败时抛出 Error
 */
export async function validateAndExtractRegex(
  request: RegexValidateExtractRequest,
  signal?: AbortSignal
): Promise<RegexValidateExtractData> {
  const response = await apiClient.post<RegexValidateExtractResponse>(
    '/utils/regex/validate-extract',
    request,
    { signal }
  )
  const result = response.data
  if (!result.success || !result.data) throw new Error(result.error || 'Request failed')
  return result.data
}
