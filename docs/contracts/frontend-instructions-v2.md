# AI → 前端变更集指令契约 v2（frontend_instructions）

> 状态：**已定稿**（v2，2026-10 起生效；v1 镜像数据格式已废弃）
> 实现单一事实源：`backend/app/shared/services/llm/constraints/frontend_instructions.py`
> 消费方文档：前端 `frontend/src/services/aiChatInstructions/`（v2 handler）

本文档定义后端 AI 写盘后发给前端的 **frontend_instruction** 指令结构（v2：变更集信封），
以及它在各通道（SSE 流式 / REST / CLI JSON）中的交付语义。消费方可依赖本文档的承诺。

## 设计原则（D1：文件唯一事实源）

后端写盘后，**项目配置文件是唯一事实源**。指令不再携带实体数据（columns/params/config 等），
只声明"哪个磁盘实体发生了什么变化"；前端收到后从磁盘重读（`importV2ResourceToCanvas`，
幂等）重建画布。旧 v1 的"镜像数据双写通道"（指令内嵌完整实体数据、前端据此镜像建节点）
已废弃——uuid 脱钩、竞态、参数丢失三类 bug 均源于该双写。

## 信封字段（v2）

每条指令是一个 JSON 对象，**有且仅有**以下六个字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `instructionId` | `str` | 确定性标识 `"{op}:{kind}:{entityId}"`，供追踪与显式去重 |
| `actionType` | `str` | 原动作类型（`ADD_SCHEMA` / `UPDATE_CONSTRAINT_NODE` / `DELETE_REGEX` / `ADD_TO_CANVAS` 等，全集见 `actions/registry.py`），供展示与遥测，**不用于分发逻辑** |
| `op` | `str` | `add` \| `update` \| `remove` |
| `kind` | `str` | `schema` \| `constraint` \| `regex` \| `transform`（预留：`manualData` \| `template`） |
| `entityId` | `str` | 磁盘实体的真实 id，**恒等于宿主文件名推导的 id 与画布节点 id**（见下） |
| `filePath` | `str` | 项目相对路径（POSIX `/` 分隔），如 `constraints/notnull_users_email.constraint.yaml` |

**不再携带**任何实体数据字段（`columns` / `params` / `config` / `constraintSpec` 等）。
前端处理任何条目的统一动作：按 `filePath`（或 `kind` + `entityId`）从磁盘重读并重建。

### op 枚举语义（文件级）

| op | 语义 | 前端动作 |
|----|------|---------|
| `add` | 文件已创建（或：把已存在的资源显示到画布） | 从磁盘读取并创建画布节点（已存在则幂等刷新） |
| `update` | 文件内容已变更（文件仍存在） | 从磁盘重读，以文件内容为准重建节点（含内嵌约束与连线） |
| `remove` | 文件已删除 | 移除 `entityId` 对应画布节点及关联边（节点不存在则 no-op） |

### kind 枚举与目录约定

| kind | 目录 | 文件后缀 | 匹配键 |
|------|------|---------|--------|
| `schema` | `schemas/` | `.schema.yaml` | 内容 `id`（匹配时含 `name` 兜底） |
| `constraint` | `constraints/` | `.constraint.yaml` | 确定性派生 id（见下） |
| `regex` | `regex/`（历史 `regex_nodes/` 仍可命中） | `.regex.yaml` | 内容 `id`（匹配时含 `name` 兜底） |
| `transform` | `transforms/` | `.transform.yaml` | 仅内容 `id` |
| `manualData` / `template` | —（当前无 AI 动作产出，前端对称预留） | — | — |

## 恒等约束（entityId ≡ 磁盘真实 id）

1. **entityId = 宿主 YAML 内容的 `id` 字段**（缺失时按文件名剥后缀推导）= **画布节点 id**。
   前端不得用 name/configName 等次级键定位节点。
2. ADD / UPDATE 类指令由后端**重读磁盘**解析 entityId（LLM 可能只给 name，如
   `UPDATE_SCHEMA {name: "users"}` 命中 `schemas/sc_users.schema.yaml` → entityId 为
   `sc_users` 而非 `users`）。
3. DELETE 类指令在文件删除后生成，磁盘无据可查——由 handler 在 unlink 前回传
   `resolved_id`（schema/regex/transform），独立约束为确定性派生（见下），保证删除
   条目的 entityId 同样是真实 id。
4. 独立约束文件的 id 是确定性派生：`_generate_constraint_id(type, table, column)`
   （如 NotNull + users + email → `notnull_users_email`）。生成器镜像写盘路径
   （`update_yaml_config` / `delete_constraint_file`）的**同一套**类型映射与键优先级
   （`CONSTRAINT_TYPE_MAP`，非更强归一化），"写出的文件名"与"指令 entityId"恒等。

