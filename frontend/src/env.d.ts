/**
 * @file env.d.ts
 * @description Vite 环境变量类型声明文件
 *
 * 作用：
 * - 为 `import.meta.env` 提供 TypeScript 类型支持
 * - 声明项目使用的环境变量接口
 */

/// <reference types="vite/client" />

// Vue组件类型声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/**
 * File System Access API 类型扩展
 * 定义 showOpenFilePicker 和相关 API 的类型
 * 适用于 Chrome 86+、Edge 86+
 */
interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
  multiple?: boolean
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface FileSystemFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>
  seek(position: number): Promise<void>
  truncate(size: number): Promise<void>
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker(options?: {
    suggestedName?: string
    types?: FilePickerAcceptType[]
    excludeAcceptAllOption?: boolean
  }): Promise<FileSystemFileHandle>
}

/**
 * Electron API 类型定义
 * 与 electronDetector.ts 中的 ElectronAPI 接口保持一致
 */
interface ElectronAPI {
  getServerStatus: () => Promise<{
    pythonReady: boolean
    port: number
    frontendPort: number
  }>
  restartPythonServer: () => Promise<boolean>
  getAppVersion: () => Promise<string>
  platform: string
}

interface WindowWithElectron {
  electronAPI?: ElectronAPI
}

/**
 * FileSystemFileHandle 的 Electron 扩展
 * 添加 path 属性支持
 */
interface ElectronFileHandle extends FileSystemFileHandle {
  path: string
}

/**
 * Electron 模块的动态导入类型声明
 * 用于解决动态 import('electron') 的类型检查问题
 * 仅在 Electron 环境中实际执行导入
 */
declare module 'electron' {
  export const app: {
    getPath(name: string): string
    getVersion(): string
  }
  export const ipcRenderer: {
    on(channel: string, listener: (...args: any[]) => void): void
    send(channel: string, ...args: any[]): void
    invoke(channel: string, ...args: any[]): Promise<any>
  }
  export const shell: {
    openPath(path: string): Promise<string>
    showItemInFolder(path: string): void
  }
}

/**
 * Vite 环境变量类型声明
 */
interface ImportMetaEnv {
  /** 后端服务端口，默认 18000 */
  readonly VITE_BACKEND_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
