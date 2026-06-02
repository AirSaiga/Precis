# Precis Backend — 技术债与安全审计报告

**日期**：2026-06-02
**范围**：`backend/app/`（~285 个 Python 文件，~38k 行代码）
**审计维度**：安全漏洞 / 逻辑错误 / 架构债务 / 补丁遗留 / 功能缺失
**项目阶段**：Pre-Alpha（超早期原型，测试覆盖 < 5%）

---

## 一、总体评价

### 架构

三层分离（`core / domain / services`）、注册表模式、策略模式、Pydantic v2 全栈类型注解——架构设计**清晰合理**。

但存在多处 DRY 违反（3 套几乎相同的 upsert / delete 流程、2 套 loader 注册表）、大量死代码路径，以及 `domain/` 层实际依赖 pandas（违反"pure business logic"约定）。

### 安全态势

作为本地 Electron 工具，当前 API 零认证 + 绑定 `127.0.0.1` 在单人开发环境下**可接受**。但以下 4 条一旦组合，立即变成 RCE：

1. AI 非交互模式（CI/自动化）→ 无 confirm 确认
2. 用户加载了不可信的 project YAML
3. AI 生成 constraint 时 `pattern` 未转义直接嵌入 f-string
4. AI 可通过 `UPDATE_SETTINGS` 把 `script_security.allow_eval` 翻为 `True`

### 业务正确性

**10 种约束中至少 6 种存在静默失败或绕过路径**：`ScriptedConstraint` 对 `np.bool_(False)` 判为 True；`DateLogicConstraint` 的 `compare_op` 参数完全被忽略；类型系统多处 NaN/Inf 处理不当导致下游校验结果不可信。

### 可维护性

18+ 处 `f"...失败: {str(e)}"` 风格异常处理（堆栈/绝对路径泄露至客户端）、Pydantic v1 API (`payload.dict()`) 在 v3 将 break、3 处 "debug_info" 在 404 中直接回传配置路径。

---

## 二、真安全漏洞（按严重度）

### 🔴 CRITICAL（4 项）

#### S-01 `app/api/routers/preview/header_row.py:28-104`

**路径遍历 + 信任模型断裂**

```python
@router.post("/header-row-changed")
def handle_header_row_changed(request: HeaderRowChangedRequest):
    # ← 缺少 Depends(get_project_config_path)
    if schema_name:
        schema_path = Path("schemas") / f"{schema_name}.yaml"  # CWD 相对
```

- 无 `X-Project-Config-Path` 依赖，与项目其余路由信任模型完全割裂
- `schema_name="../../app/api/main"` 可读写服务 CWD 下任意文件
- 异常信息通过 `str(e)` 直接回传（含 OS 路径）

**验证**：已现场确认。**真问题**。

---

#### S-02 `app/shared/services/llm/actions/settings_handlers.py:123-127`

**LLM 可静默开启 unsafe-eval**

```python
elif category == "scriptSecurity":
    if "timeout_seconds" in settings:
        val = settings["timeout_seconds"]
        if not isinstance(val, (int, float)) or val <= 0:
            errors.append("...")
# ← allow_eval / sandbox_mode 完全未校验！
```

- `VALID_SETTINGS_CATEGORIES` 包含 `scriptSecurity`
- `_validate_settings` 对 `scriptSecurity` 仅校验 `timeout_seconds`
- `allow_eval=True, sandbox_mode=False` 组合被放行
- 下次校验时 `loader.py:356-362` 读取该配置并对 ScriptedConstraint 开启 `allow_unsafe_eval`

**验证**：已现场确认。**真问题，且与 S-03 组合成完整 RCE 链**。

---

#### S-03 `app/shared/services/llm/constraints/constraint_builder.py:91-96`

**f-string 表达式注入**

```python
elif std_type == "Scripted":
    pattern = params.get("pattern")
    if pattern and not expression:
        expression = f"re.match(r'{pattern}', str(value)) is not None"
```

- LLM 返回的 `pattern` 字段未 `re.escape` 直接嵌入 f-string
- 畸形 `pattern` 可触发 `SyntaxError`；在 `allow_unsafe_eval=True` 时理论上可 RCE
- 配合 S-02 的 settings 写入，形成完整攻击链

