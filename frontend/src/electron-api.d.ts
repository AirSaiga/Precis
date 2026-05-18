/**
 * @fileoverview Electron API 类型声明
 *
 * 功能概述:
 * - 定义 Electron 主进程暴露给渲染进程的 API 类型
 * - 为 TypeScript 提供类型检查支持
 * - 确保前端代码与 Electron API 的正确交互
 *
 * 与 Electron preload 的关系:
 * - 此文件定义的类型对应 preload 脚本中通过 contextBridge 暴露的 API
 * - preload 脚本位于 electron/src/preload.ts，负责实际的 IPC 通信
 * - 前端通过 window.electronAPI 访问这些类型安全的方法
 *
 * 最后更新: 2025-02-08 - 添加 saveTextFile 和 loadTextFile API
 *
 * 架构设计:
 * - 类型声明文件 (.d.ts): 编译时类型检查，不生成 JS 代码
 * - Window 接口扩展: 将 electronAPI 添加到全局 Window 对象
 *
 * 使用说明:
 * - 此文件通过 main.ts 导入，确保在应用初始化时加载
 * - TypeScript 编译器会自动识别此声明
 * - 前端代码可以直接使用 window.electronAPI
 *
 * 使用示例:
 * ```typescript
 * // 检查运行环境
 * if (window.electronAPI) {
 *   // 调用 API
 *   const status = await window.electronAPI.getServerStatus();
 *   console.log(status.pythonReady);
 * }
 * ```
 */

/**
 * 自动更新状态类型
 *
 * 状态流转:
 * - idle: 初始状态，等待检查
 * - checking: 正在检查更新
 * - update-available: 发现新版本可用
 * - update-not-available: 当前已是最新版本
 * - downloading: 正在下载更新
 * - downloaded: 更新下载完成，可安装
 * - error: 更新过程中发生错误
 */
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/**
 * 自动更新状态对象
 *
 * 业务用途:
 * - 实时跟踪更新进度
 * - 在 UI 中显示更新状态和进度条
 * - 错误时显示错误信息
 */
interface UpdateState {
  /** 当前更新状态 */
  status: UpdateStatus

  /** 新版本号（仅在发现更新时可用） */
  version?: string

  /** 版本发布日期 */
  releaseDate?: string

  /** 版本发布说明 */
  releaseNotes?: string

  /** 下载进度百分比（0-100） */
  progress?: number

  /** 下载速度（字节/秒） */
  bytesPerSecond?: number

  /** 已传输字节数 */
  transferred?: number

  /** 总字节数 */
  total?: number

  /** 错误信息（仅在 status 为 error 时有效） */
  error?: string
}

/**
 * 自动更新配置
 *
 * 业务用途:
 * - 配置更新检查来源（本地、GitHub、自定义服务器）
 * - 控制自动检查和自动下载行为
 */
interface UpdateConfig {
  /**
   * 更新源类型
   * - local: 本地文件更新
   * - github: 从 GitHub Releases 检查更新
   * - custom: 自定义更新服务器
   */
  sourceType: 'local' | 'github' | 'custom'

  /** 自定义更新源 URL（当 sourceType 为 custom 时使用） */
  sourceUrl?: string

  /** 是否自动检查更新（启动时） */
  autoCheck: boolean

  /** 是否自动下载更新（发现新版本时） */
  autoDownload: boolean
}

/**
 * 更新配置输入类型
 *
 * 用途:
 * - 允许部分更新配置，未提供的字段保持原值
 */
type UpdateConfigInput = Partial<UpdateConfig>

/**
 * Electron API 接口定义
 *
 * 包含主进程暴露给渲染进程的所有方法
 *
 * 设计原则:
 * - 最小权限: 只暴露必要的功能
 * - 类型安全: 参数和返回值都有明确的类型定义
 * - 异步优先: 所有方法返回 Promise，支持 async/await
 *
 * IPC 通信说明:
 * - 所有方法底层通过 Electron IPC (ipcRenderer/ipcMain) 实现
 * - 调用为异步非阻塞，不冻结 UI
 * - 主进程处理完成后通过 Promise 返回结果
 */
interface ElectronAPI {
  /**
   * 获取后端服务器状态
   *
   * 业务用途:
   * - 检查 Python 后端是否已就绪
   * - 获取服务器监听的端口号
   *
   * 使用场景:
   * - 应用启动时轮询检查后端状态
   * - 后端重启后重新获取端口
   *
   * @returns Promise<ServerStatus> - 服务器状态对象
   */
  getServerStatus: () => Promise<{
    /**
     * Python 后端是否已完成启动
     * true: 后端就绪，可以发起 API 请求
     * false: 后端仍在启动中或发生错误
     */
    pythonReady: boolean

    /**
     * 服务器监听的端口号
     * 通常为 8000
     */
    port: number
  }>

