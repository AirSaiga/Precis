# Precis 剩余工作清单

> 更新日期: 2026-06-06
> 基于: Phase 0-4 执行完成后的评估
> 状态: 13 项中 10 项已完成，3 项部分完成需要延续

---

## 一、总体进度

| 阶段 | 总项 | 完成 | 部分 | 未开始 |
|------|------|------|------|--------|
| Phase 0 止血 | 6 | 6 | 0 | 0 |
| Phase 1 安全加固 | 5 | 5 | 0 | 0 |
| Phase 2 可测试性 | 6 | 6 | 0 | 0 |
| Phase 3 画布交互 | 3 | 3 | 0 | 0 |
| Phase 4 并行执行 | 13 | 10 | 3 | 0 |

---

## 二、剩余工作项

---

### B-3: OpenAPI 文档补充（剩余部分）

**优先级**: 低
**预估工作量**: 2-4 小时
**文件范围**: `backend/app/api/routers/` 下的 AI、校验、预览路由

**当前状态**: V2 项目路由（`project/` 下 8 个文件）已完成，共 31 个端点已标注 `summary=`

**剩余**: 以下 22 个端点缺少 `summary=` 和 `responses=` 描述

#### ai/chat.py（2 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 48 | POST | `/chat` | AI 对话（流式响应） |
| 125 | POST | `/chat/completions` | AI 对话补全（非流式） |

#### validation/path_mode.py（3 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 69 | POST | `/validate/path` | 按文件路径校验数据 |
| 143 | POST | `/regex/path` | 按路径执行正则校验 |
| 226 | POST | `/validate/path/batch` | 批量路径校验 |

#### validation/content_mode.py（4 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 72 | POST | `/validate` | 按内容校验数据 |
| 123 | POST | `/validate/content` | 按内容校验数据（别名） |
| 234 | POST | `/regex` | 按内容执行正则校验 |
| 297 | POST | `/validate/batch` | 批量内容校验 |

#### validation/inline_mode.py（1 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 53 | POST | `/validate/inline` | 内联模式校验 |

#### validation/history.py（5 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 42 | POST | `` | 创建校验运行记录 |
| 60 | GET | `` | 获取校验运行列表 |
| 70 | GET | `/stats` | 获取校验统计信息 |
| 79 | GET | `/{run_id}` | 获取指定校验运行详情 |
| 88 | DELETE | `/{run_id}` | 删除校验运行记录 |

#### preview/path_mode.py（2 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 55 | POST | `/preview/file/path` | 按路径预览文件 |
| 309 | POST | `/preview/switch-sheet/path` | 按路径切换工作表 |

#### preview/content_mode.py（4 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 35 | POST | `/preview/file` | 按内容预览文件 |
| 76 | POST | `/preview/file/content` | 按内容预览文件（别名） |
| 120 | POST | `/preview/switch-sheet` | 按内容切换工作表 |
| 156 | POST | `/preview/switch-sheet/content` | 按内容切换工作表（别名） |

#### preview/header_row.py（1 个端点）

| 行号 | 方法 | 路径 | 建议 summary |
|------|------|------|-------------|
| 42 | POST | `/preview/header-row-changed` | 表头行变更后重新解析 |

**操作方式**: 参考已完成的 `project/schema.py` 等文件的格式，为每个端点添加 `summary=` 和 `responses=` 参数。

---

### C-2: eventBus 迁移（评估结论：已完成）

**优先级**: 不适用（已关闭）
**结论**: 8 处剩余 `window.addEventListener` 均为 DOM 物理事件，不适合迁移

| 文件 | 事件 | 性质 | 保留原因 |
|------|------|------|---------|
| `useCanvasLifecycle.ts:122` | keydown | 键盘快捷键（Ctrl+H） | 物理按键监听 |
| `usePreviewDisplay.ts:147-148` | mousemove + mouseup | 拖拽调整大小 | 连续鼠标坐标追踪 |
| `useSchemaResizable.ts:83-84` | mousemove + mouseup | 拖拽调整大小 | 同上 |
| `useJsonSchemaResizable.ts:79-80` | mousemove + mouseup | 拖拽调整大小 | 同上 |
| `useResourceContextMenu.ts:415` | keydown | ESC 关闭菜单 | 物理按键监听 |