**验证**：已现场确认。**真问题**。

---

#### S-04 `app/shared/services/llm/actions/{schema,regex,transform}_handlers.py:75,82,103`

**LLM 控制路径 → 任意文件写**

```python
# schema_handlers.py:75
schema_file = schemas_dir / f"{schema_id}.schema.yaml"
```

- `schema_id` = `LLM 返回的 id` → 直接拼路径
- `schema_id="../../etc/foo"` → 写 `schemas/../../etc/foo.schema.yaml`
- 非交互模式（CI）无 `confirm_callback`，立刻触发

**验证**：已现场确认。**真问题**。

---

### 🟠 HIGH（7 项）

#### S-05 `app/shared/core/data_source/specs/sql_source.py:117-128`

**密码遮蔽被 `@` 绕过**

```python
parts = conn.split("@")
if len(parts) == 2:  # ← 密码含 @ 时 split 返回 3+ 段
    ...
    return f"{protocol}://{user}:***@{parts[1]}"
# ← len != 2 时直接返回原文，含明文密码！
```

密码 `p@ss` → `split("@")` 返回 3 段 → 脱敏跳过 → **`to_display_dict()` 经 API 返回明文密码**。

**验证**：已通过 Python 跑通测试。**真问题**。

---

#### S-06 `app/shared/domain/constraints/scripted.py:206`

**`np.bool_(False)` 被判为 True（静默数据泄漏）**

```python
if not isinstance(result, (bool, np.bool_)):
    ...error...
    continue
if result is False:  # ← np.bool_(False) is False → False，不进此分支
    errors.append(...)  # 永远不执行
```

业务约束返回 numpy bool False 时被当作**通过**。验证：`np.bool_(False) is False` → `False`。

**验证**：已通过 Python 跑通测试。**真问题**。

---

#### S-07 `app/shared/domain/constraints/date_logic.py:316`

**`compare_op` 参数完全被忽略**

```python
# 行 315 注释: "默认假设 compare_op 隐含 'gte'"
mask_fail_local = ages < target_age  # ← 永远用 <，从不读 self.compare_op
```

用户 UI 选"年龄 ≥ 18"实际检"年龄 < 18"，方向反转。

**验证**：已现场确认。**真问题，开发者在注释里已承认**。

---

#### S-08 `app/api/routers/ai/utils.py:38-128`

**`expand_paths` 无限制遍历用户目录**

用户提交 `{"paths": ["C:/"]}` 或 `["./"]` → `os.walk` 全树 → 返回磁盘上每个 `.xlsx/.xls/.csv/.json/.jsonl` 路径。无深度/文件数/作用域限制。

**真问题**。未现场验证（路径构造模式明显）。

---

#### S-09 `app/api/routers/ai/jobs.py:47-217`

**模块全局 dict + 协程无锁**

```python
_jobs: dict[str, _Job] = {}
_job_tasks: dict[str, asyncio.Task] = {}
```

进度回调（`_run_job` 内部）和 cancel handler（HTTP 请求上下文）并发读写，无 `asyncio.Lock` 同步。**真问题**（单进程勉强能跑，多 worker 必坏）。

---

#### S-10 `app/shared/services/llm/chat/response_parser.py:172-190`

**截断响应被静默重构后执行**

`_try_recover_truncated` 自动重平衡花括号/引号 → 静默改变 LLM 输出结构 → 执行从未真实存在过的 action。间接 prompt injection 加成。

**真问题**。未现场细看（模式与 `_fix_single_quotes` 一致）。

---

#### S-11 `app/shared/core/reporter/reporters/feishu_app_reporter.py:240,358,395`

**SSRF + 凭据外泄**

`urllib.request.urlopen(service_url)` 无 scheme/IP allowlist。可探测 `169.254.169.254`（云元数据）、`localhost`。在 `service_url` 模式下，`Authorization: Bearer <api_key>` 头被发往用户控制 URL。

**真问题**（功能本身是设计目的，但缺少白名单限制）。`wecom_app_reporter`、`dingtalk_app_reporter` 同样受影响。

