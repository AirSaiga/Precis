/**
 * @file datasource.ts
 * @description 数据源相关类型定义
 *
 * 该模块定义了数据源管理相关的 TypeScript 类型，包括：
 * 1. 外部数据源 - 管理从外部导入的 Excel、CSV 等数据文件
 * 2. 工作区配置 - 本地化的用户偏好设置
 * 3. 数据预览节点 - 在画布上显示数据源预览的节点数据
 *
 * 功能概述:
 * - ExternalDataSource: 表示一个外部数据文件，包含文件信息和状态
 * - WorkspaceConfig: 工作区的本地配置，不随项目迁移
 * - SourcePreviewNodeData: 数据预览节点的完整数据结构
 *
 * 数据流:
 * 1. 用户导入数据文件 → 创建 ExternalDataSource
 * 2. 在画布上创建 SourcePreviewNode → 显示数据预览
 * 3. SourcePreviewNode 连接到 SchemaNode → 定义表结构
 *
 * 状态说明:
 * - ready: 数据源可用
 * - missing: 数据源文件丢失
 * - loading: 正在加载中
 * - error: 加载出错
 *
 * 使用场景:
 * - 资源库管理数据源列表
 * - 画布上显示数据预览
 * - 数据导入和导出
 *
 * @important IndexedDB 模式已在 2026年3月移除
 * 此前版本中支持两种 sourceMode:
 * - 'indexeddb': 将文件内容存储到 IndexedDB（浏览器环境）
 * - 'localfile': 存储本地文件路径（Electron 环境）
 * 由于项目已全面转向 Electron 桌面应用，indexeddb 模式已被移除，
 * 现在仅支持 'localfile' 模式。
 */

// ========== 数据源管理类型定义 ==========

/**
 * 外部数据源状态枚举
 *
 * 表示数据源文件的当前可用状态，用于 UI 状态显示和错误处理。
 *
 * @values
 * - 'ready': 数据源可用，文件已找到且可正常读取
 * - 'missing': 数据源文件丢失，可能已被删除或移动位置
 * - 'loading': 正在加载中，文件正在读取或解析过程中
 * - 'error': 加载出错，读取或解析过程中发生错误
 */
export type DataSourceStatus = 'ready' | 'missing' | 'loading' | 'error'

/**
 * 数据来源模式枚举
 *
 * 定义数据源文件的存储和读取方式。
 *
 * @values
 * - 'localfile': 本地文件路径模式（当前唯一支持的模式）
 */
export type SourceMode = 'localfile'

/**
 * 外部数据源数据结构
 *
 * 表示一个从外部导入的数据文件，包含文件的基本信息、状态和元数据。
 * 该数据结构用于资源库中管理所有导入的数据源文件。
 *
 * 使用场景:
 * - 资源库面板中显示和管理数据源列表
 * - 创建数据预览节点时引用数据源信息
 * - 保存和加载项目时恢复数据源引用
 *
 * @interface ExternalDataSource
 */
export interface ExternalDataSource {
  /** 数据源唯一标识符（UUID 格式） */
  id: string

  /** 数据源显示名称，通常使用文件名（不含扩展名） */
  name: string

  /** 关联的文件 ID，指向文件存储系统中的实际文件 */
  fileId: string

  /** 文件类型：excel、csv 或 json */
  type: 'excel' | 'csv' | 'json'

  /** 数据源当前状态：ready/missing/loading/error */
  status: DataSourceStatus

  /** 用户自定义的别名，用于在项目中更友好地引用该数据源 */
  alias?: string

  /** 最后使用时间戳（ISO 8601 格式），用于排序和清理未使用的数据源 */
  lastUsed?: string

  /** 数据源添加时间戳（ISO 8601 格式） */
  addedAt: string

  /** 文件大小（字节） */
  size?: number

  /** 错误信息，当 status 为 'error' 时显示具体的错误原因 */
  error?: string

  /**
   * 数据来源模式
   *
   * 始终为 'localfile'，表示从本地文件路径读取。
   *
   * @important IndexedDB 模式已移除
   * 2026年3月之前的版本支持 'indexeddb' 模式用于浏览器环境，
   * 现在仅支持 'localfile' 模式，直接读取本地文件系统。
   *
   * @default 'localfile'
   */
  sourceMode?: SourceMode

