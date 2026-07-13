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
