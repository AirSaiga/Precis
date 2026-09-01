/**
 * @file config.ts
 * @description 启动配置 IPC handler（从 main.ts 抽出）
 *
 * 管理 Electron 启动配置文件（userData/.precis/electron_launch.yaml）的读写：
 * - save-config：保存 configPath/dataPath 到 YAML
 * - load-config：读取并返回 configPath/dataPath
 *
 * 依赖：app/path/fs/yaml/logger。无共享状态依赖。
 */

import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { logger } from '../logger';

/**
 * 注册配置读写 IPC handler
 *
 * - save-config：写入 userData/.precis/electron_launch.yaml
 * - load-config：读取该文件，不存在返回空值
 */
export function registerConfigIpc(): void {
  ipcMain.handle('save-config', async (_event, configPath: string, dataPath: string) => {
    // [安全] 本文件是授权根信任源：electron_launch.yaml 由 ipc/filesystem.ts 的
    // getAllowedRoots() 读取，作为 read-file/write-file/open-file/scan-directory
    // 的根目录白名单依据。渲染层可经 XSS 调用本 IPC，若无条件接受任意字符串，
    // 等于让渲染层自定义文件系统白名单（毒化信任源后即可越权读写任意目录）。
    // 因此非空路径必须为绝对路径，且指向真实存在的目录（与用户在启动器中经
    // 原生对话框显式选择的语义一致），否则拒绝写入。
    // 例外：configPath 与 dataPath 均为空串是前端"项目路径失效，清理最近项目"
    // 的合法载荷（App.vue / useAppBootstrap.ts），写入空值只会让 AllowedRoots
    // 回落到仅 userData，无越权风险，予以放行。
    const isTrustedDir = (p: unknown): p is string => {
      if (typeof p !== 'string' || p.length === 0) return false;
      if (!path.isAbsolute(p)) return false;
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    };
    const isClearPayload = configPath === '' && dataPath === '';
    if (!isClearPayload && (!isTrustedDir(configPath) || !isTrustedDir(dataPath))) {
      logger.warn('[Main] save-config 拒绝非法路径（非空值须为已存在目录的绝对路径）:', {
        configPath,
        dataPath,
      });
      return false;
    }

    // 使用用户数据目录下的 .precis/electron_launch.yaml，避免写入安装目录
    // Windows: %APPDATA%/Precis/.precis/electron_launch.yaml
    // macOS: ~/Library/Application Support/Precis/.precis/electron_launch.yaml
    // Linux: ~/.config/Precis/.precis/electron_launch.yaml
    const userDataDir = app.getPath('userData');
    const configDir = path.join(userDataDir, '.precis');
    const configFile = path.join(configDir, 'electron_launch.yaml');

    try {
      // 确保 .precis 目录存在
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 使用 js-yaml 序列化配置，避免手写 YAML 字符串和正则解析带来的安全风险
      const payload = {
        configPath,
        dataPath,
      };
      const content = yaml.dump(payload);

      fs.writeFileSync(configFile, content, 'utf-8');

      logger.debug('[Main] 配置已保存:', configFile);
      return true;
    } catch (error) {
      logger.error('[Main] 保存配置失败:', error);
      return false;
    }
  });

  ipcMain.handle('load-config', async () => {
    // 测试注入钩子：E2E smoke 通过环境变量指定最近项目（与 PRECIS_FORCE_DEV 同类的
    // 环境变量注入），使打包产物在全新环境（无 userData 残留）下直接进入项目画布。
    // 仅自动化测试使用，不影响正常用户路径。
    const injected = process.env.PRECIS_RECENT_CONFIG;
    if (injected) {
      logger.debug('[Main] 使用环境变量注入的最近项目:', injected);
      return {
        configPath: injected,
        dataPath: process.env.PRECIS_RECENT_DATA || injected,
      };
    }

    const userDataDir = app.getPath('userData');
    const configFile = path.join(userDataDir, '.precis', 'electron_launch.yaml');

    if (!fs.existsSync(configFile)) {
      logger.debug('[Main] 配置文件不存在');
      return { configPath: '', dataPath: '' };
    }

    try {
      const content = fs.readFileSync(configFile, 'utf-8');
      const parsed = yaml.load(content) as { configPath?: string; dataPath?: string } | null;
      const configPath = parsed?.configPath || '';
      const dataPath = parsed?.dataPath || '';
      logger.debug('[Main] 配置已加载:', { configPath, dataPath });
      return { configPath, dataPath };
    } catch (error) {
      logger.error('[Main] 读取配置失败:', error);
      return { configPath: '', dataPath: '' };
    }
  });
}