  /**
   * 重启 Python 后端服务器
   *
   * 业务用途:
   * - 当后端发生错误时，恢复服务
   * - 实现"软重启"功能，无需关闭整个应用
   *
   * 注意事项:
   * - 重启过程中 pythonReady 会变为 false
   * - 重启后端口可能变化，需要重新获取服务器状态
   * - 重启可能需要几秒钟时间
   *
   * @returns Promise<{ ready: boolean; port: number }> - 重启结果和新的端口号
   */
  restartPythonServer: () => Promise<{ ready: boolean; port: number }>

  /**
   * 获取应用版本号
   *
   * 业务用途:
   * - 在"关于"对话框中显示版本
   * - 版本比对，检查更新
   * - 版本相关的功能开关判断
   *
   * @returns Promise<string> - 版本号，如 "1.0.0"
   */
  getAppVersion: () => Promise<string>

  /**
   * 获取当前操作系统平台
   *
   * 业务用途:
   * - 前端根据平台显示不同 UI
   * - 平台特定的逻辑判断
   *
   * Electron process.platform 返回值:
   * - 'win32': Windows 系统
   * - 'darwin': macOS 系统
   * - 'linux': Linux 系统
   *
   * 设计说明:
   * - 作为属性而非方法，直接访问更便捷
   * - 值在进程启动时确定，不会变化
   */
  platform: string

  /**
   * 获取 Electron 应用的用户数据目录路径
   *
   * 业务用途:
   * - 存储用户的工作区配置
   * - 缓存应用运行状态
   * - 保存临时文件
   * - 存储用户偏好设置
   *
   * Electron app.getPath('userData') 返回值:
   * - Windows: %APPDATA%/Precis
   * - macOS: ~/Library/Application Support/Precis
   * - Linux: ~/.config/Precis
   *
   * 设计说明:
   * - 通过 IPC 主进程调用，避免渲染进程直接导入 electron
   * - 前端无需关心不同平台的路径差异
   * - 该目录在应用卸载时通常会被保留
   *
   * @returns Promise<string> - 用户数据目录的绝对路径
   */
  getUserDataPath: () => Promise<string>

  /**
   * 获取默认项目路径
   *
   * 业务用途:
   * - 获取系统文档目录下的默认项目文件夹路径
   * - 为新用户推荐初始项目存储位置
   *
   * 返回路径:
   * - Windows: %USERPROFILE%/Documents/PrecisProjects
   * - macOS: ~/Documents/PrecisProjects
   * - Linux: ~/Documents/PrecisProjects
   *
   * @returns Promise<string> - 默认项目目录的绝对路径
   */
  getDefaultProjectPath: () => Promise<string>

  /**
   * 确保目录存在，不存在则创建
   *
   * 业务用途:
   * - 保存文件前自动创建父目录
   * - 初始化项目结构
   * - 递归创建多级目录
   *
   * 注意事项:
   * - 递归创建所有不存在的父目录
   * - 目录已存在时返回 true
   * - 权限不足时返回 false
   *
   * @param dirPath - 要创建的目录绝对路径
   * @returns Promise<boolean> - 创建是否成功（或已存在）
   */
  ensureDir: (dirPath: string) => Promise<boolean>

  /**
   * 打开文件选择对话框
   *
   * 业务用途:
   * - 在 Electron 环境中让用户选择本地文件
   * - 支持多选和文件类型过滤
   *
   * Electron dialog.showOpenDialog 选项:
   * - title: 对话框标题
   * - buttonLabel: 确认按钮标签
   * - filters: 文件类型过滤器（name: 显示名称, extensions: 扩展名数组）
   * - properties: 对话框属性（'openFile': 打开文件, 'multiSelections': 多选, 'openDirectory': 打开目录）
   *
   * 使用示例:
   * ```typescript
   * const result = await window.electronAPI.showOpenDialog({
   *   title: '选择数据文件',
   *   filters: [{ name: 'Excel文件', extensions: ['xlsx', 'xls'] }],
   *   properties: ['openFile']
   * });
   * ```
   *
   * @param options - 对话框配置选项
   * @returns Promise<OpenDialogResponse> - 用户选择的文件路径和取消状态
   *   - canceled: 用户是否取消对话框
   *   - filePaths: 用户选择的文件路径数组
   */
  showOpenDialog: (options: {
    title?: string
    buttonLabel?: string
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: string[]
  }) => Promise<{
    canceled: boolean
    filePaths?: string[]
  }>

