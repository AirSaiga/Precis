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
 * @fileoverview DSH Host 半：拉起 Precis 后端子进程，并提供微壳 HTTP 服务
 * （静态服务 frontend/dist + 把 /api/* 反向代理到后端动态端口）。
 *
 * 设计要点（全部只依赖 Precis 既有接口，不改 Precis 代码）：
 * - 后端启动契约：`python app/start_server.py`（cwd=backend/），端口由 OS 分配后写入
 *   `backend/.backend-port`（app/shared/core/config/server.py 的公开发现协议）。
 * - 前端契约：axios 统一走相对路径 `/api/latest`（httpClient.ts 注释明文支持
 *   "由反向代理/部署环境转发"），且 Vite `base: './'` 使 dist 可从任意源加载——
 *   因此微壳同源承载前端 + 反代 API，无 CORS、无 token（token 仅 Electron 打包模式注入）。
 * - 生命周期：ctx.effect 返回清理函数；Windows 下用 taskkill /T /F 终止进程树
 *   （cmd /c python 会派生孙进程，直接 kill 只能杀到 cmd）。
 * - PoC 简化：直接用 node:child_process；生产版应迁移到 ctx.subprocess（统一环境解析与托管释放）。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 配置经 cordis.patch.yml 的 config 行原样传入（PoC 不声明 Config schema，
 * 避免依赖 @deepseek-ai/schemastery 的跨 profile 解析；生产版应补 z.object 校验）：
 *   backendDir / distDir / shellPort(默认 17860) / pythonCommand(默认 python)
 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

export function apply(ctx, config) {
  const backendDir = path.resolve(config.backendDir)
  const distDir = path.resolve(config.distDir)
  const shellPort = config.shellPort ?? 17860
  const python = config.pythonCommand ?? 'python'
  const portFile = path.join(backendDir, '.backend-port')
  const isWin = process.platform === 'win32'
  const log = (...args) => console.log('[precis-gui]', ...args)

  let disposed = false
  let child = null

  // ---- 读取后端动态端口（start_server.py 的公开发现协议）----
  const readBackendPort = () => {
    try {
      const value = Number(fs.readFileSync(portFile, 'utf8').trim())
      return Number.isInteger(value) && value > 0 ? value : null
    } catch {
      return null
    }
  }

  // ---- TCP 探活（后端未就绪时 health 返回未就绪，面板继续等待）----
  const probeTcp = (port, timeoutMs = 900) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      const settle = (ok) => {
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(timeoutMs, () => settle(false))
      socket.on('connect', () => settle(true))
      socket.on('error', () => settle(false))
    })

  // ---- 反向代理 /api/* → 后端动态端口 ----
  const proxyToBackend = (req, res, backendPort) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: backendPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      },
    )
    upstream.on('error', (error) => {
      log('proxy error:', error?.message ?? error)
      try {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ detail: `precis backend unreachable: ${error?.message ?? error}` }))
      } catch {
        /* 响应已开始则忽略 */
      }
    })
    req.pipe(upstream)
  }

  // ---- 微壳 HTTP 服务：health + 静态 dist + API 反代 ----
  const shell = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        log('shell error:', error?.stack ?? error)
        try {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(String(error?.message ?? error))
        } catch {
          /* 已响应则忽略 */
        }
      })
  })

  const sendFile = (res, file) => {
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': path.extname(file) ? 'public, max-age=3600' : 'no-cache',
      })
      res.end(data)
    })
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const pathname = decodeURIComponent(url.pathname)

    // 健康检查：读端口文件 + TCP 探活
    if (pathname === '/_precis/health') {
      const backendPort = readBackendPort()
      const ok = backendPort !== null && (await probeTcp(backendPort))
      res.writeHead(ok ? 200 : 503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        // 允许 DSH 页面（另一源）跨源探测；注意 host.js 属模块代缓存，
        // 本修改在下次 DSH 重启后才生效（client.js 的改动刷新页面即生效）
        'access-control-allow-origin': '*',
      })
      res.end(JSON.stringify({ ok, backendPort, shellPort }))
      return
    }

    // API 反代（前端 axios 相对路径 /api/latest/* 命中这里）
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const backendPort = readBackendPort()
      if (backendPort === null) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ detail: 'precis backend not ready (no .backend-port yet)' }))
        return
      }
      proxyToBackend(req, res, backendPort)
      return
    }

    // 静态资源（SPA history 回退：无扩展名路径与未知文件回退 index.html）
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
    let file = path.normalize(path.join(distDir, relative))
    if (file !== distDir && !file.startsWith(distDir + path.sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!path.extname(file)) file = path.join(distDir, 'index.html')
    fs.access(file, fs.constants.R_OK, (error) => {
      sendFile(res, error ? path.join(distDir, 'index.html') : file)
    })
  }

  // ---- 启动：后端子进程 + 微壳监听；effect 返回清理 ----
  return ctx.effect(() => {
    // Windows: pip/pyenv 的 python 是 .bat shim，Node 直接 spawn 会 EINVAL，须经 cmd /c
    const command = isWin ? 'cmd' : python
    const args = isWin ? ['/c', python, 'app/start_server.py'] : ['app/start_server.py']
    child = spawn(command, args, { cwd: backendDir, stdio: 'ignore', windowsHide: true })
    child.on('error', (error) => log('backend spawn failed:', error?.message ?? error))
    child.on('exit', (code) => {
      if (!disposed) log('backend exited unexpectedly, code =', code)
    })

    shell.on('error', (error) => log('shell server error:', error?.message ?? error))
    shell.listen(shellPort, '127.0.0.1', () => {
      log(`micro-shell on http://127.0.0.1:${shellPort} (backend dir: ${backendDir})`)
    })

    return () => {
      disposed = true
      try {
        shell.close()
      } catch {
        /* 已关闭则忽略 */
      }
      if (child?.pid) {
        if (isWin) {
          // 杀整棵进程树（cmd → python → uvicorn 工作进程）
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          try {
            child.kill('SIGTERM')
          } catch {
            /* 已退出则忽略 */
          }
        }
      }
      log('disposed')
    }
  }, 'precis-gui: backend subprocess + micro-shell')
}
