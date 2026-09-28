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
 * @fileoverview 约束概览弹层（三层表达方案①索引层）E2E
 *
 * 夹具模式复用 constraint-density.spec（14 列 Schema + 22 YAML 约束 + 2 独立文件约束
 * = 24 张卡片，全部 14 列均有约束、无表级约束）。夹具常量在本文件内镜像拷贝而非
 * import——spec → spec import 会把对方文件里的 test() 在本文件下重复注册
 * （全量跑套件时密度用例会跑两遍），且该文件正被并行改动，锁拷贝更稳。
 *
 * 覆盖：
 * 1. 头部按钮：计数徽标 = 24
 * 2. 开弹层：总数 24；按列分组 14 小节（列序 = Schema 列序）；chips 共 24
 * 3. 点 chip：卡片选中 + 紧凑条临时展开全卡（点索引 → 画布聚焦展开闭环）
 * 4. 全部展开 / 全部紧凑：家族卡片批量密度生效
 * 5. Esc 关闭；多 Schema 弹层互斥（categories 计数 1，切换互斥）
 */
import { test, expect } from "../fixtures/base";
import { openProjectOnCanvas } from "../fixtures/openProject";
import * as fs from "fs";
import * as path from "path";

type Page = import("@playwright/test").Page;

const SHOT_DIR = path.resolve(__dirname, "..", "..", "gui-test-screenshots");
const SCHEMA_SEL = '.vue-flow__node[data-id="customers"]';
const POPOVER_SEL = '[data-constraint-overview-popover]';
const TOGGLE_SEL = ".schema-constraint-overview-toggle";

// —— 夹具（镜像自 constraint-density.spec，两处需人工同步） ——