  /**
   * 本地文件绝对路径
   *
   * 存储文件在本地文件系统中的真实路径，Electron 主进程直接读取该路径。
   * 仅在 sourceMode 为 'localfile' 时使用。
   *
   * @example "D:/Data/users.xlsx"
   */
  localPath?: string

  /**
   * 相对文件夹路径
   *
   * 用于文件夹导入功能，存储文件相对于导入根文件夹的路径。
   * 当用户导入整个文件夹时，该字段标识文件在文件夹结构中的位置。
   *
   * @example "2024/Q1/sales.xlsx" （相对于导入的 "Data" 文件夹）
   * @optional 仅文件夹导入功能使用
   */
  folderPath?: string

  /**
   * 是否为文件夹节点
   *
   * 用于文件夹导入功能，标记该数据源是否为文件夹入口节点。
   * 文件夹节点本身不包含实际数据，仅作为层级结构中的容器。
   *
   * @optional 仅文件夹导入功能使用
   * @default false
   */
  isFolder?: boolean

  /**
   * 子节点数组
   *
   * 用于文件夹导入功能，存储该文件夹下的子数据源或子文件夹。
   * 构建树形结构以支持层级展示和导航。
   *
   * @optional 仅文件夹导入功能使用
   * @type ExternalDataSource[]
   */
  children?: ExternalDataSource[]
}

/**
 * 工作区配置数据结构
 *
 * 存储工作区的本地配置信息，包括最近使用的数据源、别名映射和 UI 偏好设置。
 *
 * @important 本地配置，不随项目迁移
 * 该配置存储在本地存储中（Electron 的 localStorage 或配置文件），
 * 不会包含在项目文件中，因此在不同设备或用户之间打开同一项目时，
 * 工作区配置是独立的。
 *
 * @interface WorkspaceConfig
 */
export interface WorkspaceConfig {
  /**
   * 最近使用的数据源列表
   *
   * 按使用时间倒序排列，用于快速访问常用数据源。
   * 通常限制数量（如最多 20 个）以避免存储过大。
   */
  recent_data_sources: ExternalDataSource[]

  /**
   * 别名映射表
   *
   * key: 数据源 ID
   * value: 用户定义的别名
   *
   * 用于为数据源创建更友好的引用名称，方便在约束和脚本中使用。
   * @example { "ds-uuid-123": "用户表", "ds-uuid-456": "订单表" }
   */
  alias_mappings: Record<string, string>

  /**
   * UI 偏好设置
   *
   * 存储用户的界面状态和个人偏好，提升使用体验。
   */
  ui_preferences: {
    /**
     * 资源库中展开的文件夹状态
     *
     * key: 文件夹节点 ID
     * value: 是否展开
     */
    expanded_folders: Record<string, boolean>

    /** 最后选中的数据源 ID */
    last_selected_data_source?: string

    /**
     * 启动时是否自动加载上次的数据源
     * @default true
     */
    startup_loading_enabled?: boolean
  }

  /** 配置最后更新时间戳（ISO 8601 格式） */
  last_updated: string
}

/**
 * 数据预览节点数据。
 *
 * 表示画布上的数据预览节点，用于展示外部数据源的内容预览。
 * 该节点通常是数据流的第一步，连接到 Schema 节点进行表结构定义。
 *
 * 功能说明:
 * - 显示数据文件的前 N 行预览（默认 10-20 行）
 * - 支持多 Sheet 切换（Excel 文件）
 * - 支持 Regex 节点提取派生列
 * - 作为数据流的起点，输出到 Schema 节点
 *
 * 数据流向:
 * SourcePreviewNode → SchemaNode → ConstraintNodes
 *
 * @interface SourcePreviewNodeData
 */
export interface SourcePreviewNodeData {
  /** 节点唯一标识符（Vue Flow 节点 ID） */
  id: string

  /** 节点显示标签，用于在画布上展示节点名称 */
  label: string

  /** 数据源名称（来自 ExternalDataSource） */
  sourceName: string

  /** 文件名称（含扩展名） */
  fileName: string

