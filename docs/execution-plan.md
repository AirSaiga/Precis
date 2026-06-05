# Precis 审查修复执行计划

> 生成日期: 2026-06-05
> 状态: Phase 0-3 已完成，Phase 4+ 待执行
> 策略: 5 条独立工作流并行，每条工作流在独立 Git 分支上执行

---

## 已完成工作（Phase 0-3）

### Phase 0 止血（6 项）
- 0-1: 删除 `backend/app/shared/core/project/loader.py`（与 `loader/` 包命名冲突）
- 0-2: `connectionPolicyService.ts` 度数校验修复 — `isValidConnection`/`getAllowedTargets` 增加 `edges` 参数
- 0-3: `templateExpand.ts` — 14 处直接修改 style/width/height 改为不可变数组替换
- 0-4: DOM `<style>` 注入替换为 `@/core/toast`
- 0-5: `simpleConstraint.ts` Set 构造修复 + `structuredClone` 替换 `JSON.parse(JSON.stringify)`
- 0-6: `simpleConstraint.ts` dateLogic Builder 字段对齐

### Phase 1 安全加固（5 项）
- 1-1: `scripted.py` 安全门从 `not kwargs.get(...)` 改为 `kwargs.get(...) is not True`
- 1-2: V2 校验路径 `allow_unsafe_eval` 强制 `False`
- 1-3: `action_processor.py` 新增 `_safe_resolve()` 和 `_sanitize_id()` 防路径穿越
- 1-4: AI jobs 状态修改加 `_jobs_lock`
- 1-5: Electron IPC 路径穿越防护

### Phase 2 可测试性（6 项）
- 2-1: strictNullChecks 评估（395 个错误，需独立 PR，已回退）
- 2-2: registryIntegrity 测试扩展
- 2-3: connectionStateSync 单测（11 个用例）
- 2-4: history 模块单测（11 个用例）+ 修复 structuredClone/reactive proxy bug
- 2-5: 后端 LLM 安全测试（24 个用例）
- 2-6: CI 覆盖率门控（前端 30% / 后端 55%）

### Phase 3 画布交互（3 项）
- 3-1: box-select 硬编码尺寸 → `GraphNode.dimensions` 动态获取
- 3-2: stores/ 下 `JSON.parse(JSON.stringify)` 全部清理
- 3-3: 后端 `loader.py` 缓存死代码清理

---

## 待执行工作

---

## Stream A — 前端类型安全

**分支名**: `fix/strict-null-checks`
**预估工作量**: 3-5 天
**前置条件**: 无
**冲突风险**: 与 Stream C 可能有文件级冲突，建议先于 C 合并

### A-1: 启用 strictNullChecks

**目标**: 将 `frontend/tsconfig.app.json` 中的 `strictNullChecks: false` 改为 `true`

**操作步骤**:
1. 修改 `frontend/tsconfig.app.json`:
   ```json
   "strictNullChecks": true
   ```
2. 运行 `npm run type-check` 收集全部错误清单
3. 按目录分批修复，每批修复后运行 type-check 确认进度

**修复模式参考**:
- 函数参数可能为 null → 添加空值守卫 `if (!x) return`
- DOM 查询返回 `T | null` → 使用可选链 `el?.addEventListener(...)`
- 数组查找 `find()` 返回 `T | undefined` → 添加存在性检查
- Ref.value 可能为 undefined → 添加 `if (ref.value === undefined) return`
- 事件回调参数类型收窄 → 使用类型谓词

**分批策略**（按错误密度排序，优先修复简单文件）:

| 批次 | 目录 | 预估错误数 | 说明 |
|------|------|-----------|------|
| A-1a | `src/types/` | ~10 | 类型定义，多为简单修复 |
| A-1b | `src/core/` | ~20 | 工具函数，独立性强 |
| A-1c | `src/api/` | ~15 | API 层，response 类型可断言 |
| A-1d | `src/services/` | ~60 | 约束/画布服务，中等复杂 |
| A-1e | `src/composables/` | ~80 | composable 层，数量最多 |
| A-1f | `src/stores/` | ~100 | store 层，相互引用多 |
| A-1g | `src/components/` | ~80 | Vue 组件，模板中的类型 |
| A-1h | `src/features/` | ~30 | 功能模块 |

**验证命令**:
```bash
cd frontend && npm run type-check && npm run lint && npm run test
```

**注意事项**:
- 不修改运行时逻辑，只添加类型守卫和空值检查
- 禁止使用 `as any` 绕过，必要时用 `as Type` 并添加注释说明原因
- 每批修复独立提交，commit message 格式: `fix(types): strictNullChecks - batch N (directory)`

---

## Stream B — 后端清理与文档

**分支名**: `chore/backend-cleanup`
**预估工作量**: 2-3 天
**前置条件**: 无
**冲突风险**: 无（纯后端）