export const CUSTOMERS_SCHEMA = `version: 2
id: customers
name: customers
description: 客户表（约束概览夹具：14 列 + 22 内嵌约束）
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

async function openResourceTree(page: Page) {
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
async function dragSchemaToCanvas(
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

/** 滚轮放大画布到 ~1.0（以 schema 为中心），保证截图分辨率可供肉眼检查 */
async function zoomIntoSchema(page: Page) {
  const anchor = page.locator(SCHEMA_SEL);
  for (let i = 0; i < 12; i++) {
    const scale = await page.evaluate(() => {
      const el =
        document.querySelector(".vue-flow__transformationpane") ||
        document.querySelector(".vue-flow__viewport");
      if (!el) return 1;
      const transform = getComputedStyle(el).transform;
      if (!transform || transform === "none") return 1;
      return new DOMMatrixReadOnly(transform).a;
    });
    if (scale >= 0.95) return;
    const box = await anchor.boundingBox();
    if (!box) throw new Error("schema 包围盒缺失");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(60);
  }
}

/** 多元素同框 clip：boundingBox 无 right/bottom，需自行相加；夹进视口非负 */
async function unionClip(
  page: Page,
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
  pad = 24,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

test.describe("Schema 约束概览弹层", () => {
  test("入口计数 / 分组 chips / chip 聚焦展开 / 全部展开紧凑 / Esc 关闭 / 多 Schema 互斥", async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(300_000);
    const page = projectPage;

    // 1. 夹具：14 列 + 22 YAML 约束 + 2 独立文件约束（全部 14 列有约束，无表级）
    fs.writeFileSync(
      path.join(isolatedProjectPath, "schemas", "customers.schema.yaml"),
      CUSTOMERS_SCHEMA,
    );
    fs.writeFileSync(
      path.join(
        isolatedProjectPath,
        "constraints",
        "cust2_email_fmt.constraint.yaml",
      ),
      INDEPENDENT_TEMPLATE("cust2_email_fmt", "email", "客户邮箱格式检查"),
    );
    fs.writeFileSync(
      path.join(
        isolatedProjectPath,
        "constraints",
        "cust2_phone_len.constraint.yaml",
      ),
      INDEPENDENT_TEMPLATE("cust2_phone_len", "phone", "客户手机号长度检查"),
    );
    const manifestPath = path.join(isolatedProjectPath, "project.precis.yaml");
    const manifest = fs.readFileSync(manifestPath, "utf-8");
    fs.writeFileSync(
      manifestPath,
      manifest.replace(
        "constraints:\n",
        `constraints:\n- id: cust2_email_fmt\n  path: constraints/cust2_email_fmt.constraint.yaml\n- id: cust2_phone_len\n  path: constraints/cust2_phone_len.constraint.yaml\n`,
      ),
    );

    // 2. 打开项目并拖入 customers（全部导入 → schema + 24 张卡片），等密度收敛为紧凑条
    await openProjectOnCanvas(page, isolatedProjectPath);
    await expect(async () => {
      await openResourceTree(page);
      await dragSchemaToCanvas(page, "customers", "全部导入");
      await expect(page.locator(SCHEMA_SEL)).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90_000 });

    await page.locator(".vue-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect
      .poll(async () => await page.locator(".constraint-compact-bar").count(), {
        timeout: 15_000,
      })
      .toBe(24);

    // 3. 头部按钮计数徽标 = 24（该 Schema 全部约束：YAML 物化 + 独立文件）
    const toggle = page.locator(`${SCHEMA_SEL} ${TOGGLE_SEL}`);
    await expect(toggle).toBeVisible();
    await expect(toggle.locator(".constraint-count-badge")).toHaveText("24");

    // 4. 开弹层：总数 24；14 个列小节（列序 = Schema 列序）；24 枚 chips；无表级小节
    await toggle.click();
    const popover = page.locator(POPOVER_SEL);
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover.locator(".ov-total")).toHaveText("24");
    await expect(popover.locator(".ov-section")).toHaveCount(14);
    await expect(popover.locator(".ov-chip")).toHaveCount(24);
    // 首列为 customer_id（列序 = Schema 列序），末列 note 在最后小节
    await expect(popover.locator(".ov-section").first()).toContainText("customer_id");
    await expect(popover.locator(".ov-section").last()).toContainText("note");

    // 弹层锚定 Schema 同框截图（先放大到 1.0 保证分辨率）
    await zoomIntoSchema(page);
    await page.waitForTimeout(500);
    const schemaBox = await page.locator(SCHEMA_SEL).boundingBox();
    const popoverBox = await popover.boundingBox();
    if (!schemaBox || !popoverBox) throw new Error("弹层/Schema 包围盒缺失");
    await page.screenshot({
      path: path.join(SHOT_DIR, "overview-popover-open.png"),
      clip: await unionClip(page, [schemaBox, popoverBox]),
    });

    // 5. 点 chip：物化卡片 id = {schemaId}_{constraintId}；选中 → 紧凑条临时展开全卡
    const targetChipId = "customers_c_id_unique";
    await popover.locator(`.ov-chip[data-constraint-id="${targetChipId}"]`).click();
    await expect(
      page.locator(`.vue-flow__node[data-id="${targetChipId}"] .node-shell__header`),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator(`.vue-flow__node[data-id="${targetChipId}"] .constraint-compact-bar`),
    ).toHaveCount(0);
    // 弹层保持打开（可连续点索引）
    await expect(popover).toBeVisible();

    // 聚焦展开后的卡片 + Schema 同框截图
    await page.waitForTimeout(600);
    const cardBox = await page
      .locator(`.vue-flow__node[data-id="${targetChipId}"]`)
      .boundingBox();
    const schemaBox2 = await page.locator(SCHEMA_SEL).boundingBox();
    if (!cardBox || !schemaBox2) throw new Error("卡片/Schema 包围盒缺失");
    await page.screenshot({
      path: path.join(SHOT_DIR, "overview-chip-focus-expanded.png"),
      clip: await unionClip(page, [schemaBox2, cardBox, await popover.boundingBox() ?? cardBox]),
    });

    // 6. 清空选择（弹层保持打开——点画布空白会触发"点击外部关闭"，故经 store 清）：
    //    被选中卡片收回紧凑条，回到家族默认密度基线
    await page.evaluate(() => {
      const app = (
        document.querySelector("#app") as unknown as { __vue_app__?: unknown }
      )?.__vue_app__;
      const pinia = (
        app as {
          config: {
            globalProperties: { $pinia?: { _s?: Map<string, unknown> } };
          };
        }
      )?.config.globalProperties?.$pinia;
      for (const [, s] of pinia?._s ?? []) {
        const store = s as {
          nodes?: unknown[];
          selectedNodeId?: string | null;
          selectedNodeIds?: string[];
        };
        if (Array.isArray(store.nodes)) {
          store.selectedNodeId = null;
          store.selectedNodeIds = [];
          break
        }
      }
    });
    await expect(popover).toBeVisible();
    await page.waitForTimeout(600);

    // 7. 全部展开：24 张卡片全部渲染全卡（density full + pinned，管理器跳过）。
    //    卡片 id 两段式：YAML 物化约束 = {schemaId}_{constraintId}（customers_*），
    //    独立文件约束保留自身 id（cust2_*）——选择器需同时覆盖两段
    const familyCardHeader =
      '.vue-flow__node[data-id^="customers_"] .node-shell__header, .vue-flow__node[data-id^="cust2_"] .node-shell__header'
    await popover.locator(".ov-action-expand").click();
    await expect
      .poll(async () => await page.locator(familyCardHeader).count(), { timeout: 60_000 })
      .toBe(24);
    await expect(
      page.locator(
        '.vue-flow__node[data-id^="customers_"] .constraint-compact-bar, .vue-flow__node[data-id^="cust2_"] .constraint-compact-bar'
      ),
    ).toHaveCount(0);

    // 8. 全部紧凑：清密度与钉住 → 300ms 防抖后密度管理器按家族默认收敛回紧凑条
    await popover.locator(".ov-action-compact").click();
    await expect
      .poll(async () => await page.locator(".constraint-compact-bar").count(), {
        timeout: 60_000,
      })
      .toBe(24);

    // 9. Esc 关闭
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden({ timeout: 5000 });

    // 10. 多 Schema 互斥：拖入 categories（只导 Schema，1 条 YAML 约束），
    //     开它的概览 → 同一时刻只有一个弹层且归属 categories
    await expect(async () => {
      await openResourceTree(page);
      await dragSchemaToCanvas(page, "categories", "只导 Schema");
      await expect(
        page.locator('.vue-flow__node-schema[data-id="categories"]'),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90_000 });
    await page.waitForTimeout(1500);

    const categoriesToggle = page.locator(
      '.vue-flow__node[data-id="categories"] .schema-constraint-overview-toggle',
    );
    await expect(categoriesToggle).toBeVisible({ timeout: 10_000 });
    await expect(categoriesToggle.locator(".constraint-count-badge")).toHaveText("1");
    await categoriesToggle.click();
    await expect(page.locator(POPOVER_SEL)).toBeVisible();
    await expect(page.locator(POPOVER_SEL)).toHaveCount(1);
    await expect(page.locator(POPOVER_SEL)).toHaveAttribute("data-schema-id", "categories");
    // 互斥再点 categories 关闭
    await categoriesToggle.click();
    await expect(page.locator(POPOVER_SEL)).toHaveCount(0);
  });
});
