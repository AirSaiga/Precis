/**
 * 本地更新服务器脚本
 *
 * 用途: 为自动更新端到端测试搭建本地 HTTP 服务器
 *
 * 使用方法:
 *   1. 先创建模拟更新: node scripts/create-local-update.js create 0.2.0 "测试更新"
 *   2. 启动本服务器:   node scripts/serve-updates.js [port]
 *   3. 在已安装的应用中配置更新源为 http://localhost:8080
 *
 * 服务目录: local-updates/ (由 create-local-update.js 创建)
 *
 * 支持的请求:
 *   GET /latest.yml           — 版本信息文件（electron-updater 检查更新时请求）
 *   GET /releases/*.zip       — 更新包文件（electron-updater 下载时请求）
 *   GET /                      — 服务器状态页，确认服务正常
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const LOCAL_UPDATE_DIR = path.join(__dirname, '..', 'local-updates');
const DEFAULT_PORT = 8080;
const port = parseInt(process.argv[2] || DEFAULT_PORT, 10);

const MIME_TYPES = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.zip': 'application/zip',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(LOCAL_UPDATE_DIR, safePath);

  if (safePath === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Precis 本地更新服务器</title></head>
<body>
<h1>Precis 本地更新服务器</h1>
<p>服务状态: <strong>运行中</strong></p>
<p>更新源路径: <code>${LOCAL_UPDATE_DIR}</code></p>
<hr>
<h2>可用端点</h2>
<ul>
  <li><a href="/latest.yml">/latest.yml</a> — 版本信息</li>
  <li>/releases/ — 更新包目录</li>
</ul>
<h2>配置说明</h2>
<p>在已安装的应用中通过 IPC <code>update:save-config</code> 配置:</p>
<pre>
{ "sourceType": "custom", "sourceUrl": "http://localhost:${port}" }
</pre>
<p>然后触发 <code>update:check</code> 即可检测到新版本。</p>
</body>
</html>`);
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    console.log(`[UpdateServer] 404 ${safePath}`);
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(filePath, { withFileTypes: true });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${safePath}</title></head>
<body><h1>${safePath}</h1><ul>
${entries.map(e => `<li>${e.isDirectory() ? '📁' : '📄'} <a href="${path.join(safePath, e.name).replace(/\\/g, '/')}">${e.name}</a></li>`).join('\n')}
</ul></body></html>`);
    return;
  }

  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': getMimeType(filePath),
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(content);
  console.log(`[UpdateServer] 200 ${safePath} (${stat.size} bytes)`);
});

server.listen(port, () => {
  console.log(`\n[UpdateServer] 本地更新服务器已启动`);
  console.log(`[UpdateServer] 地址: http://localhost:${port}`);
  console.log(`[UpdateServer] 更新源: ${LOCAL_UPDATE_DIR}`);
  console.log(`[UpdateServer] 按 Ctrl+C 停止\n`);
});