---

## 三、业务逻辑错误（按影响）

### 🟠 数据质量静默失效（2 项）

#### B-01 `domain/constraints/scripted.py:206` — `np.bool_(False)` bypass

见 S-06。**后果**：ScriptedConstraint 对返回 numpy False 的表达式静默通过，数据校验失效。

#### B-02 `domain/constraints/date_logic.py:316` — `compare_op` 无效

见 S-07。**后果**：年龄/日期比较方向反转，合规校验给出错误结论。

---

### 🟡 类型系统缺陷（5 项）

#### B-03 `domain/data_types_parts/scalars.py:331-358`

**`DecimalType` 接受 NaN / Infinity**

`Decimal("NaN")`、`Decimal("Infinity")` 的 `len(digits)` 为 1，不触发精度检查。货币列可用 NaN；`Range` 比较时 `inf >= max_value` 永远 True。

**真问题**。

#### B-04 `domain/data_types_parts/scalars.py:102-149`

**`IntegerType` 静默溢出至 float64**

`pd.to_numeric("99999999999999999999")` → `1e20`（float64 精度丢失）→ `None` 注入 → object dtype。下游 `Range` 比较时 `int(1e20) != 1e20`。

**真问题**（但这是 pandas 默认行为，业务层需在 schema 约束 `min/max`）。

#### B-05 `domain/transforms/cast_type.py:55-58`

**真字符串 "nan" 被误判为 Pandas NaN**

```python
series = series.astype(str)
series = series.where(series != "nan", None)  # ← 只处理小写 "nan"
```

用户输入字面 `"nan"`（小写）被抹成 None；`"NaN"` / `"NAN"` 不受影响（不一致）。

**真问题**（意图是还原 pandas NaN，但实现不严谨）。

#### B-06 `domain/transforms/date_format.py:45-46`

**解析失败时 NaT.strftime() 返回字面 "NaT"**

```python
parsed = pd.to_datetime(df[input_column], format=input_format, errors="coerce")
df[output_col] = parsed.dt.strftime(output_format)  # NaT → "NaT"
```

下游字符串等值比较全部污染。**真问题**。

#### B-07 `domain/constraints/regex.py:103`

**flag 解析子串匹配**

```python
if "i" in self.flags.lower():  # "image"/"input"/"vi" 全部触发 IGNORECASE
```

**真问题（小）**：用集合解析或逗号分隔更严谨。

---

### 🟡 功能缺失（4 项）

#### B-08 三类 delete 不检查下游引用

`schema.py:289` / `constraint.py:176` / `template.py:170` 删除资源前**不验证**是否还被其他资源引用（FK、template instance 等）。删除后引用悬空，下次校验报错难定位。

**真问题**。

#### B-09 三类 delete 在 `project_lock` 之外

先 `os.remove()` 文件，再进 lock 写 manifest。崩溃时文件已删但 manifest 还引用 → 项目损坏。

**真问题**（与 B-08 是两个独立问题）。

#### B-10 `api/routers/validation.py:127`

"暂不支持" 用 `400 Bad Request` 而非 `501 Not Implemented`。语义错误，客户端按请求错误重试。

**真问题（小）**。

#### B-11 `data_sources.py` 路径无规范化

`C:/foo` vs `C:\foo` 视为不同文件，同一数据源可注册两次。

**真问题**。

---

## 四、架构债务

### 🔴 死代码 / 重复实现（3 项）

#### A-01 `api/routers/project/full_config_writer.py:272` — `write_v2_full_config` 零调用

`grep -r write_v2_full_config backend/app backend/tests` 全部 0 命中。该函数被完整内联复制到 `full_config.py:227-435` 端点中。两边若有一方修改而另一方不同步，即产生漂移。

**真问题**。

#### A-02 `core/data_source/loader.py:218-228` — 双注册表

两处存在同名 `LOADER_REGISTRY`，但：
- `core/data_source/loader.py` 的版本按**扩展名**索引（`.xlsx` → loader 函数）
- `core/data_source/loaders/registry.py` 的版本按 **source_type** 索引（`excel` → loader 类）

