# 安全技术债务待评估清单（Security Backlog）

> **文档性质**：开发团队内部参考。记录已识别但**暂缓处理**的安全技术项，等待产品形态明确后统一评估。
> **最后核实日期**：2026-07-13（基于代码质量评估报告逐条核实）
> **与 [SECURITY.md](SECURITY.md) 的区别**：SECURITY.md 是面向用户的公开安全声明；本文档是面向开发者的技术债务清单，不对外发布。

---

## 为什么暂缓

这些安全项的处理方式取决于 **Precis 的产品形态定义**——当前 Precis 有三种运行模式：

| 模式 | 部署形态 | 攻击面 |
|---|---|---|
| **Electron 桌面端** | 本地 single-user，后端监听 localhost | 低（攻击者需本地访问） |
| **Web 开发模式** | 本地 dev server | 低（同上） |
| **（未来）多用户/远程部署** | 后端对网络开放 | **高（当前安全措施的缺口会变为真实漏洞）** |

当前 Alpha 阶段仅前两种模式，安全风险可接受。但这些代码路径**一旦后端对网络开放就会变为可利用的漏洞**。本文档记录它们，确保产品形态演进时不会遗漏。

---

## 一、路径穿越（5 个端点 + Electron IPC）

这是风险最高的一类——多个 API 入口直接信任传入路径，无项目根目录/白名单校验。

### 1.1 `projects/create` — 任意位置建目录

- **文件**：`backend/app/api/routers/projects/create.py:84,95`
- **现状**：`create_project` 仅做 `os.path.abspath(os.path.normpath(request.path)` 后直接 `os.makedirs`
- **风险**：可在服务器文件系统任意可写位置创建目录及标准子目录
- **核实结论**：✅ 真实（同目录的 `ai/utils.py` 有 `validate_project_path` 可参考，但此端点未使用）
- **缓解因素**：localhost-only 时，攻击者已有本地文件系统权限

### 1.2 `/preview/file` — 任意文件读取

- **文件**：`backend/app/api/routers/preview/content_mode.py:43-59`
- **现状**：`preview_file` 端点直接把 `request.file_path` 传入 `preview_from_path`，未调用 `validate_file_access`
- **风险**：可读取进程有权限的任意文件（绝对路径，无需 `..` 穿越）
- **核实结论**：✅ 真实（同文件 `switch_sheet:157` 调用了 `validate_file_access`，说明是遗漏而非设计；对比 `path_mode.py` 的 `/file/path` 端点也有校验）
- **修复方向**：复用现有 `validate_file_access`，增加基目录校验

### 1.3 `expand-paths` — 绝对路径直接返回

- **文件**：`backend/app/api/routers/ai/utils.py:98-107`
- **现状**：`_resolve_path` 对绝对路径直接 `return path`，未校验是否在项目根目录下
- **风险**：用户可传入任意绝对路径（如 `/etc`、`C:\Windows`），`_expand_directory` 会递归遍历返回数据文件列表
- **核实结论**：✅ 真实

### 1.4 `data_directory` — 无范围校验

- **文件**：`backend/app/api/routers/project/validation.py:136-138`
- **现状**：`request.options.data_directory` 直接取自请求，无 `isabs`/`..`/根目录校验，直接传入 `executor.execute`
- **风险**：攻击者可传入任意目录作为数据目录
- **核实结论**：✅ 真实（注意 `single_file` 的 `file_path` 在 148-149 行有基于 config_path 的解析，但 `data_directory` 本身无校验）

### 1.5 Electron IPC `read-file` / `write-file`

- **文件**：`electron/src/main.ts`（迁移后位置：`electron/src/ipc/` 相关模块，原行 1493-1575）
- **现状**：仅做 `path.resolve`/`path.normalize` 词法比较（**不解析符号链接**），且**无基目录白名单**——允许读写任意绝对路径
- **核实结论**：🟡 部分真实（字符串比较属实、symlink 未防御属实；但"基目录穿越"措辞不准——本就无基目录限制）
- **对比**：后端 `path_validation.py` 使用 `Path.resolve()` 真正解析 symlink，Electron 侧未用

---

## 二、异常处理契约（21 处裸 except）

6 个路由文件共 **21 处** 裸 `except Exception` 捕获后返回 HTTP 200 + `success=False`，掩盖编程错误。