### 内联约束的特殊映射

内联约束（`isInline: true`）没有独立磁盘文件，变更落在**宿主 schema 文件**。因此：

- 内联 ADD / UPDATE / DELETE 一律产出 `kind=schema`、`op=update` 的条目
  （actionType 保留原值如 `ADD_CONSTRAINT_NODE` 供遥测）；
- 前端重读 schema 后以其 `constraints` 列表为准重建内嵌约束节点（被删的内联约束
  自然不再重建）；
- 同一批次对同一 schema 的多条内联操作产出**相同 instructionId**
  （`update:schema:{id}`），天然去重为一次重读。

### 无条目的动作

以下动作不产生变更集条目（生成器返回 `None`，各消费通道自动跳过）：

- `UPDATE_SETTINGS`：写 `project.precis.yaml`，无独立实体文件，前端无画布动作；
- `VALIDATE_PROJECT`：纯读校验；
- 未知 actionType / 无法解析 entityId 的动作。

## 幂等性要求（重复送达安全）

- **同一条目重复送达必须安全**：前端按 instructionId（或 entityId + op）去重；即使
  未去重，`add`/`update` 的处理是"以磁盘为准重建"（幂等），`remove` 对不存在的节点
  是 no-op。
- `ADD_TO_CANVAS` 与 `ADD_*` 统一到同一信封（`op=add`）：前者目标文件本就存在，语义
  是"把磁盘上已存在的资源显示到画布"，与新建后显示无差别。

## 交付通道与时序（不变量）

| 通道 | 载体 | 语义 |
|------|------|------|
| SSE 流式（agent 聊天） | 事件名 `frontend_instruction`，payload `{"instruction": {…信封…}}`，确认落盘后**逐条** emit | 前端收到即执行 + fitView（画布实时生长） |
| SSE 终止事件兜底 | `completed` 事件快照 `frontend_instructions: [{…信封…}, …]` | 流式丢失时的兜底；前端按 instructionId 与已流式执行的条目去重（信封确定性使文本比对去重退化为恒等比较） |
| REST 非流式 `/ai/chat` | 响应字段 `frontend_instructions`（list，同信封） | 透传 |
| CLI `ai ask --json` | `CommandResult.data.frontend_instructions` | 纯透传/展示，CLI 无画布，不消费字段 |

时序与事件名**不变**，只有 payload 形状从 v1（内嵌实体数据）变为 v2 信封。

### 生产侧不变量（P0 批次确立，勿破坏）

- **回滚清空**：批次内任一动作失败触发整体回滚时，写盘动作的指令全部清空（磁盘已回到
  执行前，指令指向不存在的结果 = 幽灵指令）；只读动作（`ADD_TO_CANVAS`）重读的是批次前
  就存在的磁盘配置，指令保留。
- **dry-run 不双份累积**：两阶段确认的 dry-run（shadow-copy）产物仅用于 diff 预览，
  指令只从真实写盘结果收集一次（`apply_actions._run_two_phase`）。
- **EventJournal 重放语义**：`frontend_instruction` 事件随 journal 持久化（非终止事件，
  不强制 fsync）。`/ai/chat/stream` 不支持跨连接断线续传——`Last-Event-ID` 仅作为本连接
  内 journal 回放的起始游标（代理缓冲/重连触发时从该 id 重放），重放会重复送达已发事件
  （含 `frontend_instruction` 与 `completed` 快照中的指令）。**幂等性 + instructionId 去重
  是重放安全性的基础**，由前端保证。回滚批次的指令在生产侧已清空，journal 中不会出现
  幽灵条目。

## 兼容性承诺（v2）

1. **只增不减**：v2 生命周期内新增字段允许（消费方应容忍未知字段）；六字段名称与语义不变。
2. **破坏性变更**（删字段、改语义）须递增版本号并更新本文档。
3. v1 → v2 为**硬切换**（前后端同仓库同发布）：v1 前端 handler 收到 v2 信封的行为——
   schema/regex/transform/canvas handler 因 `spec` 缺失**静默跳过**（画布不更新，无报错）；
   constraint handler 对 `undefined` 解构**抛 TypeError**，流式路径被 `.catch` 记日志吞掉、
   批量兜底路径向上冒泡。两种情况均不产生错误节点/脏数据，仅画布滞后（重载项目即恢复）。

## 契约守卫

- 生成器单元测试：`backend/tests/unit/test_frontend_instructions.py`
  （信封字段完整性、各 actionType 家族 add/update/remove、entityId 与磁盘文件 id 恒等、
  ADD_TO_CANVAS、内联降级、DELETE resolved_id 链路、None 返回类）。
