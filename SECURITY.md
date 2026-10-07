# 安全说明 / Security Notice

> **使用前提 / Usage Premise**
>
> Precis 是**单机本地应用**：后端仅监听 localhost，设计上**仅限本机单机使用**，不面向网络开放部署，也不支持多用户/远程服务形态。外部自助的网络开放部署**不是本产品的目标场景**。
> Precis is a **single-machine local application**: the backend listens on localhost only, and it is designed **exclusively for local single-user use on your own machine**. It is not intended for network-exposed deployment, nor for multi-user or remote service scenarios. Self-hosted network-exposed deployment **is not a supported target scenario**.

## 威胁模型边界 / Threat Model Boundary

以下边界界定了安全设计与声明的适用范围 / The following boundaries define the scope of our security design and statements:

| 边界 Boundary | 说明 Description |
|----------|-----------------|
| **本机与局域网内** Local, same machine | 后端仅绑定 localhost，仅本机进程可访问；这是唯一受支持的运行形态 The backend binds to localhost only and is accessible solely to local processes; this is the only supported operating mode |
| **不受支持** Unsupported | 将后端端口暴露到网络、多用户共享一个后端、反向代理/容器对外服务等形态——这些场景下的已知安全缺口见 [`SECURITY-BACKLOG.md`](SECURITY-BACKLOG.md)，在对外部署形态出现前**明确不修** Exposing the backend port to the network, sharing one backend among multiple users, or serving via reverse proxy/containers — known gaps in these scenarios are documented in [`SECURITY-BACKLOG.md`](SECURITY-BACKLOG.md) and are **explicitly not fixed** before such deployment modes exist |
| **本机恶意进程** Local malicious processes | 威胁模型假设本机上**没有**已攻陷的恶意进程；本地攻击者本身已具备等同的文件系统权限，防护其无意义 The threat model assumes **no** compromised malicious process on the local machine; a local attacker already holds equivalent filesystem privileges, so defending against them is moot |

## 已知局限 / Known Limitations

| 项目 Item | 说明 Description |
|----------|-----------------|
| **无安全审计** No security audit | 代码尚未经过第三方安全审查，使用前请自行评估风险 The code has not undergone third-party security review; assess risks before use |
| **脚本沙箱** Scripted sandbox | 用户脚本（Scripted 约束）在受限的 `simpleeval` 沙箱中执行，但不等同于完整的安全隔离 User scripts (Scripted constraints) run in a restricted `simpleeval` sandbox, which is not equivalent to full security isolation |
| **输入校验范围** Input validation scope | 前端和后端的输入校验以功能正确性为主，未覆盖全部恶意输入场景（在单机前提下风险可接受） Frontend and backend input validation focuses on functional correctness and does not cover all malicious-input scenarios (acceptable under the single-machine premise) |
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

Precis 尚未经过安全审计，我们**无法对任何数据泄露、代码执行或系统损害承担责任**。请仅在本机环境中使用，勿将后端暴露到网络或用于多用户场景。

Precis has not undergone security auditing; we **cannot be held liable for any data breaches, code execution, or system damage**. Use it only on your own machine; do not expose the backend to a network or use it in multi-user scenarios.