### B-1: 清理 loaders/registry.py 双注册表死代码

**目标**: 移除 `loaders/registry.py` 中未被查询的注册表机制

**背景**: `core/data_source/loader.py` 有自己的 `_LOADER_FNS` 字典和 `LOADER_REGISTRY`，而 `loaders/registry.py` 有另一套 `LOADER_REGISTRY`。加载器类使用 `@register_loader` 装饰器注册自己，但实际加载通过 `_LOADER_FNS` 分派，`loaders/registry.py` 中的 `get_loader_for_spec()`、`get_loader_class_for_type()` 等函数从未被调用。

**操作步骤**:
1. 确认 `loaders/registry.py` 中以下函数无外部调用者:
   - `get_loader_for_spec()`
   - `get_loader_class_for_type()`
   - `supports_source_type()`
   - `get_supported_types()`
   - `register_loader_class()`
2. 移除这些死函数，仅保留 `register_loader` 装饰器（被各 loader 使用）
3. 更新 `loaders/__init__.py` 的 re-export 列表
4. 运行全量测试确认无破坏

**验证命令**:
```bash
cd backend && python -m ruff check . && python -m pytest
```

### B-2: 修复 create_tempated_parser 拼写

**目标**: 将 `create_tempated_parser` 重命名为 `create_templated_parser`

**操作步骤**:
1. 在 `expression_system.py` 中将函数名改为 `create_templated_parser`
2. 删除 line 353 的别名 `create_templated_parser = create_tempated_parser`
3. 全局搜索替换所有引用:
   - `app/shared/domain/expression_system.py`
   - `app/shared/domain/__init__.py`
   - `app/shared/core/patterns/loader.py`
   - `tests/unit/test_expression_system.py`
4. 更新文档字符串中的引用

**验证命令**:
```bash
cd backend && python -m ruff check . && python -m pytest
```

### B-3: 补充 OpenAPI 文档

**目标**: 为所有 API 端点添加 `summary`、`description`、`response_model` 描述

**操作步骤**:
1. 列出 `backend/app/api/routers/` 下所有路由文件
2. 为每个端点添加:
   - `summary`: 一句话描述（中文）
   - `description`: 详细说明，包含请求/响应示例
   - `responses`: 明确的状态码和响应模型
3. 优先处理 V2 API 端点（用户直接使用的）
4. 验证: 启动后端，访问 `/docs` 确认文档渲染正确

**验证命令**:
```bash
cd backend && python -m pytest && python -m uvicorn app.main:app --port 18000
# 浏览器访问 http://localhost:18000/docs
```

**优先级排序**:

| 顺序 | 路由文件 | 端点数 | 说明 |
|------|---------|--------|------|
| B-3a | `routers/v2/` | ~15 | V2 核心 API，最高优先 |
| B-3b | `routers/ai/` | ~5 | AI 功能端点 |
| B-3c | `routers/validation.py` | ~3 | 校验端点 |
| B-3d | `routers/preview.py` | ~3 | 数据预览 |
| B-3e | 其余路由 | ~5 | 配置、健康检查等 |

---

## Stream C — 前端 Store 重构链

**分支名**: `refactor/frontend-store-chain`
**预估工作量**: 5-7 天
**前置条件**: Stream A 合并后 rebase（避免类型冲突）
**冲突风险**: 与 Stream A 有文件重叠，必须串行合并

### C-1: connection_rules.ts 内联模型迁移

**目标**: 将 `connectionRules.ts` 中的内联类型定义迁移到 `api/models/` 或 `types/`

**操作步骤**:
1. 读取 `services/rules/connectionRules.ts`，识别所有内联接口和类型
2. 在 `types/` 下创建 `connection.ts`，定义:
   - `ConnectionRule` 接口
   - `HandleType` 类型
   - `ValidationResult` 类型
3. 将 `connectionRules.ts` 中的内联类型替换为导入
4. 确保 `connectionPolicyService.ts` 的导入路径更新

**验证命令**:
```bash
cd frontend && npm run type-check && npm run lint && npm run test
```

### C-2: window.addEventListener 重构

**目标**: 将散落在各 composable 中的 `window.addEventListener` 迁移到 Vue 的 provide/inject 或 mitt 事件总线

**操作步骤**:
1. 搜索所有使用 `window.addEventListener` 的 composable:
   ```bash
   rg "window\.addEventListener" src/composables/
   ```
2. 在 `core/` 下创建 `eventBus.ts`（基于 mitt 或 tiny-emitter）:
   ```typescript
   // core/eventBus.ts
   import mitt from 'mitt'
   export const eventBus = mitt<Record<string, unknown>>()
   ```
3. 逐个 composable 迁移:
   - 移除 `window.addEventListener`
   - 改为 `eventBus.on('event-name', handler)`
   - 在对应组件中 `eventBus.emit('event-name', payload)`
