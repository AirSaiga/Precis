/**
 * @file startup-probe.ts
 * @description 后端启动信号检测与端口/API 就绪轮询（纯函数，从 main.ts 抽出）
 *
 * 本模块提供后端启动相关的纯工具函数：
 * - containsStartupSignal / looksLikeStderrError：扫描 Uvicorn 日志文本
 * - findAvailablePort：查找可用 TCP 端口（递归）
 * - waitForServer：TCP 端口就绪轮询
 * - waitForApiReady：HTTP /docs 就绪轮询（确认 FastAPI 已初始化）
 *
 * 特征：无 Electron 依赖（仅用 Node net/http），可独立单元测试。
 *
 * 依赖方向：仅依赖 Node 内置模块（net/http）。
 */

import * as net from 'net';

// ============================================================================
// 常量
// ============================================================================

/** 后端就绪信号片段，匹配任一即认为服务已启动 */
export const STARTUP_SIGNALS = ['Application startup complete', 'Uvicorn running'] as const;

/** stderr 中标识真实错误的关键词，命中则按 error 级别记录 */
export const STDERR_ERROR_MARKERS = ['Traceback', 'Error:', 'CRITICAL', 'Exception'] as const;

/** 滚动窗口扫描就绪信号时保留的尾部字符数（足够覆盖被分块切断的信号串） */
export const SIGNAL_SCAN_TAIL_CHARS = 256;

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
// 端口/API 就绪轮询
// ============================================================================

/**
 * 查找可用端口的工具函数
 *
 * 业务场景:
 * - 当默认端口被占用时，自动寻找下一个可用端口
 * - 避免用户手动配置端口的麻烦
 *
 * 算法原理:
 * - 尝试绑定指定端口，成功则返回端口号
 * - 失败则递归尝试下一个端口号
 *
 * @param startPort - 起始端口号
 * @returns 可用的端口号 Promise
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();

    // 尝试监听指定端口
    server.listen(startPort, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      // 立即关闭服务器并返回端口号
      server.close(() => resolve(port));
    });

    // 端口被占用时的错误处理
    server.on('error', () => {
      server.close();
      // 递归查找下一个端口，避免无限循环
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * 等待服务器就绪的轮询函数（TCP 连接探测）
 *
 * 业务场景:
 * - 确保 Python 后端完全启动后再允许前端发起请求
 * - 避免前端因后端未就绪而报错
 *
 * [副作用]
 * - 会创建临时的 TCP Socket 连接
 * - 轮询间隔 500ms 对性能影响微乎其微
 *
 * @param port - 要检测的服务器端口
 * @param timeout - 超时时间（毫秒），默认 30 秒
 * @returns 服务器是否就绪
 */
export async function waitForServer(port: number, timeout: number = 30000): Promise<boolean> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const client = new net.Socket();

      // 尝试建立 TCP 连接
      client.connect(port, '127.0.0.1', () => {
        client.destroy();
        resolve(true);
      });

      // 连接失败的处理
      client.on('error', () => {
        client.destroy();
        // 检查是否超时
        if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          // 指数退避策略: 间隔 500ms 后重试
          setTimeout(check, 500);
        }
      });
    };

    check();
  });
}

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
