# Precis 设计系统重构 — Phase 2: 间距系统统一

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 Liquid 主题的 4px 基准统一 Light/Dark 主题的间距变量，消除同变量名不同值的 bug，并为后续三层令牌体系建立统一的 spacing primitive。

**Architecture:** 将 Light/Dark 的 spacing 值从 6/10/14/18/24/32/42 统一为 4/8/12/16/24/32/40（Liquid 基准）。由于所有业务代码使用 `var(--ui-space-*)` 引用，只需修改 `theme.css` 中的定义值，无需改动任何业务文件。

**Tech Stack:** CSS 自定义属性

---

## 文件结构变更

### 修改文件
- `frontend/src/assets/theme.css` — 修改 Light 主题 spacing 定义（7 个变量）
- `frontend/src/assets/theme.css` — 修改 Dark 主题 spacing 覆盖（7 个变量，如果存在）

### 无新增/删除文件

---

## Task 1: 统一 Light 主题 spacing 值

**Files:**
- Modify: `frontend/src/assets/theme.css:201-207`

**背景:** Light 主题当前 spacing 值为 6/10/14/18/24/32/42，Liquid 为 4/8/12/16/24/32/40。业务代码统一使用 `var(--ui-space-*)` 引用，修改定义值即可全局生效。

- [ ] **Step 1: 修改 Light 主题 spacing 定义**

在 `frontend/src/assets/theme.css` 中，将以下行（约 201-207）：

```css
  --ui-space-xs: 6px;
  --ui-space-sm: 10px;
  --ui-space-md: 14px;
  --ui-space-lg: 18px;
  --ui-space-xl: 24px;
  --ui-space-2xl: 32px;
  --ui-space-3xl: 42px;
```

替换为：

```css
  --ui-space-xs: 4px;
  --ui-space-sm: 8px;
  --ui-space-md: 12px;
  --ui-space-lg: 16px;
  --ui-space-xl: 24px;
  --ui-space-2xl: 32px;
  --ui-space-3xl: 40px;
```

- [ ] **Step 2: 检查并修改 Dark 主题 spacing 覆盖**

搜索 Dark 主题区域是否有 spacing 覆盖。如果有，同样替换为统一值。

- [ ] **Step 3: 验证构建**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: 构建成功，无错误

- [ ] **Step 4: 运行测试**

Run: `cd frontend && npm run test 2>&1 | tail -10`
Expected: 88 passed, 2 failed（与基线一致）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assets/theme.css
git commit -m "refactor(tokens): 统一 spacing 系统为 4px 基准

- Light 主题 spacing: 6/10/14/18/24/32/42 → 4/8/12/16/24/32/40
- 与 Liquid 主题保持一致，消除同变量名不同值的 bug
- 业务代码零改动，通过 var(--ui-space-*) 自动生效"
```

---

## Task 2: 创建 compat 别名（可选，为 Phase 3 铺垫）

**Files:**
- Modify: `frontend/src/assets/tokens/compat.css`

**背景:** 虽然业务代码使用 `var(--ui-space-*)`，但为 Phase 3 的三层令牌体系做准备，可以提前在 compat.css 中添加 spacing 的旧→新映射注释。

- [ ] **Step 1: 更新 compat.css 占位**

将 `frontend/src/assets/tokens/compat.css` 中的占位注释更新为：

```css
/**
 * @file compat.css
 * @description 向后兼容别名 — 旧变量名映射到新变量名
 *
 * 生命周期：保留一个版本周期，下一主版本删除
 * 使用方式：在 main.css 中最后导入，覆盖任何旧引用
 */

:root {
  /* Phase 3 启用时，以下映射将替换为 semantic/component 层变量 */
  /* --ui-bg-canvas → --surface-canvas */
  /* --ui-text-body → --text-secondary */
  /* --ui-accent → --accent */
  /* --ui-space-xs → --space-1 */
  /* --ui-space-sm → --space-2 */
  /* --ui-space-md → --space-3 */
  /* --ui-space-lg → --space-4 */
  /* --ui-space-xl → --space-6 */
  /* --ui-space-2xl → --space-8 */
  /* --ui-space-3xl → --space-10 */
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/assets/tokens/compat.css
git commit -m "docs(tokens): 更新 compat.css 注释，标注 spacing 映射关系

- 为 Phase 3 三层令牌体系标注 --ui-space-* → --space-* 的映射计划"
```

---

## 验证清单

- [ ] `theme.css` 中 `--ui-space-xs: 4px`
- [ ] `theme.css` 中 `--ui-space-sm: 8px`
- [ ] `theme.css` 中 `--ui-space-md: 12px`
- [ ] `theme.css` 中 `--ui-space-lg: 16px`
- [ ] `theme.css` 中 `--ui-space-xl: 24px`
- [ ] `theme.css` 中 `--ui-space-2xl: 32px`
- [ ] `theme.css` 中 `--ui-space-3xl: 40px`
- [ ] Dark 主题（如有覆盖）同步更新
- [ ] 前端构建成功
- [ ] 前端测试通过数与基线一致（88 passed）

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 间距变小导致 UI 拥挤 | 中 | 这是设计决策，Liquid 主题已验证此间距可用 |
| 某些布局依赖精确像素值断裂 | 低 | 所有引用通过变量，统一修改后比例保持一致 |
| Dark 主题有独立 spacing 覆盖遗漏 | 低 | 已 grep 确认 Dark 区域无 spacing 覆盖 |

---

*Phase 2 结束 — 准备进入 Phase 3: 三层令牌架构*