4. 确保 `onUnmounted` 中正确清理监听器

**验证命令**:
```bash
cd frontend && npm run type-check && npm run lint && npm run test
```

### C-3: setup.ts 拆分

**目标**: 将 1066 行的 `graphStore/setup.ts` 拆分为多个领域 store 切片

**当前结构** (`setup.ts` 1066 行):
- 状态声明: nodes, edges, selectedNodeId, etc. (line 130-200)
- 模块组装: ~20 个 createXxxModule() 工厂调用 (line 600-900)
- 计算属性和 getter (line 400-600)
- 公共方法暴露 (line 900-1066)

**拆分策略**:

| 新文件 | 职责 | 从 setup.ts 移出的内容 |
|--------|------|----------------------|
| `setup/state.ts` | 状态声明 + 基础 ref | nodes, edges, selectedNodeId 等所有 ref 声明 |
| `setup/getters.ts` | 计算属性 | 所有 computed 属性 |
| `setup/assembly.ts` | 模块组装 | createXxxModule() 调用和返回值聚合 |
| `setup/index.ts` | 入口 | 调用上述三个模块，导出最终 store |

**操作步骤**:
1. 创建 `setup/state.ts` — 导出所有 ref 声明
2. 创建 `setup/getters.ts` — 导出所有 computed
3. 创建 `setup/assembly.ts` — 模块工厂调用
4. 重写 `setup/index.ts` — 组合以上模块
5. 运行 type-check 确认所有导入路径正确
6. 运行全量测试确认功能无回归

**注意事项**:
- 不改变任何运行时行为，纯文件级拆分
- 保持所有模块工厂的依赖注入模式不变
- 每个新文件不超过 300 行

**验证命令**:
```bash
cd frontend && npm run type-check && npm run lint && npm run test
```

### C-4: 跨 store 耦合打破

**目标**: 用 `GraphStoreLike` 接口 + 事件总线解耦 graphStore ⇄ canvasTabStore ⇄ projectStore

**操作步骤**:
1. 在 `types/` 下定义 `GraphStoreLike` 接口:
   ```typescript
   export interface GraphStoreLike {
     nodes: Ref<CustomNode[]>
     edges: Ref<Edge[]>
     updateNodeData: (nodeId: string, data: Partial<CustomNodeData>) => void
     // ... 最小公共接口
   }
   ```
2. 让 graphStore 实现该接口
3. canvasTabStore 和 projectStore 通过接口类型引用 graphStore，而非直接导入
4. 将 store 间的方法调用改为事件总线通信

**验证命令**:
```bash
cd frontend && npm run type-check && npm run lint && npm run test
```

---

## Stream D — Electron + CI

**分支名**: `ci/electron-and-coverage`
**预估工作量**: 2-3 天
**前置条件**: 无
**冲突风险**: 无（CI/Electron 文件独立）

### D-1: CI 加入 Electron 编译检查

**目标**: GitHub Actions 中添加 Electron TypeScript 编译验证

**操作步骤**:
1. 在 `.github/workflows/ci.yml` 添加新 job `electron`:
   ```yaml
   electron:
     name: Electron Build Check
     runs-on: ubuntu-latest
     defaults:
       run:
         working-directory: electron
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 22
           cache: npm
           cache-dependency-path: electron/package-lock.json
       - run: npm ci
       - run: npm run build  # 或 npx tsc --noEmit
   ```
2. 验证: 推送分支后在 GitHub Actions 中观察结果

**验证**: 推送后检查 CI 状态

### D-2: Electron sandbox + webSecurity

**目标**: 启用 `sandbox: true`，移除 `webSecurity: false`

**操作步骤**:
1. 在 `electron/src/main.ts` 的 `BrowserWindow` 配置中:
   - 设置 `webPreferences.sandbox: true`
   - 移除 `webPreferences.webSecurity: false`（如果存在）
2. 检查 `preload.ts` 中是否使用了不兼容 sandbox 的 API（如 `require`）
3. 如果 preload 使用了 `require`，改用 `contextBridge` + `ipcRenderer` 模式
4. 测试: 启动 Electron 应用，验证所有 IPC 功能正常

**验证命令**:
```bash
npm run electron:dev
```

### D-3: 覆盖率阈值渐进提升

**目标**: 将覆盖率阈值从当前水平逐步提升到目标值

**当前状态**:
- 前端: 30%（目标 50%）
- 后端: 55%（目标 70%）

**操作步骤（前端）**:
1. 识别未覆盖的关键模块:
   ```bash
   cd frontend && npm run test -- --coverage
   ```
2. 按模块补充测试（优先级排序）:

