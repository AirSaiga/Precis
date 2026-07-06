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

- 默认禁用任意代码执行
  
  Arbitrary code execution is disabled by default

- 无原始 SQL 查询 — 所有数据库操作使用 ORM
  
  No raw SQL queries — all database operations use ORM

- 依赖项固定并通过 CI 扫描
  
  Dependencies are pinned and scanned via CI

## 免责声明 / Disclaimer

由于项目处于 Alpha 阶段且未经过安全审计，我们**无法对任何数据泄露、代码执行或系统损害承担责任**。请仅在隔离的本地环境中试用。

As the project is in Alpha stage and has not been security-audited, we **cannot be held liable for any data breaches, code execution, or system damage**. Please trial only in an isolated local environment.