这些是 DOM 级别的物理事件监听（鼠标移动、按键），需要精确的坐标和时序信息，不适合通过应用层事件总线传递。`eventBus.ts` 已成功覆盖了所有应用级事件的解耦需求（20+ 事件类型）。

---

### D-3: 测试覆盖率提升

**优先级**: 中
**预估工作量**: 持续投入，每轮 2-3 天
**当前状态**: 前端覆盖率远低于阈值，CI 未强制拦截失败

#### 前端覆盖率现状

| 指标 | 当前值 | 阈值 | 目标值 | 差距 |
|------|--------|------|--------|------|
| Lines | ~4% | 35% | 50% | -46pp |
| Branches | ~3% | 25% | 40% | -37pp |
| Functions | ~4% | 30% | 45% | -41pp |

> **注**: vitest v8 provider 的阈值检查在当前版本下不会导致 CI 失败（退出码仍为 0），仅输出警告。需要确认 vitest 版本是否支持 `--coverage.failOnThreshold` 或等效配置。

#### 前端各模块覆盖率（按优先级排序）

| 优先级 | 模块 | 当前行覆盖率 | 目标 | 建议新增用例数 |
|--------|------|-------------|------|--------------|
| D-3a | `src/components/` | 0% | 30% | ~40 |
| D-3b | `src/services/` | 2% | 50% | ~35 |
| D-3c | `src/composables/` | 10% | 40% | ~50 |
| D-3d | `src/stores/` | 18% | 50% | ~30 |
| D-3e | `src/features/` | ~5% | 40% | ~25 |

#### 后端覆盖率现状

| 指标 | 当前值 | CI 阈值 | 目标值 | 差距 |
|------|--------|---------|--------|------|
| Lines | 57% | 56% | 70% | -13pp |

#### 后端各模块补充优先级

| 优先级 | 模块 | 建议 |
|--------|------|------|
| D-3f | `services/llm/actions/` | 补充 action_handler 和 regex_handler 测试 |
| D-3g | `core/project/manifest/` | 补充 writer 边界场景测试 |
| D-3h | `services/validation/` | 补充分块加载和内存监控测试 |

#### 推荐执行策略

1. **紧急**: 修复 vitest 覆盖率阈值强制失败机制，确保 CI 能拦截覆盖率回退
2. **短期**: 先将阈值降至实际覆盖率附近（如 lines: 5%, branches: 4%, functions: 5%），然后渐进提升
3. **中期**: 每次新增功能时同步补充测试，每轮提升 5%

---

## 三、已知的 TODO 功能桩

以下是代码中标记为 TODO 的未完成功能，不属于审查修复范围，属于产品功能待开发项：

### 3-1: validation error navigator 节点自动创建

- **文件**: `frontend/src/composables/validation/useValidationErrorNavigator.ts:33`
- **TODO**: `// TODO: 调用 importV2ResourceToCanvas 创建节点`
- **现状**: 当校验错误引用了画布上不存在的节点时，代码返回 `false` 并输出警告
- **期望行为**: 自动调用 `importV2ResourceToCanvas` 将节点创建到画布上
- **预估工作量**: 1-2 天

### 3-2: schemaResourceSync 独立约束加载

- **文件**: `frontend/src/services/schemaResourceSync.ts:258`
- **TODO**: `// TODO: Phase 2 - 遍历 V2 constraints，加载 refs.table_id 匹配的独立约束`
- **现状**: `loadIndependentConstraints()` 返回 0，不加载任何独立约束
- **期望行为**: 根据 schema 关联的 table_id 自动加载独立的约束文件
- **预估工作量**: 2-3 天

### 3-3: schemaResourceSync 正则节点加载

- **文件**: `frontend/src/services/schemaResourceSync.ts:266`
- **TODO**: `// TODO: Phase 2 - 遍历 V2 regex_nodes，加载 source_ref.table_id 匹配的正则`
- **现状**: `loadRegexNodes()` 返回 0，不加载任何正则节点
- **期望行为**: 根据 schema 关联自动加载匹配的正则节点
- **预估工作量**: 1-2 天

