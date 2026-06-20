# 前端单元测试目录

本目录只存放 **vitest 单元测试**，覆盖范围为**纯逻辑 `.ts` 模块**。前端整体采用 **E2E-first** 策略：UI 交互、Vue 组件、Pinia Store 组合逻辑由 `e2e/flows/` 中的 Playwright 测试覆盖。

## 单元测试 vs E2E 边界

| 范围                                                | 单元测试 (`frontend/tests/`) | E2E (`e2e/flows/`) |
| --------------------------------------------------- | ---------------------------- | ------------------ |
| 纯函数 / 工具类                                     | ✅ 必须覆盖                  | ❌ 不需要          |
| 服务层工厂 / 构建器 / 校验器                        | ✅ 必须覆盖                  | ❌ 不需要          |
| API 调用层（mock HTTP）                             | ✅ 覆盖                      | ❌ 不需要          |
| GraphStore 工厂模块（`createXxxModule`）            | ✅ 覆盖                      | ❌ 不需要          |
| Vue 组件 / `.vue`                                   | ❌ 不覆盖                    | ✅ E2E 覆盖        |
| Composables（依赖 Pinia/Vue Flow/Vue 响应式）       | ❌ 不覆盖                    | ✅ E2E 覆盖        |
| 普通 Pinia Store（canvasStore、expressionStore 等） | ❌ 不覆盖                    | ✅ E2E 覆盖        |
| 跨组件/跨 Store 的完整用户流程                      | ❌ 不覆盖                    | ✅ E2E 覆盖        |

> 详细策略见项目根目录 `AGENTS.md` 的 **Testing Strategy** 章节。

## 目录映射

```
frontend/tests/
├── api/              # API 调用层（mock HTTP）
├── core/             # 基础设施纯函数（logger、utils、httpClient 等）
├── features/         # feature 内的纯逻辑子模块（如键盘平台检测、布局算法）
├── services/         # 服务层：约束、builder、规则、断开连接处理等
├── shared/           # 共享纯工具函数
├── stores/graphStore/# GraphStore 工厂模块（仅限 createXxxModule 闭包）
├── utils/            # 通用工具函数
└── composables/      # ⚠️ 过渡目录：理想情况下应迁移到 E2E
└── stores/           # ⚠️ 过渡目录：除 graphStore/modules 外，理想情况下应迁移到 E2E
```

## 当前测试分类

### ✅ 适合保留在单元测试层

- `api/` — API 层纯函数与错误类型
- `core/` — logger、utils、httpClient、electronDetector 等纯逻辑
- `features/keyboard/platformDetector.test.ts` — 平台检测纯函数
- `features/keyboard/shortcutRegistry.test.ts` — 快捷键注册表纯类逻辑
- `features/nodeLayoutOrganizer/*.test.ts` — 布局计算纯算法
- `features/regex/*.test.ts` — regex 构建与提取纯逻辑
- `services/*` — 约束、builder、规则、断开连接处理等服务层逻辑
- `shared/`、`utils/` — 通用工具函数
- `stores/graphStore/modules/` — GraphStore 工厂模块闭包

### ⚠️ 建议逐步迁移到 E2E

以下测试目前仍在 vitest 中运行，但按策略应由 E2E 覆盖。保留它们是为了过渡期不丢失断言，但新增类似测试时请优先写到 `e2e/flows/`。

- `tests/composables/useGlobalConfirm.test.ts`
- `tests/composables/useTheme.test.ts`（注：实际测试的是 `@/core/utils/theme` 纯函数，建议改名为 `tests/core/utils/theme.test.ts`）
- `tests/composables/shared/useToast.test.ts`
- `tests/composables/validation/useValidationErrorFilter.test.ts`
- `tests/stores/canvasStore.test.ts`
- `tests/stores/dragStore.test.ts`
- `tests/stores/expressionStore.test.ts`
- `tests/stores/projectStore.test.ts`
- `tests/stores/resourceDragStore.test.ts`
- `tests/stores/resourceTreeStore.test.ts`
- `tests/stores/scriptEditorStore.test.ts`
- `tests/stores/shortcutStore.test.ts`
- `tests/stores/validationTaskStore.test.ts`

## 新增测试规范

1. **先判断归属**：如果要测的行为需要挂载组件、触发 Vue 生命周期、或依赖真实 Store 状态，请写到 `e2e/flows/`。
2. **只 mock 边界**：单元测试中只 mock 外部边界（HTTP、console、vueFlowApi 等），不要 mock 被测模块内部调用。
3. **禁止 snapshot**：所有断言必须精确描述预期行为。
4. **使用工厂函数**：测试数据通过 `makeXxx` 工厂生成，禁止内联硬编码。

## 覆盖率说明

覆盖率只统计 `src/**/*.ts` 中的纯逻辑文件，已排除 `composables/`、`features/`（跨层）、`components/`、`types/`、`index.ts` 等。

当前 `lines` 阈值设置为 **48%**（实际约 48.24%）。随着纯逻辑模块补全，应逐步提高阈值；Threshold 应始终略低于实际覆盖率，而不是高于它。
