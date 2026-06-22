# Precis 安全审计报告

> **审计日期**：2026-06-22
> **审计范围**：后端 API 输入入口、前端 XSS、YAML 反序列化、命令注入、依赖漏洞

---

## 1. 路径遍历

### ✅ 项目路径解析（helpers.py）

`_resolve_project_path()` (`backend/app/api/routers/project/helpers.py:99-123`) 正确实现了路径遍历防御：
- 使用 `os.path.abspath()` 解析绝对路径
- 验证 `target_path.startswith(base_path + os.sep)` 确保不越界
- 越界时抛出 `ValueError`

### ✅ 依赖注入层（dependencies.py）

`get_project_config_path()` (`backend/app/api/dependencies.py:70-96`) 正确防御：
- 先检查 `os.path.isabs()` 拒绝相对路径
- 再 `os.path.normpath` + `os.path.abspath` 规范化

### ⚠️ 文件操作端点（files/ops.py）— 低风险

`/read`、`/write`、`/exists`、`/scan`、`/mkdir` 端点接受任意文件路径，**无项目根目录边界检查**。

**风险**：本地攻击者可读写任意文件。**缓解因素**：应用仅监听 localhost，非 Web 面向服务。

**建议**：添加可选的根目录白名单配置，或在 Electron 模式下限制为用户选择的项目目录。

### ✅ 校验文件路径（validation.py）

`_resolve_table_filter_from_file_path()` 仅读取 manifest 中声明的 schema source path 进行匹配，不直接使用用户输入路径访问文件系统。

---

## 2. 命令注入

### ✅ subprocess 调用

所有 `subprocess.run()` 调用均使用列表参数（非字符串），且未设置 `shell=True`：

| 文件 | 调用 | 风险 |
|------|------|------|
| `hardware.py:171` | `["nvidia-smi", "-L"]` | 硬编码命令，安全 |
| `config/edit.py:91` | `[editor, config_path]` | editor 来自环境变量，安全 |

未发现 `os.system()` 或 `os.popen()` 调用。

---

## 3. YAML 反序列化

### ✅ 全部使用 yaml.safe_load

全量搜索 `backend/` 目录，所有 71 处 YAML 加载均使用 `yaml.safe_load()`。未发现 `yaml.load()` 调用。

---

## 4. SQL 注入

### ✅ 不适用

项目使用文件-based 存储（YAML 文件），不使用 SQL 数据库。

---

## 5. XSS（跨站脚本）

### ✅ 所有 v-html 使用均安全

共 14 处 `v-html` 使用，全部经过适当处理：

| 文件 | 内容 | 防御措施 |
|------|------|---------|
| `AIChatPanel.vue:53` | AI 聊天消息 | `DOMPurify.sanitize(md.render(content))` |
| `ConflictDiffPane.vue:54` | 冲突差异 | `escapeHtml()` 手动转义 |
| `ToolboxPanel.vue` (4处) | 图标 SVG | 应用内置图标，非用户输入 |
| `ToolboxTile.vue:16` | 图标 SVG | 同上 |
| `ConstraintRuleTypeMenu.vue` (3处) | 图标 SVG | 同上 |
| `SettingsModal.vue:119` | 图标 SVG | 同上 |
| `StatCardRenderer.vue:10` | 图标 SVG | 同上 |
| `PreviewPanel.vue:63` | i18n 翻译 | 翻译键值，非用户输入 |

---

## 6. Scripted 约束沙箱

### ✅ simpleeval 配置安全

`simpleeval.SimpleEval` 配置（`scripted.py:184-188`）有效防御：
- 内省链（`__class__.__bases__`）— 被 `DISALLOW_PREFIXES=["_"]` 阻止
- 导入绕过（`__import__`）— 不在 functions 字典中
- 内置函数滥用（`getattr`, `type`, `eval`, `exec`, `globals`, `locals`, `open`）— 在 `DISALLOW_FUNCTIONS` 中
- Lambda / 推导式 — 被 `FeatureNotAvailable` 阻止
- 格式化方法（`format`, `mro`）— 在 `DISALLOW_METHODS` 中

详见 `tests/unit/test_scripted_sandbox.py`（39 项测试全部通过）。

**已知低风险**：`row.pop()` / `row.clear()` 可变异当行 dict 副本，但不影响其他行或原始 DataFrame。

---

## 7. 依赖漏洞

### ⚠️ 后端 31 个已知漏洞（8 个包）

| 包名 | 当前版本 | 漏洞数 | 修复版本 |
|------|---------|--------|---------|
| **aiohttp** | 3.13.5 | 11 | ≥3.14.1 |
| **cryptography** | 46.0.6 | 3 | ≥48.0.1 |
| **starlette** | 1.0.0 | 5 | ≥1.3.1 |
| **pip** | 25.1.1 | 4 | ≥26.1.2 |
| **pygments** | 2.19.2 | 1 | ≥2.20.0 |
| **idna** | 3.11 | 1 | ≥3.15 |
| **msgpack** | 1.1.2 | 1 | ≥1.2.1 |

**建议**：运行 `pip install --upgrade` 上述包，或更新 `pyproject.toml` 中的版本约束。

### ✅ 前端 0 个漏洞

`npm audit` 结果：0 vulnerabilities。

---

## 总结

| 检查项 | 状态 | 风险等级 |
|--------|------|---------|
| 路径遍历（项目路径） | ✅ 安全 | — |
| 路径遍历（文件操作端点） | ⚠️ 无边界检查 | 低（本地应用） |
| 命令注入 | ✅ 安全 | — |
| YAML 反序列化 | ✅ 安全 | — |
| SQL 注入 | ✅ 不适用 | — |
| XSS | ✅ 安全 | — |
| Scripted 沙箱 | ✅ 安全 | — |
| 后端依赖漏洞 | ⚠️ 31 个 | 中 |
| 前端依赖漏洞 | ✅ 安全 | — |

**优先修复**：后端依赖升级（特别是 aiohttp、starlette、cryptography）。
