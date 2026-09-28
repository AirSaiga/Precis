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
 * @fileoverview 约束卡片密度（紧凑条自适应）E2E
 *
 * 场景：14 列 Schema + 22 内嵌约束 + 2 独立约束（24 张卡片 > 家族阈值 → 默认紧凑条）：
 * 1. 阈值紧凑：导入后 24 张约束卡片全部渲染为 240×36 紧凑条（不再 hidden），
 *    真实边在紧凑态保持连接（DOM 边可见）
 * 2. 点击原地展开：点击紧凑条 → 选中 → 原地展开全卡（上浮不推挤）；失焦收回
 * 3. 钉住：双击紧凑条 → 保持展开；"取消钉住"回到紧凑
 * 4. 低于阈值家族：只导 Schema（4 张内嵌卡 ≤ 阈值）→ 全卡渲染
 * 5. 几何回归锁：紧凑条高 36±2、条间无重叠、无坞残留节点
 */
import { test, expect } from "../fixtures/base";
import { openProjectOnCanvas } from "../fixtures/openProject";
import {
  CUSTOMERS_SCHEMA,
  INDEPENDENT_TEMPLATE,
  openResourceTree,
  dragSchemaToCanvas,
} from "../fixtures/densityFixture";
import * as fs from "fs";
import * as path from "path";

type Page = import("@playwright/test").Page;

const SHOT_DIR = path.resolve(__dirname, "..", "..", "gui-test-screenshots");
const SCHEMA_SEL = '.vue-flow__node[data-id="customers"]';

/** 画布上当前渲染的约束卡片 id（紧凑条与全卡都是可见节点） */
async function renderedConstraintIds(page: Page): Promise<string[]> {
  return page.$$eval(".vue-flow__node", (els) =>
    els
      .map((e) => e.getAttribute("data-id") || "")
      .filter((id) => id.startsWith("customers_c_") || id.startsWith("cust2_")),
  );
}

/** 收集画布上全部边的 id（Vue Flow edge DOM 元素） */
async function collectEdgeIds(page: Page): Promise<string[]> {
  return page.$$eval(".vue-flow__edge", (els) =>
    els.map(
      (e) => e.getAttribute("data-flowid") || e.getAttribute("data-id") || "",
    ),
  );
}

/** 读取当前画布缩放（d3-zoom 挂在 transformationpane 的 matrix） */
async function readCanvasScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el =
      document.querySelector(".vue-flow__transformationpane") ||
      document.querySelector(".vue-flow__viewport");
    if (!el) return 1;
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === "none") return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
}

/**
 * 取景联合盒（页面坐标）：Schema 节点 + 全部紧凑条（可并入指定节点，如展开的全卡）
 */
