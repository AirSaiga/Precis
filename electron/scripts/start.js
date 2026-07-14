const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

// 加载根目录 .env，使 VITE_BACKEND_PORT 等变量对 electron 主进程可见
// （electron:dev → start.js → electron .，此链路原本不加载 dotenv）
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

let command = 'npm';
let args = ['run', 'start:base'];

// Windows 下强制在 CMD 中设置代码页为 UTF-8
if (os.platform() === 'win32') {
  command = 'cmd.exe';
  // 使用 /c 确保 chcp 和 npm 在同一个 shell 上下文中串行执行
  // >nul 屏蔽 chcp 的输出
  args = ['/c', 'chcp 65001 >nul && npm run start:base'];
}

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: true, // 在 Windows 上这是必须的，虽然我们显式调用了 cmd
  env: process.env, // 显式传递环境变量（含已加载的 .env），确保子进程继承
});

child.on('close', (code) => {
  process.exit(code);
});
