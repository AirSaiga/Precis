/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/
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
    // 4.18: 范围校验（1-65535）——99999/非数字此前透传，new URL/HTTP 请求同步抛错
    // 打穿启动链且无明确报错；非法视为"无端口文件"走重拉路径
    return Number.isNaN(port) || port < 1 || port > 65535 ? null : port;
  } catch {
    return null;
  }
}

/**
 * 4.15: 采信端口文件前校验新鲜度——上次异常退出留下的陈旧文件（mtime 过旧）
 * 会让健康检查全打在死端口上。超过会话周期（24h）视为陈旧，返回 true 表示不可采信。
 */
export function isBackendPortFileStale(backendDir: string, maxAgeMs: number = 24 * 60 * 60 * 1000): boolean {
  try {
    const filePath = path.join(backendDir, BACKEND_PORT_FILE);
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs > maxAgeMs;
  } catch {
    return false; // 文件不存在等场景交由 tryReadBackendPort 的 null 语义处理
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

  // 4.23: 就绪判据从"任意 <500 状态码"收紧为 Precis 版本端点的 JSON 结构特征
  // （{version: string}）——旧端口被无关服务占用且返回 200 时不再假阳性"就绪"，
  // 前端不会连到错误服务。轮询退出时统一 clearTimeout，成功响应销毁连接防句柄残留。
  //
  // 2026-09-20 修复：>4KB 大响应触发 req.destroy() 后，'end' 与 req 'error' 均
  // 不触发（destroy 不带 error 参数），socket 已销毁 socket-timeout 也不再回调，
  // Promise 永不 settle——dev 模式端口文件指向的端口被返回分块大响应（如 Vite
  // SPA fallback HTML）的本地服务占用时启动链直接挂死。现由 res 'close' 兜底：
  // 凡未走到 'end' 的提前终止一律按"本轮探测失败"进入统一的重试/超时出口；
  // 每轮 check 的终止事件（end/error/close/socket-timeout）只消费一次，防双触发。
  return new Promise((resolve) => {
    let nextTimer: NodeJS.Timeout | null = null;
    const finish = (ok: boolean) => {
      if (nextTimer) clearTimeout(nextTimer);
      resolve(ok);
    };
    const retryOrFail = () => {
      if (Date.now() - startTime > timeout) {
        finish(false);
      } else {
        nextTimer = setTimeout(check, interval);
      }
    };
    const check = () => {
      let consumed = false;
      // 终止事件单飞守卫：四个终止出口共享同一标志，只允许第一个到达者消费
      const once = (fn: () => void) => () => {
        if (consumed) return;
        consumed = true;
        fn();
      };
      const req = http.get(`http://127.0.0.1:${port}/api/latest/version`, (res) => {
        let body = '';
        let ended = false;
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf-8');
          if (body.length > 4096) req.destroy(); // 防异常超大响应
        });
        res.on('end', once(() => {
          ended = true;
          res.destroy();
          let isPrecis = false;
          try {
            const parsed = JSON.parse(body) as { version?: unknown };
            isPrecis = typeof parsed.version === 'string' && parsed.version.length > 0;
          } catch {
            isPrecis = false;
          }
          if (isPrecis) {
            finish(true);
          } else {
            retryOrFail();
          }
        }));
        // 大响应 destroy 后的兜底出口：未到达 'end' 的提前终止（含主动 destroy）
        // 走统一重试/超时，不再依赖 'end'/'error'（destroy 后两者均不会触发）
        res.on('close', once(() => {
          if (ended) return;
          retryOrFail();
        }));
      });

      req.on('error', once(retryOrFail));

      req.setTimeout(interval, once(() => {
        req.destroy();
        retryOrFail();
      }));
    };

    check();
  });
}