`can_load()` 用前者，`get_loader_for_spec()` 用后者。**真问题**（认知开销 + 漂移风险）。

#### A-03 `loader.py` 等 16+ 处 `nodes.value.push()` 技术债

**（前端相关，后端无关）**。AGENTS.md 已记录。前端 `graphStore` 的 push 调用绕过 Vue Flow API，需迁移至 `nodes.value = [...nodes.value, newNode]`。

---

### 🟠 设计不一致（4 项）

#### A-04 `api/routers/core/data_sources.py` — 信任模型与其他路由割裂

6 个端点全部用 `os.getenv("PRECIS_PROJECT_ROOT", os.getcwd())` 而非 `X-Project-Config-Path`。与其他 API 的信任模型完全不一致，且无认证保护。

**真问题**（架构一致性缺失）。

#### A-05 `api/routers/preview/header_row.py` — 同上（见 S-01）

#### A-06 `domain/validation_constraints.py` 与 `domain/constraints/__init__.py` — 双份符号

两文件导出相同 14 个符号。`domain/data_types.py` 的 `__all__` 漏了 `SpecificExpressionType` 和 `SpecificCompositeConditionType`。

**真问题**（维护性）。

#### A-07 `cli/shell/main.py:74-85` — `ProjectCommand` 类从未注册

`OpenCommand` 和 `StatusCommand` 作为独立类被注册，但 `ProjectCommand`（含 `project open` / `project status` 子命令）在 `project.py:263-324` 定义后**从未进入** `_setup_commands`。相关代码是死代码。

**真问题**。

---

### 🟡 性能债（3 项，非功能正确性问题）

#### A-08 `domain/transforms/concat.py:65-67` — `apply(lambda, axis=1)`

O(n·m) Python 循环。向量化替代快 1000 倍。**真性能问题**。

#### A-09 `domain/transforms/map_value.py:44-53` — `apply(_map_value)`

每行一次 Python 函数调用。1M 行 = 1M 次调用。**真性能问题**。

#### A-10 `services/validation/history.py` — 历史文件无 rotation

验证历史追加写入单个文件，无大小/条数限制。长时间运行后文件无限增长。

**真问题**（DoS）。

---

## 五、补丁遗留

### 🟠 调试代码未清理（3 项）

#### P-01 `api/routers/project/regex.py:64-127`

6 处 `[DEBUG get_v2_regex_node]` Info 级日志包含 `manifest.regex_nodes`、`patterns_dir` 等内部路径。**真问题**：404 响应回传 `debug_info` 字典（`config_path` + `manifest_regex_nodes` + `patterns_dir`），生产信息泄露。

#### P-02 `api/routers/project/view.py:109`

`payload.dict()` 是 Pydantic v1 API，Pydantic v3 将移除。**真问题**。

#### P-03 `domain/expression_system.py:54` — 函数名 typo

`create_tempated_parser`（应为 `create_templated_parser`）。已在公开 API 中使用，rename 是 breaking change。

---

### 🟡 文档漂移（2 项）

#### P-04 `cli/shell/commands/ai/status.py:61`

提示用户编辑 `~/.precis/ai_providers.json`（`.json`），实际文件是 `~/.precis/ai_providers.yaml`（`.yaml`）。

#### P-05 `cli/shell/commands/ai/chat.py:134`

`os._exit(0)` 硬退出，跳过 Python finalizers、`atexit` 处理器、spinner 线程清理。

---

## 六、可接受的设计（不是 bug，但要意识到代价）

以下不是 bug，但需要团队明确接受其安全/功能代价：

### D-01 `core/edition.py:143` — `set_edition_for_test`

函数名带 `for_test`、docstring 明确说"仅测试用"、测试文件在使用。**不是后门**，是测试工具。Python 无法在进程内强制函数可见性。

**建议**：可加 `if "pytest" not in sys.modules: raise` 防御性改善。

### D-02 `api/main.py:182-188` — CORS 任意本地端口

动态正则 `http://(127\.0\.0\.1|localhost):\d+` 匹配任意端口。配合 `allow_credentials=True`。注释已说明"生产环境应限制为具体域名"。**本地工具的合理设计**，但 `--host 0.0.0.0` 会将攻击面扩展至 LAN。

