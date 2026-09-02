# 安全说明 / Security Notice

> **Alpha 阶段安全提示 / Alpha-Stage Security Notice**
>
> Precis 目前处于 Alpha 阶段，**尚未经过安全审计**，**不建议处理敏感或生产数据**。
> Precis is in Alpha stage, **has not undergone security auditing**, and **is not recommended for handling sensitive or production data**.

## 已知局限 / Known Limitations

| 项目 Item | 说明 Description |
|----------|-----------------|
| **无安全审计** No security audit | 代码未经过第三方安全审查，使用前请自行评估风险 Code has not undergone third-party security review; assess risks before use |
| **脚本沙箱** Scripted sandbox | 用户脚本（Scripted 约束）在受限的 `simpleeval` 沙箱中执行，但不等同于完整的安全隔离 User scripts (Scripted constraints) run in a restricted `simpleeval` sandbox, which is not equivalent to full security isolation |
| **输入校验范围** Input validation scope | 前端和后端的输入校验以功能正确性为主，未覆盖全部恶意输入场景 Frontend and backend input validation focuses on functional correctness and does not cover all malicious-input scenarios |
| **依赖安全扫描** Dependency scanning | CI 流水线集成 `pip-audit` 与 `npm audit`，每次提交扫描已知漏洞 CI pipeline integrates `pip-audit` and `npm audit` to scan known vulnerabilities on every commit |

## 安全漏洞报告 / Reporting Vulnerabilities

如果你发现潜在的安全问题：

If you discover a potential security issue:

1. **请勿**公开提交 Issue 或 Discussion / **Do not** publicly submit an Issue or Discussion
2. 请通过 GitHub Security Advisories 私下报告，或发送邮件给维护者 / Please report privately via GitHub Security Advisories, or email the maintainers
3. 请提供问题描述、复现步骤和影响评估 / Please provide a description, reproduction steps, and impact assessment

## 安全设计 / Security Design

- 用户提供的脚本（Scripted 约束）运行在受限的 `simpleeval` 沙箱中
  
  User-provided scripts (Scripted constraints) run in a restricted `simpleeval` sandbox

- 默认禁用任意代码执行；如需开启须在服务端显式设置 `PRECIS_ALLOW_UNSAFE_EVAL` 环境变量授权
  
  Arbitrary code execution is disabled by default; enabling it requires explicit server-side opt-in via the `PRECIS_ALLOW_UNSAFE_EVAL` environment variable

- 本地 HTTP API 的跨域访问控制：打包模式下 Electron 每次启动生成随机一次性 token（经 `PRECIS_API_TOKEN` 注入后端，并仅经 IPC 下发本应用渲染进程），请求携带 `X-Precis-Auth` 头才放行 `Origin: null` 的跨域访问；沙箱 iframe 恶意网页拿不到 token，其 null Origin 请求仍被 CORS 拒绝。未配置 token 时（Web/开发模式）中间件完全直通；`PRECIS_ALLOW_NULL_ORIGIN=1` 保留为旧的全局放行兼容开关（打包模式不再注入）
  
  Local HTTP API cross-origin access control: in packaged mode Electron generates a random one-time token per launch (injected into the backend via `PRECIS_API_TOKEN` and handed only to this app's renderer over IPC); only requests carrying the `X-Precis-Auth` header are granted `Origin: null` cross-origin access. Malicious sandboxed-iframe pages cannot obtain the token, so their null-Origin requests remain rejected by CORS. Without a configured token (web/dev mode) the middleware is fully pass-through; `PRECIS_ALLOW_NULL_ORIGIN=1` remains as the legacy blanket-allow compatibility switch (no longer injected in packaged mode)

- 应用自身无数据库存储；读取用户外部 SQL 数据源时经 SQLAlchemy
  
  The app itself has no database storage; user-supplied external SQL data sources are read via SQLAlchemy

- 依赖项固定并通过 CI 扫描
  
  Dependencies are pinned and scanned via CI

## 免责声明 / Disclaimer

由于项目处于 Alpha 阶段且未经过安全审计，我们**无法对任何数据泄露、代码执行或系统损害承担责任**。请仅在隔离的本地环境中试用。

As the project is in Alpha stage and has not been security-audited, we **cannot be held liable for any data breaches, code execution, or system damage**. Please trial only in an isolated local environment.
