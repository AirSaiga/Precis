/**
 * @file dynamic-backend-proxy.ts
 * @description Vite 动态后端代理(中间件方案)
 *
 * 背景:
 *   后端启动时端口由 OS 动态分配(port=0),并写入 ../backend/.backend-port。
 *   Vite 8 的 ProxyOptions(基于 http-proxy-3)不支持 router 函数动态解析 target,
 *   故无法用 server.proxy 配置实现动态端口代理。
 *
 * 方案:
 *   改用 Vite 的 configureServer 钩子注册一个 Connect 中间件,拦截后端 API 路由,
 *   用 Node 原生 http 把请求转发到从端口文件读取的动态端口。完全不依赖 http-proxy。
 *
 * 行为:
 *   - 端口文件存在且后端可达 → 代理转发请求与响应体
 *   - 端口文件缺失(后端未就绪)→ 返回 502 + JSON 友好提示
 */

import type { Plugin, ViteDevServer } from 'vite'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'

/**
 * 端口文件路径。
 *
 * 用 process.cwd() 定位 —— Vite dev server 的 cwd 始终是 frontend/
 * (即 vite.config.ts 所在目录)。
 */
const PORT_FILE = resolve(process.cwd(), '..', 'backend', '.backend-port')

/** 需要代理到后端的路由前缀(与原 vite.config.ts 静态配置保持一致) */
const BACKEND_ROUTES = ['/preview', '/workspace', '/regex', '/utils', '/api']

/**
 * 读取后端实际端口。
 *
 * @returns 端口号;读不到返回 null(后端未就绪)
 */
export function readBackendPort(): number | null {
  try {
    if (!existsSync(PORT_FILE)) return null
    const raw = readFileSync(PORT_FILE, 'utf-8').trim()
    const port = parseInt(raw, 10)
    return Number.isNaN(port) || port <= 0 ? null : port
  } catch {
    return null
  }
}

/** 判断请求路径是否匹配后端代理路由 */
function isBackendRoute(url: string): boolean {
  return BACKEND_ROUTES.some((route) => url === route || url.startsWith(route + '/'))
}

/**
 * 将客户端请求转发到后端动态端口,并把后端响应回传给客户端。
 *
 * 使用 Node 原生 http.request,手动搬运请求头、请求体与响应,无需 http-proxy 依赖。
 */
function proxyToBackend(req: IncomingMessage, res: ServerResponse): void {
  const port = readBackendPort()

  if (port === null) {
    // 后端未就绪:返回 502 + JSON 友好提示(前端 axios 拦截器已有降级处理)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Backend not ready', message: 'Backend port file not found' }))
    return
  }

  // 构造转发请求:保留原 method/path/headers,目标为动态端口的后端
  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (proxyRes) => {
      // 回传后端响应状态码、头与体
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Backend unreachable', message: err.message }))
    }
  })

  // 搬运请求体(如有)
  req.pipe(proxyReq)
}

/**
 * Vite 插件:为后端 API 路径提供动态端口代理(中间件方案)。
 *
 * 在 configureServer 中注册 Connect 中间件,拦截匹配后端路由的请求并转发到动态端口。
 * 不使用 server.proxy(因 Vite 8 的 ProxyOptions 不支持动态 target)。
 */
export function dynamicBackendProxy(): Plugin {
  return {
    name: 'precis-dynamic-backend-proxy',
    enforce: 'pre',
    configureServer(server: ViteDevServer) {
      // 注册中间件:匹配后端路由的请求转发到动态端口后端,其余交给 Vite 处理
      server.middlewares.use((req, res, next) => {
        if (req.url && isBackendRoute(req.url)) {
          proxyToBackend(req, res)
        } else {
          next()
        }
      })
    },
  }
}

export default dynamicBackendProxy
