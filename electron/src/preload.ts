/**
 * @fileoverview Electron 预加载脚本
 * 
 * 功能概述:
 * - 在渲染进程（前端页面）和主进程之间建立安全的桥梁
 * - 通过 contextBridge API 暴露有限的 API 给前端
 * - 实现进程间通信（IPC）的客户端封装
 * 
 * 架构设计:
 * - 采用 contextBridge 而非 nodeIntegration: 提供更好的安全性
 * - 白名单机制: 只暴露必要的 API，减少攻击面
 * - 同步/异步分离: 属性直接访问，方法调用异步处理
 * 
 * 安全性说明:
 * - [Electron] contextBridge 确保暴露的 API 在独立的上下文中运行
 * - 渲染进程无法直接访问 Node.js API 或主进程
 * - 所有跨进程调用都通过 ipcRenderer 进行，受 CSP 策略限制
 * 
 * 使用示例:
 * ```typescript
 * // 在前端代码中调用
 * const status = await window.electronAPI.getServerStatus();
 * console.log(status.pythonReady); // true 或 false
 * ```
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * 暴露给渲染进程的 API 对象命名空间
 * 
 * 设计决策:
 * - 使用 'electronAPI' 作为命名空间，避免与全局变量冲突
 * - 对象属性分为两类:
 *   1. 属性 (platform): 直接暴露，同步访问
 *   2. 方法 (getServerStatus 等): 异步调用，返回 Promise
 * 
 * [潜在问题]
 * - 如果 ipcRenderer 不可用（如非 Electron 环境），调用会失败
 * - 建议前端在使用前检查 window.electronAPI 是否存在
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 获取后端服务器的运行状态
   * 
   * 业务用途:
   * - 前端初始化时检查后端是否就绪
   * - 在 UI 中显示连接状态
   * 
   * @returns Promise<{ pythonReady: boolean; port: number; frontendPort: number }>
   *   - pythonReady: Python 后端是否已完成启动
   *   - port: 后端服务监听的端口号
   *   - frontendPort: 前端开发服务器端口
   */
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),

  /**
   * 重启 Python 后端服务器
   * 
   * 业务用途:
   * - 当后端发生错误时，提供"软重启"功能
   * - 无需关闭整个应用程序即可恢复服务
   * 
   * [用户影响]
   * - 重启期间前端将无法调用 API
   * - 建议在调用前显示确认对话框
   * - 重启后端口可能变化，需要重新获取服务器状态
   * 
   * @returns Promise<{ ready: boolean; port: number }> - 重启结果和新的端口号
   */
  restartPythonServer: () => ipcRenderer.invoke('restart-python-server'),

  /**
   * 获取应用程序版本号
   * 
   * 业务用途:
   * - 在"关于"对话框中显示版本信息
   * - 用于检查更新时的版本比对
   * 
   * [数据来源]
   * - 版本号来自 electron/package.json 的 version 字段
   * 
   * @returns Promise<string> - 版本号，如 "1.0.0"
   */
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  /**
   * 获取当前操作系统平台
   * 
   * 业务用途:
   * - 前端根据平台显示不同的 UI 或行为
   * - 例如: Windows 的文件路径分隔符为 '\'，其他平台为 '/'
   * 
   * [Electron] process.platform 返回值:
   * - 'win32': Windows
   * - 'darwin': macOS
   * - 'linux': Linux
   * 
   * [设计说明]
   * - 作为属性直接暴露，无需异步调用
   * - 值在进程启动时确定，不会变化
   */
  platform: process.platform,

  /**
   * 获取 Electron 应用的用户数据目录路径
   * 
   * 业务用途:
   * - 存储用户的工作区配置
   * - 缓存应用运行状态
   * - 保存临时文件
   * 
   * [Electron] app.getPath('userData') 返回值:
   * - Windows: %APPDATA%/Precis
   * - macOS: ~/Library/Application Support/Precis
   * - Linux: ~/.config/Precis
   * 
   * [设计说明]
   * - 通过 IPC 主进程调用，避免渲染进程直接导入 electron
   * - 前端无需关心不同平台的路径差异
   * 
   * @returns Promise<string> - 用户数据目录的绝对路径
   */
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  getDefaultProjectPath: () => ipcRenderer.invoke('get-default-project-path'),

  ensureDir: (dirPath: string) => ipcRenderer.invoke('ensure-dir', dirPath),

  /**
   * 打开文件选择对话框
   * 
   * 业务用途:
   * - 在 Electron 环境中让用户选择本地文件
   * - 支持多选和文件类型过滤
   * 
   * [Electron] dialog.showOpenDialog 选项:
   * - title: 对话框标题
   * - buttonLabel: 确认按钮标签
   * - filters: 文件类型过滤器
   * - properties: 对话框属性（openFile, multiSelections 等）
   * 
   * @param options - 对话框配置选项
   * @returns Promise<OpenDialogResponse> - 用户选择的文件路径和取消状态
   */
  showOpenDialog: (options: {
    title?: string;
    buttonLabel?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: string[];
  }) => ipcRenderer.invoke('show-open-dialog', options),

  /**
   * 检查本地文件是否存在
   * 
   * 业务用途:
   * - 验证数据源列表中的本地文件路径是否有效
   * - 在用户重新打开应用时检查文件是否被移动或删除
   * 
   * [安全性说明]
   * - 仅检查文件是否存在，不读取文件内容
   * - 路径验证在主进程完成，避免渲染进程直接访问文件系统
   * 
   * @param filePath 文件绝对路径
   * @returns Promise<boolean> - 文件是否存在
   */
  checkFileExists: (filePath: string) => ipcRenderer.invoke('check-file-exists', filePath),

  /**
    * 重新选择文件对话框
    * 
    * 业务用途:
    * - 当原有的文件路径无效时，让用户重新选择文件
    * - 保留原文件的文件名作为默认选择参考
    * 
    * [使用场景]
    * - 用户移动或删除了原本的数据文件
    * - 文件路径变更需要更新数据源配置
    * 
    * @param options 对话框配置选项
    * @returns Promise<OpenDialogResponse> - 用户选择的文件路径和取消状态
    */
   reselectFile: (options: {
     title?: string;
     buttonLabel?: string;
     filters?: Array<{ name: string; extensions: string[] }>;
     properties?: string[];
   }) => ipcRenderer.invoke('reselect-file', options),

   /**
    * 使用系统默认程序打开文件
    * 
    * 业务用途:
    * - 允许用户通过点击"打开"按钮用 Excel 等默认程序查看数据文件
    * - 自动调用系统关联的程序打开文件
    * 
    * [Electron] shell.openPath() 说明:
    * - Windows: 使用注册的程序关联打开文件
    * - macOS: 使用 Launch Services
    * - Linux: 使用 xdg-open
    * 
    * [错误处理]
    * - 文件不存在会返回错误
    * - 无关联程序也会返回错误
    * 
    * @param filePath 文件绝对路径
    * @returns Promise<{ success: boolean; error?: string }> - 打开结果
    */
   openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),

   /**
    * 保存文本文件到用户数据目录
    * 
    * 业务用途:
    * - 保存项目路径配置等用户设置
    * - 持久化应用状态到本地文件系统
    * 
    * @param fileName 要保存的文件名（不含路径）
    * @param content 文件内容
    * @returns Promise<boolean> - 保存是否成功
    */
   saveTextFile: (fileName: string, content: string) => ipcRenderer.invoke('save-text-file', fileName, content),

   /**
    * 从用户数据目录读取文本文件
    * 
    * 业务用途:
    * - 读取保存的项目路径配置
    * - 恢复应用状态
    * 
    * @param fileName 要读取的文件名（不含路径）
    * @returns Promise<string | null> - 文件内容，文件不存在返回 null
    */
   loadTextFile: (fileName: string) => ipcRenderer.invoke('load-text-file', fileName),

   /**
    * 保存项目配置到配置文件
    * 
    * 业务用途:
    * - 保存工程路径和数据源路径到 .precis/electron_launch.yaml
    * 
    * 配置文件路径:
    * - 新路径: {项目根目录}/.precis/electron_launch.yaml
    * - 兼容路径: {electron目录}/electron_launch.yaml（向后兼容）
    * 
    * @param configPath 工程配置文件目录路径
    * @param dataPath 数据源目录路径
    * @returns Promise<boolean> - 保存是否成功
    */
   saveConfig: (configPath: string, dataPath: string) => ipcRenderer.invoke('save-config', configPath, dataPath),

   /**
    * 加载项目配置
    * 
    * 业务用途:
    * - 从 .precis/electron_launch.yaml 读取工程路径和数据源路径
    * 
    * 配置文件查找顺序:
    * 1. {项目根目录}/.precis/electron_launch.yaml（优先）
    * 2. {electron目录}/electron_launch.yaml（兼容）
    * 3. {electron目录}/precis.config.yaml（废弃，兼容）
    * 
    * @returns Promise<{ configPath: string; dataPath: string }>
    */
   loadConfig: () => ipcRenderer.invoke('load-config'),

   /**
    * 递归扫描目录下的所有文件
    * 
    * 业务用途:
    * - 允许用户选择一个目录
    * - 递归扫描该目录下的所有文件
    * - 只返回符合扩展名的文件
    * 
    * [使用场景]
    * - 批量导入数据文件时，用户选择数据源目录
    * - 自动找出目录下所有的数据文件（.csv, .xlsx, .xls）
    * 
    * @param dirPath 要扫描的目录绝对路径
    * @param allowedExtensions 可选的允许扩展名数组，默认 ['.csv', '.xlsx', '.xls']
    * @returns Promise<string[]> - 符合条件的文件路径数组
    */
   scanDirectory: (dirPath: string, allowedExtensions?: string[]) => 
     ipcRenderer.invoke('scan-directory', { dirPath, allowedExtensions }),

   /**
    * 获取当前工作目录
    * 
    * 业务用途:
    * - 确定项目根目录
    * - 构建配置文件绝对路径
    * 
    * @returns Promise<string> - 当前工作目录的绝对路径
    */
   getCwd: () => ipcRenderer.invoke('get-cwd'),

   /**
    * 读取任意路径的文本文件
    * 
    * 业务用途:
    * - 读取工作区配置文件
    * - 读取项目清单文件
    * 
    * @param filePath 文件的绝对路径
    * @returns Promise<string | null> - 文件内容，失败返回 null
    */
   readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),

   /**
    * 写入文本文件到指定路径
    * 
    * 业务用途:
    * - 保存工作区配置
    * - 保存项目清单文件
    * - 自动创建父目录
    * 
    * @param filePath 文件的绝对路径
    * @param content 文件内容
    * @returns Promise<boolean> - 写入是否成功
    */
   writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),

  /**
   * 读取主进程日志文件尾部内容
   *
   * 业务用途:
   * - 在应用内展示日志面板，便于用户/排障查看
   * - 配合启动失败错误对话框中的日志路径，提供应用内查看能力
   *
   * @returns Promise<string> - 日志尾部文本（最多约 256KB），文件不存在时为空串
   */
  readLogs: () => ipcRenderer.invoke('logs:read'),

  /**
   * 获取日志文件的绝对路径
   *
   * @returns Promise<string> - 日志文件路径，userData 未就绪时为空串
   */
  getLogFilePath: () => ipcRenderer.invoke('logs:path'),

  update: {
    getStatus: () => ipcRenderer.invoke('update:get-status'),
    getConfig: () => ipcRenderer.invoke('update:get-config'),
    saveConfig: (config: {
      sourceType?: 'github' | 'custom';
      sourceUrl?: string;
      autoCheck?: boolean;
      autoDownload?: boolean;
    }) => ipcRenderer.invoke('update:save-config', config),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install')
  }
});