| 文件 | 出现次数 |
|---|---|
| `preview/content_mode.py` | 4（72, 134, 178, 238）|
| `preview/path_mode.py` | 6（154, 189, 309, 320, 405, 410）|
| `validation/content_mode.py` | 4（122, 231, 237, 314）|
| `validation/path_mode.py` | 2（141, 236）|
| `validation/inline_mode.py` | 1（164）|
| `project/validation.py` | 4（62, 112, 121, 184）|

- **风险**：未预期异常（编程错误）被静默吞掉，返回 200 而非 500，掩盖真实问题，增加调试难度
- **核实结论**：✅ 真实（注意 `path_mode.py` 部分会 `raise HTTPException(500)`，并非全部返回 200）
- **修复方向**：只捕获已知业务异常，未预期异常上抛由全局异常处理器返回 500

---

## 三、文件上传无大小限制

- **文件**：`backend/app/api/routers/files/transfer.py:22-40`
- **现状**：`/upload` 端点 `await file.read()` 将整个文件读入内存后落盘，**无大小限制**（无 `MAX_UPLOAD_SIZE`、无分块、无 `Content-Length` 校验）
- **风险**：内存耗尽 / 磁盘耗尽 DoS
- **核实结论**：✅ 真实（`download`/`delete` 端点用了 `assert_path_within_root`，但 upload 既无大小限制**也无路径校验**）
- **修复方向**：增加 `MAX_UPLOAD_SIZE` 检查 + 流式写入（chunked read）；upload 也应加路径校验

---

## 四、正则 ReDoS 风险

- **文件**：
  - `backend/app/shared/domain/constraints/regex.py:137,147-149`（约束校验）
  - `backend/app/api/routers/core/regex.py:176,178,275,289,292`（test-regex / regex/validate-extract 端点）
  - `backend/app/shared/core/utils/regex_utils.py`
- **现状**：正则编译/匹配**无超时、无 pattern 长度/复杂度限制、无输入长度上限**
- **风险**：恶意构造的正则（如 `(a+)+$`）针对长输入导致指数级回溯（ReDoS）
- **核实结论**：✅ 真实（用户提供的正则模式直接 `re.compile`，test-regex/validate-extract 端点直接接受外部 regex）
- **注**：评估报告原写 `shared/core/regex.py`，实际路径为上述三处

---

## 五、Scripted 约束沙箱

- **文件**：`backend/app/shared/domain/constraints/scripted.py`（simpleeval 配置）
- **现状**：`simpleeval` 沙箱已配置 `DISALLOW_PREFIXES=["_"]`、`DISALLOW_FUNCTIONS`、`DISALLOW_METHODS`
- **核实结论**：✅ 防护到位（内省链/导入绕过/lambda 滥用均被阻止；已有 39 项沙箱测试在 `test_scripted_sandbox.py`）
- **残留风险**：`row.pop()`/`row.clear()` 可变异当行 dict 副本（不影响其他行或原始 DataFrame）——低风险，可接受

> 此项**不需要修复**，记录在此供审计参考。

---

## 统一修复方向（待产品形态明确后执行）

1. **基目录校验**：引入 `BasePathValidator` / `ProjectStore` 依赖注入，覆盖 1.1-1.4 的全部端点 + upload（第三项）
2. **异常契约**：校验/预览路由只捕获已知业务异常，未预期异常上抛返回 500
3. **上传限制**：`MAX_UPLOAD_SIZE` + 流式写入 + upload 路径校验
4. **正则防护**：pattern 长度上限 + 编译超时（signal.alarm 或线程超时）+ 输入长度上限
5. **Electron IPC**：改用 `fs.realpathSync` 解析 symlink + 增加基目录白名单

> ⚠️ 这些修复在 localhost-only 模式下收益有限（攻击者已有本地权限），但在后端对网络开放时是**必须**的。决策时机：当产品路线图包含远程/多用户部署时。

---

## 已验证为安全的项（无需处理）

| 检查项 | 结论 |
|---|---|
| 命令注入（subprocess） | ✅ 所有 `subprocess.run` 用列表参数，无 `shell=True` |
| YAML 反序列化 | ✅ 全部 71 处用 `yaml.safe_load` |
| SQL 注入 | ✅ 不适用（文件存储，无 SQL） |
| XSS（v-html） | ✅ 14 处全部经过 DOMPurify 或手动转义 |
| 前端依赖漏洞 | ✅ npm audit 0 vulnerabilities |
| 后端依赖漏洞 | 🟡 31 个已知漏洞（8 包）——见 `security-audit.md`（已过期，需重新跑 pip-audit）|