  /** 文件扩展名 */
  fileType: string

  /** 数据源类型：excel、csv 或 json */
  sourceType: 'excel' | 'csv' | 'json'

  /**
   * 预览数据内容（二维数组）。
   *
   * 包含表头和前 N 行数据，用于在节点上显示预览。
   * 第一行通常为表头（如果 headerRow >= 0）。
   *
   * @example [["姓名", "年龄"], ["张三", "25"], ["李四", "30"]]
   */
  data: string[][]

  /** 实际数据行数（不含表头） */
  actualRowCount: number

  /** 实际数据列数 */
  actualColCount: number

  /** 显示的行数（预览行数） */
  rowCount: number

  /** 显示的列数（预览列数） */
  colCount: number

  /** 总行数（文件中的实际数据行数） */
  totalRows: number

  /** 总列数（文件中的实际列数） */
  totalCols: number

  /** 预览显示的行数限制 */
  previewRowCount: number

  /** 预览显示的列数限制 */
  previewColCount: number

  /** 文件大小（字节） */
  fileSize: number

  /** 文件最后修改时间戳（Unix 时间戳，毫秒） */
  lastModified: number

  /** 标记是否为预览节点（用于 Vue Flow 节点类型识别） */
  isPreviewNode: boolean

  /** 节点创建时间戳（Unix 时间戳，毫秒） */
  createdAt: number

  /** 输出端口是否已连接 */
  outputPortConnected: boolean

  /**
   * 表头所在行索引（0-based）。
   *
   * -1 表示无表头，0 表示第一行是表头。
   * @default 0
   */
  headerRow?: number

  /**
   * Excel 文件的所有 Sheet 名称列表。
   *
   * 仅 Excel 文件有效，CSV 文件为 undefined 或空数组。
   */
  sheets?: string[]

  /**
   * 当前选中的 Sheet 名称。
   *
   * 仅 Excel 文件有效。
   */
  currentSheet?: string

  /**
   * 数据来源模式。
   *
   * 当前仅支持 'localfile' 模式。
   *
   * @important IndexedDB 模式已移除
   * 2026年3月之前的版本支持 'indexeddb' 模式，
   * 现在仅支持 'localfile' 模式。
   *
   * @default 'localfile'
   */
  sourceMode?: SourceMode

  /**
   * 【Electron 真实文件路径】
   * 本地文件系统的绝对路径，后端直接以此读取文件。
   * 这是 Electron 桌面端的核心路径字段，所有文件操作均以此为依据。
   *
   * @example "D:/Data/users.xlsx"
   */
  localPath: string

  /**
   * 由 Regex 节点"提取模式（extract）"生成的派生列元数据。
   *
   * 当 Regex 节点配置为"提取模式"时，它会从某一列提取内容并生成新的列。
   * 该字段记录这些派生列的元数据，用于：
   * 1. 显示派生列的来源信息
   * 2. 支持同一 Regex 多次提取时先清理旧列再重算，避免重复叠加
   * 3. 追溯派生列的数据来源
   *
   * 数据结构:
   * - key: regexNodeId（生成该派生列的 Regex 节点 ID）
   * - value.columnNames: 实际追加到 data 矩阵表头的列名（可能因冲突被重命名）
   * - value.groupNames: 派生列的"来源键"
   *   - 未配置输出映射时：命名捕获组名
   *   - 配置了输出映射时：输出映射的 key（用户定义的输出字段名）
   *
   * @example
   * {
   *   "regex-node-123": {
   *     columnNames: ["手机号_区号", "手机号_号码"],
   *     groupNames: ["area", "number"]
   *   }
   * }
   *
   * @important 这些派生列只存在于节点数据中，不会回写原始文件内容
   */
  derivedColumnsByRegex?: Record<string, { columnNames: string[]; groupNames: string[] }>

  /**
   * 关联的 Schema 子节点 IDs。
   *
   * 记录该数据源预览节点下游连接的 Schema 节点 ID 列表。
   * 用于布局整理（auto-layout）时快速获取关联节点，无需动态遍历边。
   *
   * @optional 仅用于优化布局计算
   * @type string[]
   */
  children?: string[]
}