---

## 四、执行优先级总览

| 优先级 | 编号 | 任务 | 工作量 | 依赖 |
|--------|------|------|--------|------|
| **高** | D-3 | 修复 vitest 覆盖率 CI 强制失败 + 降低阈值到实际水平 | 0.5 天 | 无 |
| **中** | D-3 | 前端覆盖率渐进提升（components → services → composables） | 持续 | D-3 修复 |
| **中** | D-3 | 后端覆盖率提升到 70% | 持续 | 无 |
| **低** | B-3 | AI/validation/preview 路由 OpenAPI 文档 | 2-4 小时 | 无 |
| **低** | 3-2 | schemaResourceSync 独立约束加载 | 2-3 天 | 功能开发 |
| **低** | 3-3 | schemaResourceSync 正则节点加载 | 1-2 天 | 功能开发 |
| **低** | 3-1 | validation error navigator 自动创建节点 | 1-2 天 | 功能开发 |
| **关闭** | C-2 | eventBus 迁移 | 已完成 | 不适用 |

---

## 五、已完成工作归档（Phase 0-4 全量）

### Phase 0 止血（6/6 完成）
- 0-1: 删除 `loader.py` 命名冲突文件
- 0-2: `connectionPolicyService.ts` 度数校验修复
- 0-3: `templateExpand.ts` 不可变数组替换（14 处）
- 0-4: DOM `<style>` 注入替换为 `@/core/toast`
- 0-5: `simpleConstraint.ts` Set 构造修复 + `structuredClone` 替换
- 0-6: `simpleConstraint.ts` dateLogic Builder 字段对齐

### Phase 1 安全加固（5/5 完成）
- 1-1: `scripted.py` 安全门修复（`is not True` 防止 np.bool_ 绕过）
- 1-2: V2 校验路径 `allow_unsafe_eval` 强制 `False`
- 1-3: `action_processor.py` 路径穿越防护
- 1-4: AI jobs 并发安全加锁
- 1-5: Electron IPC 路径穿越防护

### Phase 2 可测试性（6/6 完成）
- 2-1: strictNullChecks 评估 → 后续 Stream A 完成
- 2-2: registryIntegrity 测试扩展（前后端一致性 + Builder 映射）
- 2-3: connectionStateSync 单测（11 用例）
- 2-4: history 模块单测（11 用例）+ `structuredClone`/reactive proxy bug 修复
- 2-5: 后端 LLM 安全测试（24 用例）
- 2-6: CI 覆盖率门控

### Phase 3 画布交互（3/3 完成）
- 3-1: box-select 硬编码尺寸 → `GraphNode.dimensions`
- 3-2: stores/ 下 `JSON.parse(JSON.stringify)` 全部清理
- 3-3: 后端 `loader.py` 缓存死代码清理

### Phase 4 并行执行（10/13 完成）
- **Stream A**: `strictNullChecks: true` — 395 个错误全部修复
- **Stream B-1**: `loaders/registry.py` 死代码清理（5 个函数删除）
- **Stream B-2**: `create_tempated_parser` → `create_templated_parser` 全局重命名
- **Stream B-3**: V2 路由 OpenAPI 文档完成（31 端点）
- **Stream C-1**: `connectionRuleTypes.ts` 类型提取
- **Stream C-2**: `eventBus.ts` 创建（20+ 事件类型）
- **Stream C-3**: `setup.ts` 拆分（1066 行 → 4 文件）
- **Stream C-4**: `GraphStoreLike` + `ProjectStoreLike` 接口定义
- **Stream D-1**: CI Electron 编译检查
- **Stream D-2**: Electron sandbox + webSecurity 修复
- **Stream E-1**: `ChunkedDataLoader` + `MemoryMonitor` 分块加载
- **Stream E-2**: 12 个 Playwright E2E 测试 + CI 集成

### 变更统计
- 修改文件: 156 个
- 代码行数: +1,640 / -2,064（净减 424 行）
- 新增测试: 前端 295 用例（+93）、后端 1360 用例（+28）、E2E 12 用例
