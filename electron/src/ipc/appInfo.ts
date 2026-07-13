/**
 * @file appInfo.ts
 * @description 应用信息与路径查询 IPC handler（从 main.ts 抽出）
 *
 * 提供应用元信息与标准路径查询：
 * - get-app-version / splash:get-version：应用版本号
 * - get-user-data-path：用户数据目录（userData）
 * - get-default-project-path：默认项目根目录（含 env/目录扫描逻辑）
 * - get-cwd：当前工作目录
 *
 * 依赖：app + path + fs + logger。无 app-state/pythonProcess 依赖。
 */

import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../logger';

/**
 * 注册应用信息与路径查询 IPC handler
 */
export function registerAppInfoIpc(): void {
  // ---- get-app-version ----
  ipcMain.handle('get-app-version', async () => {
    return app.getVersion();
  });

  // ---- splash:get-version ----
  // Splash 在启动早期需要显示版本号,但其自身无 app 引用,
  // 通过此 IPC 从主进程查询。与 get-app-version 逻辑相同,
  // 但走独立通道以保持 splash IPC 命名空间隔离(splash:*)。
  ipcMain.handle('splash:get-version', async () => {
    return app.getVersion();
  });

  // ---- get-user-data-path ----
  // Windows: %APPDATA%/Precis
  // macOS: ~/Library/Application Support/Precis
  // Linux: ~/.config/Precis
  ipcMain.handle('get-user-data-path', async () => {
    return app.getPath('userData');
  });

  // ---- get-default-project-path ----
  // 默认项目根目录解析逻辑：
  // 1. PRECIS_PROJECT_ROOT 环境变量 / .env 文件（绝对路径则直接用）
  // 2. 否则在 documents/PrecisProjects 下扫描含 project.precis.yaml 的子目录
  // 3. 都没有则创建 DefaultProject 子目录
  ipcMain.handle('get-default-project-path', async () => {
    const userDataDir = app.getPath('userData');
    const cwd = process.cwd();
    const envCandidates = [
      path.join(cwd, 'precis.env'),
      path.join(cwd, '.env'),
      path.join(cwd, '..', 'precis.env'),
      path.join(cwd, '..', '.env'),
      path.join(userDataDir, 'precis.env'),
      path.join(userDataDir, '.env'),
    ];

    const readEnvValue = (key: string): string | undefined => {
      for (const fp of envCandidates) {
        try {
          if (!fs.existsSync(fp)) continue;
          const content = fs.readFileSync(fp, 'utf-8');
          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx < 0) continue;
            const k = trimmed.slice(0, idx).trim();
            if (k !== key) continue;
            let v = trimmed.slice(idx + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            return v;
          }
        } catch {
          continue;
        }
      }
      return undefined;
    };

    const envRoot = process.env.PRECIS_PROJECT_ROOT || readEnvValue('PRECIS_PROJECT_ROOT');
    const root =
      envRoot && path.isAbsolute(envRoot)
        ? envRoot
        : path.join(app.getPath('documents'), 'PrecisProjects');

    try {
      fs.mkdirSync(root, { recursive: true });
    } catch {
      // ignore
    }

    if (envRoot && path.isAbsolute(envRoot)) {
      return root;
    }

    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const dir = path.join(root, ent.name);
        const v2 = path.join(dir, 'project.precis.yaml');
        if (fs.existsSync(v2)) {
          return dir;
        }
      }
    } catch {
      // ignore
    }

    const fallback = path.join(root, 'DefaultProject');
    try {
      fs.mkdirSync(fallback, { recursive: true });
    } catch {
      // ignore
    }
    return fallback;
  });

  // ---- get-cwd ----
  ipcMain.handle('get-cwd', async () => {
    return process.cwd();
  });
}