| 优先级 | 模块 | 目标覆盖率 | 预估新增用例数 |
|--------|------|-----------|--------------|
| D-3a | `services/constraints/` | 80% | ~30 |
| D-3b | `services/rules/` | 70% | ~15 |
| D-3c | `composables/canvas/` | 50% | ~20 |
| D-3d | `stores/graphStore/modules/` | 50% | ~25 |

3. 每提升 5% 更新一次 `vite.config.ts` 的阈值
4. 最终目标: `thresholds: { lines: 50, branches: 40, functions: 45 }`

**操作步骤（后端）**:
1. 识别未覆盖的关键模块:
   ```bash
   cd backend && python -m pytest --cov=app --cov-report=term-missing
   ```
2. 按模块补充测试:

| 优先级 | 模块 | 目标覆盖率 |
|--------|------|-----------|
| D-3e | `services/llm/actions/` | 70% |
| D-3f | `services/validation/` | 80% |
| D-3g | `core/project/` | 70% |

3. 每提升 5% 更新 CI 的 `--cov-fail-under` 值
4. 最终目标: `--cov-fail-under=70`

---

## Stream E — 后端性能与 E2E

**分支名**: `feat/backend-perf-and-e2e`
**预估工作量**: 3-4 天
**前置条件**: 无
**冲突风险**: E1 纯后端，E2 新建目录，均无冲突

### E-1: 校验引擎流式/分块处理

**目标**: 支持大文件（>1GB）校验不崩溃

**操作步骤**:
1. 分析当前校验流程瓶颈:
   - 读取 `services/validation/executor.py` 的数据加载阶段
   - 识别 `pandas` 全量加载的内存峰值
2. 实现分块读取:
   - 对 CSV/Excel 使用 `chunksize` 参数分块读取
   - 对每块独立执行约束校验
   - 合并校验结果
3. 添加内存监控:
   - 校验前检查文件大小
   - 超过阈值（如 500MB）自动切换分块模式
   - 在日志中记录内存使用情况
4. 更新 API 响应格式，添加进度信息

**验证命令**:
```bash
cd backend && python -m pytest tests/unit/ -k validation
# 手动测试: 准备大文件（>100MB）进行校验
```

### E-2: Playwright E2E 测试基础设施

**目标**: 建立 E2E 测试框架，覆盖核心用户流程

**操作步骤**:
1. 安装 Playwright:
   ```bash
   npm init playwright@latest
   ```
2. 创建测试目录结构:
   ```
   e2e/
   ├── fixtures/
   │   ├── test-project/        # 测试用项目配置
   │   │   ├── project.precis.yaml
   │   │   ├── schemas/
   │   │   └── data/
   │   └── base.ts              # 共享 fixture
   ├── flows/
   │   ├── create-project.spec.ts
   │   ├── add-schema.spec.ts
   │   ├── bind-datasource.spec.ts
   │   ├── add-constraint.spec.ts
   │   └── run-validation.spec.ts
   └── playwright.config.ts
   ```
3. 编写核心流程测试:
   - 创建项目 → 添加 Schema → 绑定数据源 → 添加约束 → 执行校验
   - 每步断言 UI 状态变化
4. CI 集成: 添加 E2E job（需要后端运行）

**验证命令**:
```bash
npx playwright test
```

---

## 执行时间线

```
Week 1-2:
  Stream A ──── A-1a ── A-1b ── A-1c ── A-1d ──────────────────→ 合并
  Stream B ──── B-1 ──── B-2 ──────────────────────────────────→ 合并
  Stream D ──── D-1 ──── D-2 ──────────────────────────────────→ 合并
  Stream E ──── E-1 ────────────────────────────────────────────→ 合并

Week 2-3:
  Stream A ──── A-1e ── A-1f ── A-1g ── A-1h ─────────────────→ 合并
  Stream B ──── B-3a ── B-3b ── B-3c ── B-3d ── B-3e ────────→ 合并
  Stream D ──── D-3a ── D-3b ── D-3c ── D-3e ── D-3f ── D-3g → 合并
  Stream E ──── E-2 ────────────────────────────────────────────→ 合并

Week 3-4 (A 合并后启动 C):
  Stream C ──── C-1 ── C-2 ── C-3 ── C-4 ─────────────────────→ 合并
```

## 合并策略

1. **Stream A 先合并** — 类型注解是其他前端工作的基础
2. **B/D/E 可随时合并** — 无文件冲突，直接 merge
3. **Stream C 在 A 合并后启动** — C 在 A 分支基础上 rebase，避免冲突
4. **每条 Stream 完成后独立 PR**，每个 PR 包含完整的验证结果

## 验证清单（每个 PR 必须通过）

```bash
# 前端
cd frontend && npm run type-check && npm run lint && npm run test

# 后端
cd backend && python -m ruff check . && python -m ruff format --check . && python -m pytest

# 全量
npm run lint:all && npm run format:all
```
