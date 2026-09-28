/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 约束密度 E2E 共享夹具 —— 14 列 customers schema（22 内嵌 + 2 独立
 * 约束）的 YAML 常量与资源树拖拽助手。供 constraint-density / migration spec 复用
 * （spec 间互导被 Playwright 禁止，共享物沉淀在 fixtures/ 非测试文件）。
 */
import { expect } from '@playwright/test';

type Page = import("@playwright/test").Page;

export const CUSTOMERS_SCHEMA = `version: 2
id: customers
name: customers
description: 客户表（约束坞夹具：14 列 + 22 内嵌约束）
source:
  mode: relative_file
  path: data/customers.csv
columns:
  - {id: customer_id, name: customer_id, type: string, primary_key: true}
  - {id: customer_name, name: customer_name, type: string}
  - {id: email, name: email, type: string}
  - {id: phone, name: phone, type: string}
  - {id: city, name: city, type: string}
  - {id: level, name: level, type: string}
  - {id: age, name: age, type: integer}
  - {id: birthday, name: birthday, type: date}
  - {id: hire_date, name: hire_date, type: date}
  - {id: leave_date, name: leave_date, type: date}
  - {id: balance, name: balance, type: decimal}
  - {id: salary, name: salary, type: decimal}
  - {id: status, name: status, type: string}
  - {id: note, name: note, type: string}
constraints:
  - id: c_id_notnull
    type: NotNull
    column: customer_id
  - id: c_name_notnull
    type: NotNull
    column: customer_name
  - id: c_phone_notnull
    type: NotNull
    column: phone
  - id: c_email_notnull
    type: NotNull
    column: email
  - id: c_city_notnull
    type: NotNull
    column: city
  - id: c_birthday_notnull
    type: NotNull
    column: birthday
  - id: c_hire_notnull
    type: NotNull
    column: hire_date
  - id: c_salary_notnull
    type: NotNull
    column: salary
  - id: c_status_notnull
    type: NotNull
    column: status
  - id: c_note_notnull
    type: NotNull
    column: note
  - id: c_id_unique
    type: Unique
    column: customer_id
  - id: c_email_unique
    type: Unique
    column: email
  - id: c_level_enum
    type: AllowedValues
    column: level
    params: {allowed_values: [A, B, C]}
  - id: c_status_enum
    type: AllowedValues
    column: status
    params: {allowed_values: [active, frozen]}
  - id: c_age_range
    type: Range
    column: age
    params: {min: 0, max: 120, boundary_mode: inclusive}
  - id: c_balance_range
    type: Range
    column: balance
    params: {min: 0, max: 1000000, boundary_mode: inclusive}
  - id: c_salary_range
    type: Range
    column: salary
    params: {min: 0, max: 1000000, boundary_mode: inclusive}
  - id: c_hire_notfuture
    type: DateLogic
    column: hire_date
    params: {logic_mode: compare, compare_op: lte, reference_date: "2026-09-21"}
  - id: c_leave_after_hire
    type: DateLogic
    column: leave_date
    params: {logic_mode: compare, compare_op: gte, reference_column: hire_date}
  - id: c_birth_before_hire
    type: DateLogic
    column: birthday
    params: {logic_mode: compare, compare_op: lte, reference_column: hire_date}
  - id: c_email_lower
    type: Scripted
    column: email
    params: {name: email_lower, expression: "str(value) == str(value).lower()"}
  - id: c_name_strip
    type: Scripted
    column: customer_name
    params: {name: name_strip, expression: "str(value) == str(value).strip()"}
`;

export const INDEPENDENT_TEMPLATE = (
  id: string,
  columnId: string,
  desc: string,
) => `version: 2
id: ${id}
type: Scripted
enabled: true
description: ${desc}
refs:
  table_id: customers
  column_id: ${columnId}
params:
  name: ${id}_check
  expression: >-
    len(str(value)) > 0
`;

export async function openResourceTree(page: Page) {
  // 检查器抽屉可能处于展开态并拦截左侧 activity-bar 点击，先关闭
  const drawer = page.locator(".inspection-drawer");
  if (await drawer.isVisible().catch(() => false)) {
    await drawer
      .locator('button[title="关闭"]')
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await expect(drawer)
      .toBeHidden({ timeout: 5000 })
      .catch(() => {});
  }
  await page
    .locator('.activity-bar-nav .view-btn[title="项目资源"]')
    .first()
    .click();
  const tree = page.locator(".resource-tree");
  await expect(tree).toBeVisible({ timeout: 10000 });
  return tree;
}

/** 拖拽资源树 Schema 到画布，弹窗选指定按钮（全部导入 / 只导 Schema） */
export async function dragSchemaToCanvas(
  page: Page,
  schemaName: string,
  dialogChoice: string,
) {
  const tree = page.locator(".resource-tree");
  const dataModelsRoot = tree
    .locator(".tree-folder.root-item > .tree-row.folder-row")
    .filter({ hasText: "数据模型" });
  const schemasNested = tree
    .locator(".tree-folder.nested > .tree-row.folder-row")
    .filter({ hasText: "数据 Schema" });

  if (
    !(await schemasNested
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await dataModelsRoot.first().click();
    await page.waitForTimeout(500);
  }
  if (
    !(await schemasNested
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    throw new Error("数据 Schema 文件夹未展开");
  }
  const anySchemaFileVisible = await tree
    .locator(".tree-folder.nested .tree-row.file-row")
    .first()
    .isVisible()
    .catch(() => false);
  if (!anySchemaFileVisible) {
    await schemasNested.first().click();
    await page.waitForTimeout(500);
  }

  const schemaItem = tree
    .locator(".tree-row.file-row")
    .filter({ hasText: schemaName })
    .first();
  const canvas = page.locator(".vue-flow__pane");

  let dismissOverlay = true;
  const dismissTask = (async () => {
    const overlay = page.locator(".global-confirm-overlay");
    while (dismissOverlay) {
      if (await overlay.isVisible().catch(() => false)) {
        await overlay
          .getByRole("button", { name: new RegExp(dialogChoice) })
          .click()
          .catch(() => {});
        await expect(overlay)
          .toBeHidden({ timeout: 5000 })
          .catch(() => {});
      }
      await page.waitForTimeout(150);
    }
  })();
  try {
    await schemaItem.dragTo(canvas, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } finally {
    dismissOverlay = false;
    await dismissTask.catch(() => {});
  }
}