  /**
   * 检查文件是否存在
   *
   * 业务用途:
   * - 验证用户输入的文件路径是否有效
   * - 加载配置前检查文件是否存在
   * - 防止对已删除文件进行操作
   *
   * @param filePath - 要检查的文件绝对路径
   * @returns Promise<boolean> - 文件是否存在且可读
   */
  checkFileExists: (filePath: string) => Promise<boolean>

  /**
   * 重新选择文件对话框
   *
   * 业务用途:
   * - 当原文件丢失或需要更换时，让用户重新选择
   * - 保持与原文件相同的过滤器配置
   * - 用于文件引用失效后的恢复流程
   *
   * 行为说明:
   * - 与 showOpenDialog 功能相同，但语义上表示"重新选择"
   * - 前端可以显示更友好的提示文案
   *
   * @param options - 对话框配置选项
   * @returns Promise<OpenDialogResponse> - 用户选择的文件路径和取消状态
   */
  reselectFile: (options: {
    title?: string
    buttonLabel?: string
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: string[]
  }) => Promise<{
    canceled: boolean
    filePaths?: string[]
  }>

  /**
   * 使用系统默认程序打开文件
   *
   * 业务用途:
   * - 打开数据文件进行预览
   * - 打开日志文件查看详情
   * - 打开生成的报告文件
   *
   * 行为说明:
   * - 调用操作系统默认的文件打开方式
   * - 对于 .xlsx 文件会打开 Excel
   * - 对于 .csv 文件可能打开 Excel 或文本编辑器
   *
   * @param filePath - 要打开的文件的绝对路径
   * @returns Promise<{ success: boolean; error?: string }> - 打开结果
   */
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>

  /**
   * 保存项目配置到配置文件
   *
   * 业务用途:
   * - 保存工程路径和数据源路径到 electron_launch.yaml
   * - 记录用户最后使用的项目，下次启动自动加载
   *
   * 存储位置:
   * - 用户数据目录下的 electron_launch.yaml 文件
   *
   * @param configPath - 工程配置文件目录路径
   * @param dataPath - 数据源目录路径
   * @returns Promise<boolean> - 保存是否成功
   */
  saveConfig: (configPath: string, dataPath: string) => Promise<boolean>

  /**
   * 加载项目配置
   *
   * 业务用途:
   * - 从 electron_launch.yaml 读取工程路径和数据源路径
   * - 应用启动时恢复上次使用的项目
   *
   * 返回值:
   * - configPath: 配置文件路径
   * - dataPath: 数据源目录路径
   *
   * @returns Promise<{ configPath: string; dataPath: string }> - 配置对象
   */
  loadConfig: () => Promise<{ configPath: string; dataPath: string }>

  /**
   * 获取当前工作目录
   *
   * 业务用途:
   * - 确定项目根目录
   * - 构建配置文件绝对路径
   * - 解析相对路径的基准
   *
   * 注意:
   * - Electron 中通常是应用安装目录或资源目录
   * - 开发模式下是项目根目录
   *
   * @returns Promise<string> - 当前工作目录的绝对路径
   */
  getCwd: () => Promise<string>

  /**
   * 递归扫描目录下的所有文件
   *
   * 业务用途:
   * - 允许用户选择一个目录
   * - 递归扫描该目录下的所有文件
   * - 只返回符合扩展名的文件
   *
   * 使用场景:
   * - 批量导入数据文件时，用户选择数据源目录
   * - 自动找出目录下所有的数据文件（.csv, .xlsx, .xls）
   * - 构建项目文件树
   *
   * 性能说明:
   * - 对于大目录可能需要几秒钟
   * - 建议在 UI 中显示扫描进度或加载状态
   *
   * @param dirPath - 要扫描的目录绝对路径
   * @param allowedExtensions - 可选的允许扩展名数组，默认 ['.csv', '.xlsx', '.xls']
   * @returns Promise<string[]> - 符合条件的文件路径数组
   */
  scanDirectory: (dirPath: string, allowedExtensions?: string[]) => Promise<string[]>

  /**
   * 读取任意路径的文本文件
   *
   * 业务用途:
   * - 读取工作区配置文件
   * - 读取项目清单文件 (project.precis.yaml)
   * - 读取 Schema 配置文件
   *
   * 编码说明:
   * - 默认使用 UTF-8 编码
   * - 对于非文本文件可能返回乱码
   *
   * @param filePath - 文件的绝对路径
   * @returns Promise<string | null> - 文件内容，失败或文件不存在返回 null
   */
  readFile: (filePath: string) => Promise<string | null>

