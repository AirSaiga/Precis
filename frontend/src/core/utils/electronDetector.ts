/**
 * @file electronDetector.ts
 * @description Electron 环境检测工具
 *
 * 功能概述：
 * - 检测当前是否运行在 Electron 环境中
 * - 提供 Electron IPC API 的统一访问封装
 * - 封装文件对话框、文件系统检查等原生功能
 * - 获取后端服务状态、端口、应用版本等信息
 */

export interface FileFilter {
  name: string
  extensions: string[]
}

/**
 * 获取 Electron API 实例
 *
 * 【使用警告】
 * - 在 Electron 环境中始终可用
 * - 在浏览器环境中调用此函数会抛出错误
 *
 * 【典型用法】
 * ```typescript
 * const api = getElectronAPI();
 * // 安全使用 api 的方法
 * ```
 *
 * 【类型说明】
 * - 使用类型导入从 @core/types/electron 获取 ElectronAPI 类型定义
 * - 包含文件操作、对话框、后端状态监听等原生能力
 *
 * @returns ElectronAPI 实例
 * @throws 如果不在 Electron 环境中，抛出错误提示用户使用桌面版
 */
export function getElectronAPI(): ElectronAPI {
  const api = window.electronAPI
  if (!api) {
    throw new Error('Electron API 不可用。请确保应用运行在 Electron 环境中。')
  }
  return api
}

/**
 * 检测当前是否运行在 Electron 桌面环境中
 *
 * 【实现原理】
 * 通过检查 window 对象上是否存在 electronAPI 属性来判断
 * 在浏览器环境中该属性不存在，返回 false
 *
 * 【使用场景】
 * - 根据运行环境选择不同的文件处理策略
 * - 条件渲染需要 Electron 特有的 UI 组件
 * - 在 Precis 中应始终返回 true
 *
 * @returns true 表示在 Electron 桌面环境中，false 表示在普通浏览器中
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI
}

/**
 * 确保当前在 Electron 环境中运行
 *
 * 【功能说明】
 * 如果不是 Electron 环境，抛出详细的错误信息指导用户如何启动桌面版
 *
 * 【使用场景】
 * - 调用 Electron 原生功能前进行环境校验
 * - 防止在浏览器环境中调用不存在的 API 导致异常
 *
 * 【错误提示内容】
 * - 说明此功能仅支持 Electron 桌面版
 * - 提供开发模式和生产模式的启动命令
 *
 * @throws 如果不在 Electron 环境中，抛出错误
 */
export function ensureElectron(): void {
  if (!isElectron()) {
    throw new Error(
      '此功能仅支持 Electron 桌面版。\n' +
        '请使用以下命令启动桌面版：\n' +
        '  npm run electron:dev    # 开发模式\n' +
        '  npm run electron:build  # 构建生产版'
    )
  }
}

// ============================================================
// Electron 原生功能封装
// ============================================================