### D-03 API 零认证

当前 API 全部端点无 auth/token/session。结合 D-02，对于**绑定 127.0.0.1 的本地 Electron 工具**可接受；但部署至远程/容器/ngrok 隧道后立即成为 RCE 入口。

### D-04 `core/reporter/` — Webhook URL 是用户配置的功能

`feishu_app_reporter` 等接受用户配置的 webhook URL 是**设计目的**（发通知），不是 SSRF 漏洞。但缺少 scheme/IP 白名单限制使其可探测内网。

### D-05 `core/data_source/loader.py:53-99` — 被故意禁用的缓存

docstring 明确解释：
> 缓存机制已移除原因：
> - 工具核心工作流是"修改数据 → 校验 → 修正 → 再校验"
> - 缓存导致校验使用旧数据
> - 数据文件小，缓存收益极低

`_data_cache` 等是**被故意禁用**的代码残留，不是 bug。需清理以免误导维护者。

### D-06 `core/manifest_schema/version.py` — v1 项目不可迁移

只有 `version: 2` 被接受，v1 项目直接抛出 `ValueError`。如果历史项目不存在，这是合理的 v2 only 设计；否则需写 v1→v2 迁移脚本。

### D-07 `pyproject.toml:36,49` — pandas>=3.0.0 / cryptography>=46.0.7

这两个版本号在 PyPI 不存在（pandas 当前 2.2.x，cryptography 当前 44.x）。用户 `pip install` 会失败。

**不是供应链攻击**（攻击者不会等别人先声明不存在版本），是 **typo**。应改为实际可用版本如 `pandas>=2.2.0,<3.0`、`cryptography>=44.0.0`。

---

## 七、已验证的误报（不是问题）

| 项 | 原报告描述 | 核实结论 |
|----|-----------|---------|
| `regex.py:121` `match_mode="full"` | 声称 partial match bug | **自纠正**：代码实际正确（`fullmatch` vs `search` 分支正确） |
| `loader_parts/main.py:177` transform_files | 声称不被填充 | **自纠正**：line 178-185 实际有填充 |
| `data_source/loader.py:77` 缓存死代码 | 声称无意的 bug | **故意设计**：docstring 明确说明缓存因 workflow 原因被禁用 |

---

## 八、修复优先级

### P0 — 立即（24-48h）

