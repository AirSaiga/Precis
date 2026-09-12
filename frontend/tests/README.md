# 前端单元测试目录

本目录只存放 **vitest 单元测试**，覆盖范围为**纯逻辑 `.ts` 模块**。前端整体采用 **E2E-first** 策略：UI 交互、Vue 组件、Pinia Store 组合逻辑由 `e2e/flows/` 中的 Playwright 测试覆盖。

## 单元测试 vs E2E 边界

| 范围                                                | 单元测试 (`frontend/tests/`)        | E2E (`e2e/flows/`) |
| --------------------------------------------------- | ----------------------------------- | ------------------ |
| 纯函数 / 工具类                                     | ✅ 必须覆盖                         | ❌ 不需要          |
| 服务层工厂 / 构建器 / 校验器                        | ✅ 必须覆盖                         | ❌ 不需要          |
| API 调用层（mock HTTP）                             | ✅ 覆盖                             | ❌ 不需要          |
| GraphStore 工厂模块（`createXxxModule`）            | ✅ 覆盖                             | ❌ 不需要          |
| Vue 组件 / `.vue`                                   | ❌ 原则不覆盖（挂载级回归例外见下） | ✅ E2E 覆盖        |
| Composables（依赖 Pinia/Vue Flow/Vue 响应式）       | ⚠️ 过渡存量见下                     | ✅ E2E 覆盖        |
| 普通 Pinia Store（canvasStore、expressionStore 等） | ❌ 不覆盖                           | ✅ E2E 覆盖        |
| 跨组件/跨 Store 的完整用户流程                      | ❌ 不覆盖                           | ✅ E2E 覆盖        |

> 详细策略见项目根目录 `AGENTS.md` 的 **Testing Strategy** 章节。

## 目录映射

```
frontend/tests/
├── api/              # API 调用层（mock HTTP）
├── components/       # 组件级回归测试（挂载级例外，见下）
├── composables/      # ⚠️ 过渡目录：理想情况下应迁移到 E2E
├── core/             # 基础设施纯函数（logger、utils、httpClient 等）
├── features/         # feature 内的纯逻辑子模块（如键盘平台检测、布局算法）
├── i18n/             # i18n 纯函数（locale 探测等）
├── services/         # 服务层：约束、builder、规则、断开连接处理等
├── shared/           # 共享纯工具函数
├── stores/           # 业务 Store 与 graphStore 工厂模块（见下）
└── utils/            # 通用工具函数
```

## 当前测试分类

### ✅ 适合保留在单元测试层

- `api/` — API 层纯函数与错误类型
- `core/` — logger、utils、httpClient、electronDetector 等纯逻辑
- `i18n/getInitialLocale.test.ts` — locale 探测纯函数
- `features/keyboard/platformDetector.test.ts` — 平台检测纯函数
- `features/keyboard/shortcutRegistry.test.ts` — 快捷键注册表纯类逻辑
- `features/nodeLayoutOrganizer/*.test.ts` — 布局计算纯算法
- `features/regex/*.test.ts` — regex 构建与提取纯逻辑
- `services/*` — 约束、builder、规则、断开连接处理等服务层逻辑
- `shared/`、`utils/` — 通用工具函数
- `stores/graphStore/` — GraphStore 工厂模块闭包与 v2 导入/持久化模块

### 🔒 挂载级回归测试（刻意例外）

`components/nodes/shared/nodePositionShell.test.ts` 是**挂载级**防 Vue 升级回归测试（节点渲染隔离壳的 attrs 稳定化依赖 Vue runtime-core 内部行为，须真挂载验证），属对"E2E-first"的刻意例外，勿按规范第 1 条迁走。

### ⚠️ 建议逐步迁移到 E2E

以下测试目前仍在 vitest 中运行，但按策略应由 E2E 覆盖。保留它们是为了过渡期不丢失断言，但新增类似测试时请优先写到 `e2e/flows/`。

- `tests/composables/` — `useGlobalConfirm`、`useTheme`（注：实际测试的是 `@/core/utils/theme` 纯函数，建议改名为 `tests/core/utils/theme.test.ts`）、`shared/useToast`、`shared/useStreamingMessage`、`validation/useValidationErrorFilter`、`canvas/useCanvasNodeOperations.dragPosition`、`nodes/connectionHandlers`、`nodes/json/useJsonSchemaValidation`、`nodes/shared/useSchemaDataBase`、`nodes/transform/transformCategory`、`resource/useResourceInteraction`
- `tests/stores/`（graphStore/ 除外）— `aiChatStore`、`appModeStore`、`canvasStore`、`canvasTabStore`、`dragStore`、`expressionStore`、`feedbackStore`、`projectStore`、`resourceDragStore`、`resourceTreeStore`、`scriptEditorStore`、`settingsNavStore`、`settingsPreferencesStore`、`shortcutStore`、`validationTaskStore`、`workspaceStore`

## 新增测试规范

1. **先判断归属**：如果要测的行为需要挂载组件、触发 Vue 生命周期、或依赖真实 Store 状态，请写到 `e2e/flows/`。
2. **只 mock 边界**：单元测试中只 mock 外部边界（HTTP、console、vueFlowApi 等），不要 mock 被测模块内部调用。
3. **禁止 snapshot**：所有断言必须精确描述预期行为。
4. **使用工厂函数**：测试数据通过 `makeXxx` 工厂生成，禁止内联硬编码。

## 覆盖率说明

覆盖率只统计 `src/**/*.ts` 中的纯逻辑文件，已排除 `composables/`、`features/`（跨层）、`components/`、`types/`、`index.ts` 等。

当前 `lines` 阈值设置为 **48%**（实际约 48.24%）。随着纯逻辑模块补全，应逐步提高阈值；Threshold 应始终略低于实际覆盖率，而不是高于它。