  /**
   * 写入文本文件到指定路径
   *
   * 业务用途:
   * - 保存工作区配置
   * - 保存项目清单文件
   * - 保存生成的报告文件
   * - 自动创建父目录
   *
   * 注意事项:
   * - 如果父目录不存在会自动创建
   * - 会覆盖已存在的文件
   * - 使用 UTF-8 编码
   *
   * @param filePath - 文件的绝对路径
   * @param content - 文件内容
   * @returns Promise<boolean> - 写入是否成功
   */
  writeFile: (filePath: string, content: string) => Promise<boolean>

  /**
   * 自动更新相关 API
   *
   * 功能说明:
   * - 检查应用更新
   * - 下载新版本
   * - 安装更新
   * - 管理更新配置
   *
   * 使用流程:
   * 1. 调用 check() 检查是否有更新
   * 2. 如果有更新，调用 download() 下载
   * 3. 下载完成后，调用 install() 安装（会重启应用）
   */
  update: {
    /**
     * 获取当前更新状态
     *
     * 用途:
     * - 应用启动时获取上次更新状态
     * - 检查是否有已下载但未安装的更新
     *
     * @returns Promise<UpdateState> - 当前更新状态对象
     */
    getStatus: () => Promise<UpdateState>

    /**
     * 获取更新配置
     *
     * 用途:
     * - 在设置页面显示当前更新配置
     * - 确定是否启用了自动检查/自动下载
     *
     * @returns Promise<UpdateConfig> - 更新配置对象
     */
    getConfig: () => Promise<UpdateConfig>

    /**
     * 保存更新配置
     *
     * 用途:
     * - 用户修改自动更新设置后保存
     * - 支持部分更新，未提供的字段保持原值
     *
     * @param config - 部分更新配置对象
     * @returns Promise<boolean> - 保存是否成功
     */
    saveConfig: (config: UpdateConfigInput) => Promise<boolean>

    /**
     * 手动检查更新
     *
     * 用途:
     * - 用户点击"检查更新"按钮时调用
     * - 应用启动时自动检查（如果配置了 autoCheck）
     *
     * 行为说明:
     * - 异步操作，可能需要几秒钟
     * - 检查完成后会更新状态
     * - 可以通过 getStatus() 轮询获取结果
     *
     * @returns Promise<UpdateState> - 检查后的状态
     */
    check: () => Promise<UpdateState>

    /**
     * 下载更新
     *
     * 用途:
     * - 用户确认下载新版本后调用
     * - 配置了 autoDownload 时自动调用
     *
     * 行为说明:
     * - 开始下载后状态变为 'downloading'
     * - 下载过程中可以通过 getStatus() 获取进度
     * - 下载完成后状态变为 'downloaded'
     *
     * @returns Promise<{ success: boolean; error?: string }> - 下载结果
     */
    download: () => Promise<{ success: boolean; error?: string }>

    /**
     * 安装更新
     *
     * 用途:
     * - 用户确认安装更新后调用
     * - 通常在下载完成后提示用户安装
     *
     * 警告:
     * - 调用后会立即退出应用并安装更新
     * - 安装完成后会自动重启应用
     * - 确保用户已保存所有工作再调用
     *
     * @returns Promise<{ success: boolean; error?: string }> - 安装结果
     */
    install: () => Promise<{ success: boolean; error?: string }>
  }
}

/**
 * Window 接口扩展
 *
 * 功能:
 * - 将 electronAPI 属性添加到全局 Window 对象
 * - 解决 TypeScript 类型检查问题
 *
 * 为什么需要此声明:
 * - 默认情况下，Window 对象没有 electronAPI 属性
 * - TypeScript 会报错："Property 'electronAPI' does not exist"
 * - 此声明告诉 TypeScript 该属性存在且类型为 ElectronAPI
 *
 * 潜在问题:
 * - 在非 Electron 环境中（如浏览器），此属性不存在
 * - 使用前应进行运行时检查
 *
 * 最佳实践:
 * - 始终先检查是否存在再使用
 * - 对于共享代码，提供 fallback 实现
 */
interface Window {
  /**
   * Electron 主进程暴露的 API 对象
   *
   * 可用性:
   * - Electron 应用: 始终可用（通过 preload 脚本注入）
   * - 浏览器环境: 不存在
   *
   * 使用建议:
   * ```typescript
   * if (typeof window.electronAPI !== 'undefined') {
   *   // 安全使用
   *   const version = await window.electronAPI.getAppVersion();
   * } else {
   *   // 浏览器环境的 fallback 处理
   *   console.warn('不在 Electron 环境中');
   * }
   * ```
   *
   * 安全说明:
   * - 所有 API 都经过 contextBridge 封装，限制权限
   * - 渲染进程无法直接访问 Node.js 或 Electron 内部 API
   * - 只能通过暴露的接口与主进程通信
   */
  electronAPI: ElectronAPI
}