/**
 * 检查本地文件是否存在
 *
 * 【用途】
 * 验证数据源列表中的文件路径是否有效，用于在 UI 中标记无效路径
 *
 * 【调用链】
 * 渲染进程 -> IPC 桥接 -> 主进程 fs.existsSync 检查
 *
 * 【使用场景】
 * - 加载项目时验证数据源文件是否存在
 * - 用户选择文件后确认路径有效性
 *
 * @param filePath - 要检查的文件绝对路径
 * @returns true 表示文件存在，false 表示文件不存在
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  ensureElectron()
  return window.electronAPI!.checkFileExists(filePath)
}

/**
 * 显示打开文件对话框
 *
 * 【用途】
 * 让用户通过系统原生对话框选择本地数据文件
 *
 * 【功能特性】
 * - 支持自定义对话框标题、默认路径、按钮标签
 * - 支持文件类型过滤（如仅显示 Excel 文件）
 * - 支持多选属性配置
 *
 * 【调用链】
 * 渲染进程 -> IPC 桥接 -> 主进程 dialog.showOpenDialog
 *
 * 【使用场景】
 * - 用户添加数据源时选择文件
 * - 导入配置文件
 *
 * @param options - 对话框配置选项
 * @param options.title - 对话框标题
 * @param options.defaultPath - 默认打开路径
 * @param options.buttonLabel - 确认按钮自定义标签
 * @param options.filters - 文件类型过滤器数组
 * @param options.properties - 对话框属性（如 'multiSelections', 'openFile'）
 * @returns 包含 canceled（是否取消）和 filePaths（选中路径数组）的对象
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function showOpenDialog(
  options: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: FileFilter[]
    properties?: string[]
  } = {}
): Promise<{ canceled: boolean; filePaths: string[] }> {
  ensureElectron()
  const result = await window.electronAPI!.showOpenDialog(options)
  return {
    canceled: result.canceled,
    filePaths: result.filePaths || [],
  }
}

/**
 * 扫描目录获取文件列表
 *
 * 【用途】
 * 批量导入时递归扫描数据源目录，获取所有符合条件的文件
 *
 * 【功能特性】
 * - 递归遍历指定目录及其子目录
 * - 支持按文件扩展名过滤
 * - 返回相对路径列表（相对于扫描目录）
 *
 * 【调用链】
 * 渲染进程 -> IPC 桥接 -> 主进程 fs.readdir 递归遍历
 *
 * 【使用场景】
 * - 批量添加数据源时扫描整个文件夹
 * - 自动发现数据文件
 *
 * @param dirPath - 要扫描的目录绝对路径
 * @param allowedExtensions - 允许的文件扩展名数组（如 ['.csv', '.xlsx']），不传则不过滤
 * @returns 符合条件的文件路径数组（相对路径）
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function scanDirectory(
  dirPath: string,
  allowedExtensions?: string[]
): Promise<string[]> {
  ensureElectron()
  return window.electronAPI!.scanDirectory(dirPath, allowedExtensions)
}

/**
 * 使用系统默认程序打开文件
 *
 * 【用途】
 * 用 Excel 等系统关联程序打开数据文件，方便用户查看或编辑
 *
 * 【调用链】
 * 渲染进程 -> IPC 桥接 -> 主进程 shell.openPath
 *
 * 【使用场景】
 * - 用户在数据源列表中点击"打开文件"
 * - 预览数据文件内容
 *
 * 【返回值说明】
 * - success: true 表示成功打开，false 表示打开失败
 * - error: 打开失败时的错误信息
 *
 * @param filePath - 要打开的文件绝对路径
 * @returns 包含 success 状态和可选 error 信息的对象
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function openFile(filePath: string): Promise<{ success: boolean; error?: string }> {
  ensureElectron()
  return window.electronAPI!.openFile(filePath)
}

/**
 * 获取后端 Python 服务器的运行状态
 *
 * 【调用链】
 * 渲染进程 -> preload.ts IPC 桥接 -> main.ts 进程管理 -> Python 子进程
 *
 * 【返回值数据流】
 * - pythonReady: 表示 Python 服务是否已启动完成
 * - port: Python 服务监听的端口号（默认 8000）
 *
 * 【使用场景】
 * - 前端初始化时确认后端服务是否就绪
 * - 健康检查
 *
 * @returns 服务器状态信息，包含 ready 状态和端口号
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function getServerStatus(): Promise<{ pythonReady: boolean; port: number }> {
  ensureElectron()
  return window.electronAPI!.getServerStatus()
}

/**
 * 获取后端服务端口
 *
 * 【用途】
 * 前端知道后端 API 的地址，用于构建 HTTP 请求 URL
 *
 * 【实现方式】
 * 调用 getServerStatus() 获取完整状态后提取端口号
 *
 * 【使用场景】
 * - 构建后端 API 请求地址（如 http://localhost:{port}/api/...）
 * - 确认服务端口配置
 *
 * @returns Python 后端服务监听的端口号
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function getBackendPort(): Promise<number> {
  ensureElectron()
  return window.electronAPI!.getServerStatus().then((s) => s.port)
}

/**
 * 重启 Python 后端服务器
 *
 * 【副作用说明】
 * - 会终止当前的 Python 子进程
 * - 重新 spawn 新的 Python 进程
 * - 可能导致正在进行的 API 请求失败
 *
 * 【使用场景】
 * - Python 服务发生异常需要恢复时
 * - 用户手动触发服务重启
 *
 * 【返回值含义】
 * - true: 重启命令已成功发送
 * - false: 重启命令发送失败
 *
 * @returns 是否重启成功
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function restartPythonServer(): Promise<boolean> {
  ensureElectron()
  const result = await window.electronAPI!.restartPythonServer()
  return result.ready
}

/**
 * 获取当前应用的版本号
 *
 * 【数据来源】
 * - Electron 环境：从 main.ts 的 app.getVersion() 获取
 * - 读取自 package.json 的 version 字段
 *
 * 【使用场景】
 * - 显示关于对话框
 * - 检查更新时比较版本号
 * - 在界面上展示应用版本信息
 *
 * @returns 版本号字符串（如 "1.0.0"）
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function getAppVersion(): Promise<string> {
  ensureElectron()
  return window.electronAPI!.getAppVersion()
}

/**
 * 获取当前运行的操作系统平台
 *
 * 【数据来源】
 * - Electron 环境：从主进程传递的 platform 属性获取（process.platform）
 *
 * 【返回值说明】
 * - 'win32': Windows 系统
 * - 'darwin': macOS 系统
 * - 'linux': Linux 系统
 *
 * 【使用场景】
 * - 根据平台显示不同的 UI 元素或快捷键提示
 * - 处理平台特定的文件路径格式
 *
 * @returns 平台标识符字符串
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export function getPlatform(): string {
  ensureElectron()
  return window.electronAPI!.platform
}

/**
 * 获取 Electron 应用的用户数据目录路径
 *
 * 【目录用途】
 * - 存储用户的工作区配置
 * - 缓存应用运行状态
 * - 保存临时文件
 *
 * 【平台差异】
 * - Windows: %APPDATA%/Precis
 * - macOS: ~/Library/Application Support/Precis
 * - Linux: ~/.config/Precis
 *
 * 【实现方式】
 * - 通过 IPC 调用主进程的 getUserDataPath 方法
 * - 避免在渲染进程中直接导入 electron 模块
 *
 * @returns 用户数据目录路径
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function getUserDataPath(): Promise<string> {
  ensureElectron()
  return window.electronAPI!.getUserDataPath()
}

/**
 * 获取当前工作目录
 *
 * 【用途】
 * 获取 Electron 主进程的当前工作目录，用于解析相对路径
 *
 * 【使用场景】
 * - 将用户输入的相对路径转换为绝对路径
 * - 调试路径相关问题
 *
 * @returns 当前工作目录的绝对路径
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function getCwd(): Promise<string> {
  ensureElectron()
  return window.electronAPI!.getCwd()
}

/**
 * 读取本地文件内容
 *
 * 【用途】
 * 安全地读取本地文件内容，支持文本和二进制文件
 *
 * 【使用场景】
 * - 读取配置文件
 * - 加载本地资源
 *
 * 【安全说明】
 * - 受主进程权限控制，不能访问任意路径
 * - 通常限于用户数据目录或用户明确选择的文件
 *
 * @param filePath - 要读取的文件绝对路径
 * @returns 文件内容（字符串格式）
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function readFile(filePath: string): Promise<string> {
  ensureElectron()
  return window.electronAPI!.readFile(filePath)
}

/**
 * 写入本地文件
 *
 * 【用途】
 * 安全地将内容写入本地文件
 *
 * 【使用场景】
 * - 保存配置文件
 * - 导出数据到本地文件
 *
 * 【安全说明】
 * - 受主进程权限控制，通常只能写入用户数据目录
 * - 避免覆盖系统关键文件
 *
 * @param filePath - 要写入的文件绝对路径
 * @param content - 要写入的文件内容
 * @returns 写入成功返回 true
 * @throws 如果不在 Electron 环境中，调用 ensureElectron() 抛出错误
 */
export async function writeFile(filePath: string, content: string): Promise<boolean> {
  ensureElectron()
  return window.electronAPI!.writeFile(filePath, content)
}
