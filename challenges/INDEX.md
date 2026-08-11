# 题目索引

人工查阅用，机器不消费。状态：`✅ ready` / `🚧 stub`（task.md 写了但 workspace 未填）/ `💡 idea`（仅本表一行，目录未建）。

| ID    | 维度       | 栈       | 难度 | 一句话                           | 状态     |
|-------|-----------|---------|------|----------------------------------|---------|
| C01   | nav       | Python  | ★☆☆  | 新增 MaxLength 约束（照葫芦画瓢）   | ✅ ready |
| C02   | nav       | Python  | ★★☆  | 分块加载 500MB 阈值 + 复现跨块 Unique 假阴性（per-chunk → 全量频次，按 chunk 定位） | ✅ ready |
| C04   | nav       | TS      | ★☆☆  | 补全 vueFlowApi 单例注入层（initVueFlowApi + requireApi 守卫） | ✅ ready |
| C05   | nav       | TS      | ★★☆  | 修复双注册表断裂的 barrel（理解 side-effect import 自注册） | ✅ ready |
| C07   | inc       | Python  | ★☆☆  | 加新 datetime 数据类型（scalars 新类 + TYPE_REGISTRY 注册） | ✅ ready |
| C08   | inc       | Python  | ★★☆  | 加新 AI actionType（同步 registry + actions.ts） | ✅ ready |
| C09   | inc       | Python  | ★★★  | 后端三层加约束 LengthConstraint（domain 类 + 注册表，service/api 通用无需改） | ✅ ready |
| C10   | inc       | TS      | ★☆☆  | 加新约束节点 NotBlank（5 处注册：meta/builder/handler/nodes/i18n） | ✅ ready |
| C11   | inc       | TS      | ★★☆  | 加新能力 clipboardApi（interface + Electron/Web 适配器 + 单例 + 消费方） | ✅ ready |
| C13   | dbg       | Python  | ★☆☆  | 修复校验辅助函数 3 个明显 bug（逻辑反转 / off-by-one / 缺 None 守卫） | ✅ ready |
| C14   | dbg       | Python  | ★★☆  | 修复跨块 Unique 漏检（concat-then-duplicated，全局行号映射） | ✅ ready |
| C15   | dbg       | Python  | ★★★  | 修复 collect_paths 丢失 include_router 子路由（FastAPI 0.138+ _IncludedRouter） | ✅ ready |
| C16   | dbg       | TS      | ★☆☆  | 修复 createGraphEdges 静默丢边（Vue Flow setEdges 陷阱） | ✅ ready |
| C17   | dbg       | TS      | ★★☆  | 给键盘监听器加 IME 合成态守卫（isComposing / keyCode 229） | ✅ ready |
| C18   | dbg       | TS      | ★★★  | 修复 nodes.value.push 不触发 watcher（赋值换引用 vs mutation） | ✅ ready |
| C19   | refactor  | Python  | ★☆☆  | 给未注解的辅助函数补完整类型注解    | ✅ ready |
| C20   | refactor  | Python  | ★★☆  | 提取 4 个 _format_* 到 formatters.py（处方式：精确符号 + 改公开） | ✅ ready |
| C21   | refactor  | Python  | ★★★  | 命令式嵌套校验循环重构成 4-stage pipeline（处方式：精确 stage 名 + process 只编排） | ✅ ready |
| C22   | refactor  | TS      | ★☆☆  | 清理 `as unknown as` 双重断言       | ✅ ready |
| C23   | refactor  | TS      | ★★☆  | 处方式抽取 useCounter composable（.vue 两组逻辑分离其一，照搬 useModal 模式） | ✅ ready |

## 维度缩写

- `nav` — 代码库导航与理解
- `inc` — 跨文件跨层增量开发
- `dbg` — 调试与 bug 修复
- `refactor` — 重构与代码质量

## 难度

- `★☆☆` — 10-20 分钟，能用的 agent 都该做对
- `★★☆` — 中等，需要跨文件理解或处理边缘情况
- `★★★` — 难，涉及架构陷阱或深层调试
