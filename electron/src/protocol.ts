/**
 * @file protocol.ts
 * @description app:// 自定义协议管理（从 main.ts 抽出）
 *
 * ⚠️ 协议时序铁律（违反会导致白屏）：
 * - registerAppScheme()：调用 protocol.registerSchemesAsPrivileged，
 *   必须在 app.whenReady 之前**同步执行**（模块加载时）
 * - registerAppProtocolHandler()：调用 protocol.handle，
 *   必须在 app.whenReady **之内**执行
 *
 * 两者不能放一起，也不能延迟异步注册。registerSchemesAsPrivileged 在 app
 * 初始化前注册 scheme 特权，protocol.handle 在 app ready 后实际处理请求。
 *
 * 安全：protocol.handle 内做路径穿越校验，确保请求文件在 frontendPath 范围内。
 *
 * 依赖：protocol + net(fetch) + path + logger。
 */

import { protocol, net as electronNet } from 'electron';
import * as path from 'path';
import { logger } from './logger';

/**
 * 注册 app:// 协议为特权 scheme
 *
 * ⚠️ 必须在 app.whenReady() 之前同步调用（通常在模块顶层）。
 * registerSchemesAsPrivileged 在 app 初始化阶段读取已注册的特权 scheme 列表，
 * whenReady 后再调用无效。
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * 注册 app:// 协议处理器，将请求映射到前端构建目录
 *
 * ⚠️ 必须在 app.whenReady() 之内调用（protocol.handle 需要 app 已 ready）。
 *
 * 路径穿越防护：解码 pathname 后，解析真实路径必须在 frontendPath 范围内，
 * 否则返回 403 Forbidden。
 *
 * @param frontendPath - 前端构建产物目录（生产环境用）
 */
export function registerAppProtocolHandler(frontendPath: string): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // 解码 pathname 中可能存在的编码字符（如 %2F -> /），防止编码绕过路径穿越校验
    const decodedPathname = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(frontendPath, decodedPathname));

    // 路径穿越校验：解析后的真实路径必须在 frontendPath 范围内
    const realFilePath = path.resolve(filePath);
    const realFrontendPath = path.resolve(frontendPath);
    const isInside =
      realFilePath === realFrontendPath || realFilePath.startsWith(realFrontendPath + path.sep);
    if (!isInside) {
      logger.error('[Main] app:// 协议拒绝越界访问:', realFilePath);
      return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
    }

    return electronNet.fetch(`file://${filePath}`);
  });
}
