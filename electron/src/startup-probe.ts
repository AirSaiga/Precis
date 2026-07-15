/**
 * @file startup-probe.ts
 * @description 后端启动信号检测与端口/API 就绪轮询（纯函数，从 main.ts 抽出）
 *
 * 本模块提供后端启动相关的纯工具函数：
 * - containsStartupSignal / looksLikeStderrError：扫描 Uvicorn 日志文本
 * - readBackendPortFile：轮询读取后端端口文件(端口发现协议)
 * - waitForApiReady：HTTP /docs 就绪轮询（确认 FastAPI 已初始化）
 *
 * 端口发现协议:
 *   后端 spawn 时传 --port 0,由 OS 原子分配端口并写入 <backend>/.backend-port。
 *   本模块的 readBackendPortFile 轮询该文件直到出现,拿到实际端口。
 *   这取代了旧的 findAvailablePort(bind→close→rebind,有 TOCTOU 竞态)。
 *
 * 特征：无 Electron 依赖（仅用 Node net/http/fs），可独立单元测试。
 *
 * 依赖方向：仅依赖 Node 内置模块（net/http/fs）。
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// 常量
// ============================================================================

/** 后端就绪信号片段，匹配任一即认为服务已启动 */
export const STARTUP_SIGNALS = ['Application startup complete', 'Uvicorn running'] as const;

/** stderr 中标识真实错误的关键词，命中则按 error 级别记录 */
export const STDERR_ERROR_MARKERS = ['Traceback', 'Error:', 'CRITICAL', 'Exception'] as const;

/** 滚动窗口扫描就绪信号时保留的尾部字符数（足够覆盖被分块切断的信号串） */
export const SIGNAL_SCAN_TAIL_CHARS = 256;

/** 端口文件名,与后端 backend/app/shared/core/config/server.py BACKEND_PORT_FILE 一致 */
export const BACKEND_PORT_FILE = '.backend-port';

// ============================================================================
// 日志文本扫描（纯函数）
// ============================================================================

/**
 * 判断一段文本是否包含后端就绪信号。
 *
 * @param text - 待扫描的文本（通常是 stderr/stdout 缓冲区的尾部窗口）
 * @returns 含就绪信号返回 true
 */
export function containsStartupSignal(text: string): boolean {
  return STARTUP_SIGNALS.some((s) => text.includes(s));
}

/**
 * 判断一段 stderr 文本是否疑似真实错误（而非 Uvicorn 常规 INFO 日志）。
 *
 * @param text - 单个 data chunk 的文本
 * @returns 命中错误标记返回 true，应按 error 级别记录
 */
export function looksLikeStderrError(text: string): boolean {
  return STDERR_ERROR_MARKERS.some((m) => text.includes(m));
}

// ============================================================================
// 端口文件发现协议
// ============================================================================

/**
 * 同步读取端口文件中的端口号(若存在)。
 *
 * @param backendDir - 后端根目录(端口文件所在 cwd)
 * @returns 端口号;文件不存在或内容无效返回 null
 */
export function tryReadBackendPort(backendDir: string): number | null {
  const filePath = path.join(backendDir, BACKEND_PORT_FILE);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const port = parseInt(raw, 10);
    return Number.isNaN(port) || port <= 0 ? null : port;
  } catch {
    return null;
  }
}

/**
 * 轮询等待后端端口文件出现并读取实际端口。
 *
 * 业务场景:
 *   后端 spawn 时传 --port 0,OS 分配端口后写入 .backend-port。
 *   主进程需轮询该文件直到出现,才能拿到实际端口用于 IPC 回传与 API 就绪检测。
 *
 * @param backendDir - 后端根目录
 * @param timeout - 超时时间(毫秒),默认 30s
 * @param interval - 轮询间隔(毫秒),默认 200ms
 * @returns 端口号;超时返回 null
 */
export async function readBackendPortFile(
  backendDir: string,
  timeout: number = 30000,
  interval: number = 200
): Promise<number | null> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const port = tryReadBackendPort(backendDir);
      if (port !== null) {
        resolve(port);
        return;
      }
      if (Date.now() - startTime > timeout) {
        resolve(null);
        return;
      }
      setTimeout(check, interval);
    };
    check();
  });
}

// ============================================================================
// API 就绪轮询
// ============================================================================

/**
 * 通过 HTTP 请求检测后端 API 是否真正就绪
 *
 * 业务场景:
 * - TCP 端口可连接不代表 FastAPI 已完全初始化
 * - 通过实际调用 /docs 端点确认 API 可正常响应
 *
 * @param port - 服务器端口
 * @param timeout - 超时时间（毫秒），默认 30 秒
 * @param interval - 检查间隔（毫秒），默认 500ms
 * @returns API 是否就绪
 */
export async function waitForApiReady(
  port: number,
  timeout: number = 30000,
  interval: number = 500
): Promise<boolean> {
  const startTime = Date.now();
  const http = await import('http');

  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/docs`, (res) => {
        // 只要收到响应（无论状态码），说明 API 已就绪
        if (res.statusCode && res.statusCode < 500) {
          resolve(true);
        } else {
          // 继续等待
          if (Date.now() - startTime > timeout) {
            resolve(false);
          } else {
            setTimeout(check, interval);
          }
        }
      });

      req.on('error', () => {
        if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      });

      req.setTimeout(interval, () => {
        req.destroy();
        if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      });
    };

    check();
  });
}