async function shotUnionBox(
  page: Page,
  extraNodeId?: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((nid) => {
    const schema = document.querySelector('.vue-flow__node[data-id="customers"]');
    if (!schema) return null;
    const rects = [schema.getBoundingClientRect()];
    for (const bar of Array.from(
      document.querySelectorAll<HTMLElement>(".constraint-compact-bar"),
    )) {
      rects.push(bar.getBoundingClientRect());
    }
    if (nid) {
      const node = document.querySelector(`.vue-flow__node[data-id="${nid}"]`);
      if (node) rects.push(node.getBoundingClientRect());
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, extraNodeId ?? null);
}

/** clip 收敛到页面视口内（Playwright clip 超出视口部分会被裁掉） */
function clampClip(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  margin: number,
) {
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  return {
    x,
    y,
    width: Math.min(box.width + margin * 2, viewport.width - x),
    height: Math.min(box.height + margin * 2, viewport.height - y),
  };
}

/**
 * 滚轮缩放到目标档：每轮以联合盒中心为锚（wheel 缩放保持锚点稳定，
 * 收敛后联合盒近似居中），直至 |scale - target| ≤ 0.03。
 */
async function zoomToUnionFit(page: Page, target: number) {
  for (let i = 0; i < 30; i++) {
    const scale = await readCanvasScale(page);
    if (Math.abs(scale - target) <= 0.03) return;
    const box = await shotUnionBox(page);
    if (!box) throw new Error("取景联合盒缺失");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, scale < target ? -500 : 500);
    await page.waitForTimeout(70);
  }
}

test.describe("约束卡片密度", () => {
  test("24 卡家族默认紧凑、边保持、点击展开/钉住/收回；低阈值家族全卡", async ({
    projectPage,
    isolatedProjectPath,
  }) => {
    test.setTimeout(240_000);
    const page = projectPage;

    // 1. 夹具：14 列 + 22 内嵌 + 2 独立（24 张卡片 > 家族阈值 5）
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

    // 2. 打开项目并拖入 customers（全部导入 → schema + 24 张卡片）
    await openProjectOnCanvas(page, isolatedProjectPath);
    await expect(async () => {
      await openResourceTree(page);
      await dragSchemaToCanvas(page, "customers", "全部导入");
      await expect(page.locator(SCHEMA_SEL)).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90_000 });

    // 导入自动选中最后一张卡（临时展开）：点空白清选择，等密度收敛（300ms 防抖）
    await page.locator(".vue-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect
      .poll(async () => await page.locator(".constraint-compact-bar").count(), {
        timeout: 15_000,
      })
      .toBe(24);

    // 阈值语义：卡片不再被聚合 hidden（全部渲染），坞节点不存在
    expect(await renderedConstraintIds(page)).toHaveLength(24);
    await expect(
      page.locator('.vue-flow__node[data-id^="constraint-dock-"]'),
    ).toHaveCount(0);

    // 边在紧凑态保持连接：24 条 schema→约束真实边全部在 DOM
    await expect
      .poll(
        async () =>
          (await collectEdgeIds(page)).filter((id) =>
            id.startsWith("e-customers-"),
          ).length,
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(24);

    // 几何回归锁：紧凑条高 36±2（布局空间），条间无纵向重叠
    const barGeometry = await page.evaluate(() => {
      const bars = Array.from(
        document.querySelectorAll<HTMLElement>(".constraint-compact-bar"),
      );
      const heights = bars.map((b) => b.offsetHeight);
      const minH = heights.length ? Math.min(...heights) : -1;
      const maxH = heights.length ? Math.max(...heights) : -1;
      let overlaps = 0;
      const rects = bars.map((b) => b.getBoundingClientRect());
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (
            Math.min(rects[i]!.right, rects[j]!.right) -
              Math.max(rects[i]!.left, rects[j]!.left) >
              1 &&
            Math.min(rects[i]!.bottom, rects[j]!.bottom) -
              Math.max(rects[i]!.top, rects[j]!.top) >
              1
          ) {
            overlaps++;
          }
        }
      }
      return { count: bars.length, minH, maxH, overlaps };
    });
    expect(barGeometry.count).toBe(24);
    expect(Math.abs(barGeometry.minH - 36)).toBeLessThanOrEqual(2);
    expect(Math.abs(barGeometry.maxH - 36)).toBeLessThanOrEqual(2);
    expect(barGeometry.overlaps).toBe(0);

    // 3. 点击原地展开：点首条 → 该节点渲染全卡（NodeShell 头部可见），条消失。
    // bar 自带 data-density-node-id（Frame 渲染时写入）；VF 选中/密度写会重排
    // 节点 DOM 顺序，locator 重解析可能换目标——一律以 id 锚定后再交互
    const expandedNodeId = await page
      .locator(".constraint-compact-bar")
      .first()
      .getAttribute("data-density-node-id");
    const anchoredBar = page.locator(
      `.constraint-compact-bar[data-density-node-id="${expandedNodeId}"]`,
    );
    await anchoredBar.click();
    await expect(
      page.locator(
        `.vue-flow__node[data-id="${expandedNodeId}"] .node-shell__header`,
      ),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator(
        `.vue-flow__node[data-id="${expandedNodeId}"] .constraint-compact-bar`,
      ),
    ).toHaveCount(0);

    // 失焦收回：点空白 → 回到紧凑条
    await page.locator(".vue-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect(
      page.locator(
        `.vue-flow__node[data-id="${expandedNodeId}"] .constraint-compact-bar`,
      ),
    ).toBeVisible({ timeout: 5000 });

    // 4. 钉住：双击紧凑条 → 取消选中后保持全卡；"取消钉住"→ 回到紧凑
    await anchoredBar.dblclick();
    await page.locator(".vue-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect(
      page.locator(
        `.vue-flow__node[data-id="${expandedNodeId}"] .node-shell__header`,
      ),
    ).toBeVisible({ timeout: 5000 });
    const unpinBtn = page.locator(
      `.vue-flow__node[data-id="${expandedNodeId}"] .constraint-frame-pin-btn`,
    );
    await expect(unpinBtn).toBeVisible();
    await expect(unpinBtn).toHaveText("取消钉住");
    await unpinBtn.click();
    await page.locator(".vue-flow__pane").click({ position: { x: 5, y: 5 } });
    await expect(
      page.locator(
        `.vue-flow__node[data-id="${expandedNodeId}"] .constraint-compact-bar`,
      ),
    ).toBeVisible({ timeout: 5000 });

    // 5. 截图自查产物（补拍版取景）：
    // 5.0 加宽视口（24 条紧凑条 4 列栅格 + Schema 联合约 3150 flow px，1280 视口
    // 无法在 0.5-0.7 档完整同框）+ 收起右侧检查器面板（防遮挡/挤压取景）
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
      const panel = document.querySelector(".right-panel");
      if (panel) (panel as HTMLElement).style.display = "none";
    });
    await page.waitForTimeout(600);

    // 5.1 以联合盒（Schema + 全部紧凑条）计算目标档（clamp 到 0.5-0.7，
    // 86% 边距），滚轮缩放以盒中心为锚——收敛后 schema 与 24 条紧凑条完整同框
    const fitPlan = await page.evaluate(() => {
      const vp = document.querySelector(".vue-flow__transformationpane");
      const transform = vp ? getComputedStyle(vp).transform : "none";
      const scale = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).a : 1;
      const schema = document.querySelector('.vue-flow__node[data-id="customers"]');
      const canvasEl = document.querySelector(".vue-flow");
      if (!schema || !canvasEl) return null;
      const bars = Array.from(document.querySelectorAll<HTMLElement>(".constraint-compact-bar"));
      const rects = [schema.getBoundingClientRect(), ...bars.map((b) => b.getBoundingClientRect())];
      const minX = Math.min(...rects.map((r) => r.left));
      const minY = Math.min(...rects.map((r) => r.top));
      const maxX = Math.max(...rects.map((r) => r.right));
      const maxY = Math.max(...rects.map((r) => r.bottom));
      const canvasRect = canvasEl.getBoundingClientRect();
      const fit = Math.min(
        (canvasRect.width * 0.86) / ((maxX - minX) / scale),
        (canvasRect.height * 0.86) / ((maxY - minY) / scale),
      );
      return { target: Math.max(0.5, Math.min(0.7, fit)) };
    });
    if (!fitPlan) throw new Error("fit 档位计算失败");
    await zoomToUnionFit(page, fitPlan.target);
    await page.waitForTimeout(400);

    // 5.2 紧凑态全景：clip 到联合盒 + 程序化校验（clip 内可见紧凑条 ≥ 8）
    const viewport = page.viewportSize()!;
    const compactBox = await shotUnionBox(page);
    if (!compactBox) throw new Error("紧凑态联合盒缺失");
    const compactClip = clampClip(compactBox, viewport, 16);
    await page.screenshot({
      path: path.join(SHOT_DIR, "density-compact-grid.png"),
      clip: compactClip,
    });
    const compactCheck = await page.evaluate((clip) => {
      let visibleBars = 0;
      for (const bar of Array.from(document.querySelectorAll<HTMLElement>(".constraint-compact-bar"))) {
        const r = bar.getBoundingClientRect();
        if (
          r.left < clip.x + clip.width &&
          clip.x < r.right &&
          r.top < clip.y + clip.height &&
          clip.y < r.bottom
        ) {
          visibleBars++;
        }
      }
      return { visibleBars };
    }, compactClip);
    expect(compactCheck.visibleBars, "紧凑态截图取景内可见条数").toBeGreaterThanOrEqual(8);

    // 5.3 展开态：store 置选中（UI 点击路径已在步骤 3/4 验证），联合盒并入
    // 展开节点的新包围盒后取景——画面同时含多条紧凑条与展开全卡（两态并存）
    await page.evaluate((bid) => {
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
        };
        if (Array.isArray(store.nodes)) {
          store.selectedNodeId = bid as string | null;
          break;
        }
      }
    }, expandedNodeId);
    await page.waitForTimeout(600);
    const expandedBox = await shotUnionBox(page, expandedNodeId);
    if (!expandedBox) throw new Error("展开态联合盒缺失");
    const expandedClip = clampClip(expandedBox, viewport, 16);
    await page.screenshot({
      path: path.join(SHOT_DIR, "density-expanded-card.png"),
      clip: expandedClip,
    });
    const expandedCheck = await page.evaluate(
      ({ clip, nodeId }) => {
        const node = document.querySelector(`.vue-flow__node[data-id="${nodeId}"]`);
        const shell = node?.querySelector<HTMLElement>(".node-shell");
        const shellRect = shell?.getBoundingClientRect();
        const shellInClip = !!(
          shellRect &&
          shellRect.left < clip.x + clip.width &&
          clip.x < shellRect.right &&
          shellRect.top < clip.y + clip.height &&
          clip.y < shellRect.bottom
        );
        let visibleBars = 0;
        for (const bar of Array.from(document.querySelectorAll<HTMLElement>(".constraint-compact-bar"))) {
          const r = bar.getBoundingClientRect();
          if (
            r.left < clip.x + clip.width &&
            clip.x < r.right &&
            r.top < clip.y + clip.height &&
            clip.y < r.bottom
          ) {
            visibleBars++;
          }
        }
        return { shellH: shell?.offsetHeight ?? 0, shellInClip, visibleBars };
      },
      { clip: expandedClip, nodeId: expandedNodeId },
    );
    // 展开的全卡高度 ≥100px 且在取景内；同框可见紧凑条 ≥3（两态并存证据）
    expect(expandedCheck.shellH, "展开全卡高度").toBeGreaterThanOrEqual(100);
    expect(expandedCheck.shellInClip, "展开全卡在取景内").toBe(true);
    expect(expandedCheck.visibleBars, "展开态同框可见紧凑条").toBeGreaterThanOrEqual(3);

    // 5.4 清选中（还原画布状态，供后续步骤）
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
        };
        if (Array.isArray(store.nodes)) {
          store.selectedNodeId = null;
          break;
        }
      }
    });
    await page.waitForTimeout(400);

    // 6. 低阈值家族全卡：categories 仅 1 列 1 内嵌约束且无独立挂靠（≤ 阈值 → 全卡）
    await openProjectOnCanvas(page, isolatedProjectPath);
    await expect(async () => {
      await openResourceTree(page);
      await dragSchemaToCanvas(page, "categories", "只导 Schema");
      await expect(
        page.locator('.vue-flow__node-schema[data-id="categories"]'),
      ).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    // 物化节点 id 约定：{schemaId}_{constraintId}
    await expect(
      page.locator('[data-id^="categories_"] .constraint-compact-bar'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-id^="categories_"] .node-shell__header').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
