/**
 * @file index.ts
 * @description 文件处理器导出入口
 *
 * 由于项目已全面转向 Electron 桌面应用，仅保留 Electron 文件处理器。
 * 浏览器文件处理器已于 2026年3月移除。
 */

export {
  selectFilesElectron,
  importFilesElectron,
  createDataSourceFromPath,
  isElectron,
  getElectronAPI,
} from './electronFileHandler'

export type { ElectronAPI } from './electronFileHandler'