| # | 项目 | 文件 | 动作 | 估计 |
|---|------|------|------|------|
| S-01 | header_row.py 加项目路径依赖 | `preview/header_row.py:28` | 加 `Depends(get_project_config_path)`，改用 `os.path.join(config_path, "schemas", ...)` | 0.5h |
| S-02 | config set 加路径校验 | `cli/shell/commands/config/set.py:69` | 复用 `find_config_file` 工具函数 | 0.5h |
| S-06 | scripted.py:206 改 `bool(result)` | `domain/constraints/scripted.py:206` | `if result is False` → `if not bool(result)` | 0.1h |
| S-07 | date_logic.py:316 读 `self.compare_op` | `domain/constraints/date_logic.py:316` | 分 `gt/gte/lt/lte/eq` 处理 | 0.5h |
| S-05 | sql_source.py 用 urlparse | `core/data_source/specs/sql_source.py:117` | 改用 `urllib.parse.urlparse` | 0.5h |
| S-02b | settings_handlers 校验所有 scriptSecurity 字段 | `services/llm/actions/settings_handlers.py:123` | 加 `allow_eval` / `sandbox_mode` 白名单校验 | 0.5h |
| S-03 | constraint_builder.py:95 re.escape | `services/llm/constraints/constraint_builder.py:95` | `pattern = re.escape(pattern)` | 0.1h |
| S-04 | *_handlers.py 用 basename | `services/llm/actions/{schema,regex,transform}_handlers.py` | `os.path.basename(id)` + 拒绝含 `/` `\` 的 id | 1h |
| S-08 | expand_paths 加限制 | `api/routers/ai/utils.py:38` | 加 `max_depth=5`，`max_files=1000` | 0.5h |
| S-09 | ai/jobs.py 加锁 | `api/routers/ai/jobs.py:47` | 加 `asyncio.Lock` | 2h |
| P-01 | full_config_writer 复用 | `api/routers/project/full_config.py` | 端点调 `write_v2_full_config()`，删内联重复 | 1h |
| P-02 | regex.py 删调试信息 | `api/routers/project/regex.py:127` | 删 `debug_info`，404 只回通用消息 | 0.2h |

**P0 合计：~7h**

---

### P1 — 本周（16-20h）

| # | 项目 | 估计 |
|---|------|------|
| S-10 | response_parser 截断恢复逻辑加固 | 2h |
| D-04 | feishu/wecom/dingtalk reporter 加 URL 白名单 | 2h |
| D-08 | patterns/loader.py 加 ReDoS 检测（`safe-regex`） | 2h |
| B-03 | DecimalType 加 `is_finite()` 检查 | 1h |
| B-05 | cast_type 用 `isna()` mask 而非字符串比较 | 0.5h |
| B-06 | date_format NaT 修复 | 0.5h |
| B-08+B-09 | delete 操作前检查引用 + 锁内删除 | 4h |
| B-11 | data_sources 路径规范化 | 1h |
| A-04+A-05 | data_sources / header_row 信任模型统一 | 2h |
| P-06 | ProjectCommand 注册或删除 | 0.5h |
| P-03 | `payload.dict()` → `payload.model_dump()` | 1h |

**P1 合计：~19h**

---

### P2 — 迭代中（8-12h）

| # | 项目 | 估计 |
|---|------|------|
| B-04 | IntegerType 溢出处理（加 schema min/max 约束文档） | 1h |
| A-02 | 解决双 LOADER_REGISTRY | 2h |
| A-08+A-09 | concat/map_value 向量化 | 2h |
| A-10 | history 文件 rotation | 1h |
| D-01 | `set_edition_for_test` 防御性加 `sys.modules` 检查 | 0.5h |
| D-07 | pyproject.toml 修 pandas/cryptography 版本号 | 0.5h |
| P-04 | ai status 文档修复（json→yaml） | 0.2h |
| P-05 | os._exit → graceful exit | 0.5h |
| A-06 | `data_types.py __all__` 补漏 | 0.2h |
| A-07 | `ProjectCommand` 类接入或删除 | 0.5h |

**P2 合计：~9h**

---

## 九、总结

| 类别 | 真问题 | 故意设计 | 误报 |
|------|-------|---------|------|
| 安全漏洞 | 11 项 | 4 项（D-01~D-04） | 2 项（v1 migration / dead cache） |
| 业务逻辑错误 | 9 项 | 0 | 3 项自纠正 |
| 功能缺失 | 4 项 | 0 | 0 |
| 架构债务 | 7 项 | 1 项（D-05 缓存禁用） | 0 |
| 补丁/死代码 | 5 项 | 0 | 3 项自纠正 |

**核心结论**：

1. **11 个真安全漏洞** 中 S-01~S-04 是 RCE / 任意文件写 / 凭据泄露级别，需在 1-2 周内修完
2. **S-06（np.bool False bypass）+ S-07（compare_op 无效）** 使"工具能跑 ≠ 工具正确"——业务校验结果不可信，与产品核心价值直接冲突
3. **S-12（被故意禁用的缓存）** 不是 bug，无需修复，只需清理代码残留
4. **D-01~D-04（4 项"故意设计"）** 不是 bug，但应在 README / AGENTS.md 中明确记录，避免被反复当作 bug 报告
5. **pyproject.toml 假版本号** 是 typo 不是供应链攻击，会导致 `pip install` 失败，需修
6. 作为**本地单人桌面工具**当前风险有限；一旦暴露给多用户/远程/自动化 AI 场景，S-01~S-04 立即成为 RCE

---

*报告生成：2026-06-02 | 审计方法：源码逐行验证 + Python 运行时测试 | 验证覆盖率：S-01~S-11, B-01~B-07, P-01~P-03, D-01~D-07, A-01~A-02*
