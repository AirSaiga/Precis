# Precis E2E 测试

基于 **Playwright + Chromium** 的端到端测试套件。E2E 是前端功能正确性的**主验证手段**（详见根目录 AGENTS.md 的测试策略）：用户操作完整路径、composable 与组件集成、前端 ↔ 后端 API 交互都在这里覆盖；纯逻辑模块才走 frontend 的 vitest 单测。

## 目录结构

```
e2e/
├── config.ts                      # 公共配置（超时、重试、环境变量）
├── fixtures/                      # 测试夹具（基础夹具 / 打开项目 / Electron 启动）
├── flows/                         # Web 模式测试（38 个 spec，按用户流程分组）
│   ├── ai-*.spec.ts               # AI 聊天 / 配置生成 / 迁移（无 Provider 时自动 skip）
│   ├── canvas-*.spec.ts           # 画布交互回归
│   ├── constraint-*.spec.ts       # 约束 CRUD 与类型覆盖
│   ├── project-*.spec.ts          # 项目生命周期 / 管理弹窗 / 配置
│   ├── validation*.spec.ts        # 校验全流程 / 报告 / 历史
│   └── ...
├── flows-electron/                # Electron 打包产物冒烟测试
├── release-gui/                   # 发布控制台 GUI 的自动化测试
├── playwright.config.ts           # Web 模式配置
├── playwright.electron.config.ts  # Electron 模式配置
└── playwright.release-gui.config.ts
```

## 运行

```bash
cd e2e
npm ci                              # 安装依赖
npx playwright install chromium     # 首次需要安装浏览器

# Web 模式（需要后端与前端 dev server 就绪，见根目录 npm run dev）
npx playwright test

# 指定单个文件 / 用例
npx playwright test flows/roundtrip.spec.ts

# 有头模式 / UI 调试
npx playwright test --headed
npx playwright test --ui

# 查看最近一次报告
npx playwright show-report
```

## 注意事项

- **需要后端运行**：Web 模式测试假定后端 + 前端 dev server 已启动（根目录 `npm run dev`）。AI 相关 spec 在检测不到可用 Provider（缺 API key）时会条件跳过，属预期行为。
- **CI 慢环境模拟**：本地复现 CI 上的时序类失败可用 `E2E_CPU_THROTTLE` / `E2E_API_DELAY` 环境变量注入降速。
- **调试连线类问题**：trace 里的 console 输出通常是决定性证据。
