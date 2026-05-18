# Precis - 通用 AI Skill 目录 / Universal AI Skill Directory

本目录存放与编辑器无关的 **AI Skill / 规则文件**，供团队成员在不同 AI 编辑器（Qoder、Cursor、Trae、Kimi、Windsurf 等）中共享使用。

This directory stores editor-agnostic **AI Skill / rule files** for team members to share across different AI editors (Qoder, Cursor, Trae, Kimi, Windsurf, etc.).

## 目录结构 / Directory Structure

```
.ai/
├── README.md          # 本文件 / This file
└── skills/            # Skill 规则文件 / Skill rule files
    ├── precis-config.md
    └── ...
```

## 格式规范 / Format Specification

Skill 文件推荐使用 **YAML Frontmatter + Markdown** 格式：

Skill files are recommended to use the **YAML Frontmatter + Markdown** format:

```markdown
---
name: "skill-name"
description: "简短描述该 skill 的适用范围和目标"
scope: ["frontend/**/*.vue", "backend/**/*.py"]
---

# Skill 标题 / Skill Title

## 目标 / Objective
...
```

## 各编辑器适配 / Editor Adaptation

| 编辑器 Editor | 适配方式 Adaptation |
|--------------|-------------------|
| **Qoder** | 原生支持 Markdown skill，可配置读取 `.ai/skills/` 路径 / Native Markdown skill support, configurable `.ai/skills/` path |
| **Cursor** | 在 `.cursor/rules/` 中创建索引文件指向 `.ai/skills/` / Create index files in `.cursor/rules/` pointing to `.ai/skills/` |
| **Trae** | 在 `.trae/skills/` 中创建索引文件指向 `.ai/skills/` / Create index files in `.trae/skills/` pointing to `.ai/skills/` |
| **Kimi** | 支持 `AGENTS.md` 格式，可将 `.ai/skills/` 作为扩展上下文 / Supports `AGENTS.md` format, can use `.ai/skills/` as extended context |

## 维护说明 / Maintenance Notes

- **新增 skill / Add skill**：直接在本目录下创建 `.md` 文件或子目录 / Create `.md` files or subdirectories directly in this directory
- **修改 skill / Modify skill**：修改后需同步提交到 Git，确保团队共享 / After modification, commit to Git to ensure team sharing
- **旧路径迁移 / Legacy migration**：原 `.qoder/skills/` 下的内容已迁移至此，后续请统一在此维护 / Content previously under `.qoder/skills/` has been migrated here; please maintain uniformly here going forward
