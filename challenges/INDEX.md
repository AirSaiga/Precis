# 题目索引

人工查阅用，机器不消费。状态：`✅ ready` / `🚧 stub`（task.md 写了但 workspace 未填）/ `💡 idea`（仅本表一行，目录未建）。

| ID    | 维度       | 栈       | 难度 | 一句话                           | 状态     |
|-------|-----------|---------|------|----------------------------------|---------|
| C01   | nav       | Python  | ★☆☆  | 新增 MaxLength 约束（照葫芦画瓢）   | ✅ ready |
| C02   | nav       | Python  | ★★★  | 分块加载 500MB 阈值 + 复现跨块 Unique 假阴性（全量频次 + 缺失值排除 + 非字符串列） | ✅ ready |
| C03   | nav       | Python  | ★★★  | 理解 planner→executor→tool_registry 调度链 + 自行定位导出链路全部缺失工具（executor 静默跳过未注册工具） | ✅ ready |
| C04   | nav       | TS      | ★☆☆  | 补全 vueFlowApi 单例注入层（initVueFlowApi + requireApi 守卫） | ✅ ready |
| C05   | nav       | TS      | ★★★  | 修复双注册表断裂的 barrel（side-effect import 自注册 + 对外 API 面再导出，双断点） | ✅ ready |
| C06   | nav       | TS      | ★★★  | 理解 V2 导入调用图（assembly→importConfig→createNode）+ 补齐 transform/template 两类注册（静默丢弃模式，seed 用 .js 跑 node） | ✅ ready |
| C07   | inc       | Python  | ★☆☆  | 加新 datetime 数据类型（scalars 新类 + TYPE_REGISTRY 注册） | ✅ ready |
| C08   | inc       | Python  | ★★☆  | 加新 AI actionType（registry + actions.ts 双端同步，奇偶校验锁死半同步） | ✅ ready |
| C09   | inc       | Python  | ★★★  | 后端三层加约束 LengthConstraint（domain 类 + 注册表 + 构造参数校验，service/api 通用无需改） | ✅ ready |
| C10   | inc       | TS      | ★☆☆  | 加新约束节点 NotBlank（5 处注册：meta/builder/handler/nodes/i18n） | ✅ ready |
| C11   | inc       | TS      | ★★★  | 加新能力 clipboardApi（interface + 双适配器 + 可注入单例 + 消费方禁用而非隐藏） | ✅ ready |
| C12   | inc       | TS      | ★★★  | 加新 graphStore 工厂模块 clipboardOps（DI 工厂 + 闭包状态 + paste 深克隆重生成 id + copy 快照隔离） | ✅ ready |
| C13   | dbg       | Python  | ★☆☆  | 修复校验辅助函数 3 个明显 bug（逻辑反转 / off-by-one / 缺 None 守卫） | ✅ ready |
| C14   | dbg       | Python  | ★★★  | 修复跨块 Unique 漏检（全量频次 + 缺列 chunk 行号偏移 + 缺失值排除） | ✅ ready |
| C15   | dbg       | Python  | ★★★  | 修复 collect_paths 丢失 include_router 子路由（FastAPI 0.138+ _IncludedRouter，递归 + 去重 + 保序） | ✅ ready |
| C16   | dbg       | TS      | ★☆☆  | 修复 createGraphEdges 静默丢边（Vue Flow setEdges 陷阱） | ✅ ready |
| C17   | dbg       | TS      | ★★☆  | 给键盘监听器加 IME 合成态守卫（isComposing / keyCode 229，keydown/keyup 双入口） | ✅ ready |
| C18   | dbg       | TS      | ★★★  | 修复 nodes.value.push 不触发 watcher（赋值换引用 + 返回值契约 + buggy/correct 混合序列） | ✅ ready |
| C19   | refactor  | Python  | ★☆☆  | 给未注解的辅助函数补完整类型注解    | ✅ ready |
| C20   | refactor  | Python  | ★★☆  | 提取 4 个 _format_* 到 formatters.py（处方式：精确符号 + 改公开 + 禁循环导入） | ✅ ready |
| C21   | refactor  | Python  | ★★★  | 命令式嵌套校验循环重构成 4-stage pipeline（处方式：精确 stage 名 + process 只编排 + 不可变性） | ✅ ready |
| C22   | refactor  | TS      | ★☆☆  | 清理 `as unknown as` 双重断言       | ✅ ready |
| C23   | refactor  | TS      | ★★☆  | 处方式抽取 useCounter composable（useCounter(initial) 参数化，.vue 两组逻辑分离其一） | ✅ ready |
| C24   | refactor  | TS      | ★★★  | 处方式拆分 God store：提取 clipboardOps 工厂模块，assembly spread 聚合（含剪贴板与历史解耦） | ✅ ready |

## 真实仓库导航题（R 系列）

与 C 系列不同：agent 在真实 Precis 代码库（上千文件）里导航，用真实 pytest/vitest 验证。**verify 含回归门**：除注入测试外还跑仓库既有相关测试，破坏既有测试即 FAIL。

| ID    | 栈       | 难度 | 一句话                           | 状态     |
|-------|---------|------|----------------------------------|---------|
| R01   | Python  | ★★★  | 在真实后端加 Pattern 约束（6 处文件联动；回归门锁死 __all__ 不得扩） | ✅ ready |
| R02   | Python  | ★★☆  | 在真实 CLI 框架加 version 命令（手动注册陷阱；回归既有 CLI 测试） | ✅ ready |
| R03   | Python  | ★★★  | 加 .parquet 数据源加载器（loader+spec 双目录，装饰器自注册+__getattr__ 惰性 hook；回归既有 loader/spec 测试） | ✅ ready |
| R04   | TS      | ★★☆  | 加 Ctrl+Shift+F 快捷键（registry+command+handler+平台变体+i18n；回归既有 keyboard 测试） | ✅ ready |

## 专家级真实仓库题（X 系列）

真实仓库、长链条、陷阱叠加：难度 ★★★+。verify 注入真实 pytest/vitest 并回归既有测试。

| ID    | 栈         | 难度   | 一句话                           | 状态     |
|-------|-----------|-------|----------------------------------|---------|
| X01   | Python+TS | ★★★+  | 端到端加 Precision 约束：后端 6 处 + 前端 5 处 + i18n 双侧（约 10 文件联动） | ✅ ready |
| X02   | TS        | ★★★+  | 症状驱动调试：plant.py 预埋 IME 守卫缺失，凭现象定位修复（不给文件路径） | ✅ ready |
| X03   | TS        | ★★★+  | 处方式提取 connectionTypeRules + graphStore 既有测试全量回归门 | ✅ ready |
| X04   | TS        | ★★★+  | 反模式判断力：需求要求 edges.value.push 绕开 API，正解=识别冲突合规实现 | ✅ ready |

## 维度缩写

- `nav` — 代码库导航与理解
- `inc` — 跨文件跨层增量开发
- `dbg` — 调试与 bug 修复
- `refactor` — 重构与代码质量
- `x` — 专家级真实仓库任务（X 系列：长链条 / 症状驱动 / 回归门 / 反模式判断）

## 难度

- `★☆☆` — 10-20 分钟，能用的 agent 都该做对
- `★★☆` — 中等，需要跨文件理解或处理边缘情况
- `★★★` — 难，涉及架构陷阱或深层调试
- `★★★+` — 专家级（X 系列）：真实仓库长链条联动、多陷阱叠加或判断力考察
