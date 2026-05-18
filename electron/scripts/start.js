const { spawn } = require('child_process');
const os = require('os');

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
  shell: true // 在 Windows 上这是必须的，虽然我们显式调用了 cmd
});

child.on('close', (code) => {
  process.exit(code);
});
