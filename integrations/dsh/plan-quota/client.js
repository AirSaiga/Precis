// @local/plan-quota — browser half: an independent dashboard panel (sidebar icon + main panel),
// mirroring the established @local/dsh-token-dashboard shape.
// Vertical stacked layout: one full-width card per provider; large progress bars are the hero.
// Data comes from this package's host half via the same-origin endpoint GET /api/plan-quota.json.
// Classic-script form: registers only a factory with __ModuleLoader__; React is required from the module table.
(function () {
	"use strict";

	window.__ModuleLoader__.load({
		id: "@local/plan-quota",
		factory: (require) => {
			const module = { exports: {} };
			const exports = module.exports;
			const React = require("react");
			const h = React.createElement;

			/** Locale namespace; also the framework-fed `t` binding domain. */
			const NS = "planQuota";
			/** The id shared by the sidebar entry and the main panel it opens. */
			const PANEL_ID = "plan-quota";
			/** Data route served by this bundle's host half. */
			const DATA_URL = "/api/plan-quota.json";
			/** Auto-refresh cadence while the panel is mounted, in ms. */
			const POLL_MS = 30000;

			const zh = {
				"panel": "套餐额度",
				"title": "套餐额度看板",
				"subtitle": "Kimi / GLM Coding Plan 套餐剩余额度与窗口重置时间",
				"refresh": "刷新",
				"updated": "更新于",
				"loading": "正在查询套餐额度…",
				"error": "数据获取失败",
				"retry": "重试",
				"empty": "没有可展示的套餐：请确认已配置 KIMI_CODING_API_KEY / ZAI_CODING_CN_API_KEY 凭据",
				"tier.session": "5 小时窗口",
				"tier.weekly": "周窗口",
				"remain": "剩",
				"used": "已用",
				"resetIn": "窗口重置：{d} 后（{t}）",
				"plan": "订阅",
				"balance": "余额",
				"insufficient": "余额不足，无法调用 API",
				"queryFailed": "查询失败",
				"keptOld": "显示上次成功数据",
				"note": "数据由本机 DSH 插件 @local/plan-quota 直接查询各厂商接口（Kimi api.kimi.com/coding/v1/usages、智谱 open.bigmodel.cn 用量监控），每 5 分钟自动刷新；密钥仅保存在本机凭据文件中。",
			};
			const en = {
				"panel": "Plan Quota",
				"title": "Plan Quota Dashboard",
				"subtitle": "Remaining quota and window resets for Kimi / GLM Coding Plan",
				"refresh": "Refresh",
				"updated": "Updated",
				"loading": "Querying plan quotas…",
				"error": "Failed to load quota data",
				"retry": "Retry",
				"empty": "Nothing to show: configure KIMI_CODING_API_KEY / ZAI_CODING_CN_API_KEY credentials first",
				"tier.session": "5-hour window",
				"tier.weekly": "Weekly window",
				"remain": "left",
				"used": "used",
				"resetIn": "Resets in {d} ({t})",
				"plan": "Plan",
				"balance": "Balance",
				"insufficient": "insufficient balance — API calls blocked",
				"queryFailed": "query failed",
				"keptOld": "showing last successful data",
				"note": "Served by the local DSH plugin @local/plan-quota, which queries vendor endpoints directly (Kimi api.kimi.com/coding/v1/usages, Zhipu open.bigmodel.cn usage monitor) every 5 minutes; keys never leave this machine.",
			};

			/* ---- formatting helpers ---- */

			/** Remaining-percentage tier color. */
			const toneOf = (remain) =>
				remain === null || remain === undefined ? "ok" : remain >= 50 ? "ok" : remain >= 20 ? "warn" : "bad";
			const TONE = {
				ok: { light: "#2da44e", dark: "#3fb950" },
				warn: { light: "#bf8700", dark: "#d29922" },
				bad: { light: "#cf222e", dark: "#f85149" },
			};

			function fmtDuration(ms) {
				const mins = Math.max(0, Math.round(ms / 60000));
				if (mins < 60) return mins + "m";
				const hours = Math.floor(mins / 60);
				if (hours < 48) return hours + "h " + (mins % 60) + "m";
				return Math.floor(hours / 24) + "d";
			}
			function fmtClock(epochMs) {
				const d = new Date(epochMs);
				const pad = (n) => String(n).padStart(2, "0");
				return d.getMonth() + 1 + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
			}
			function fmtUpdatedAt(epochMs) {
				const d = new Date(epochMs);
				const pad = (n) => String(n).padStart(2, "0");
				return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
			}

			/* ---- scoped CSS (vertical stack; bars are the hero) ---- */

			const CSS = `
.dpq-page{display:flex;flex-direction:column;gap:16px;width:100%;max-width:760px;margin:0 auto;padding:24px 20px 40px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dpq-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dpq-title{font-size:18px;font-weight:600;line-height:26px}
.dpq-subtitle{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dpq-headRight{display:flex;align-items:center;gap:8px}
.dpq-updated{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dpq-button{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:4px 10px;cursor:pointer}
.dpq-button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-overlay))}
.dpq-button:disabled{cursor:wait;opacity:.5}
.dpq-list{display:flex;flex-direction:column;gap:14px}
.dpq-card{display:flex;flex-direction:column;gap:14px;padding:16px 18px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.dpq-cardHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dpq-cardName{font-size:15px;font-weight:600}
.dpq-dot{width:8px;height:8px;border-radius:50%;flex:none}
.dpq-badge{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;background:var(--dsw-alias-fill-l2);border-radius:5px;padding:1px 7px}
.dpq-badgeBad{color:var(--dpq-tone-bad)}
.dpq-tier{display:flex;flex-direction:column;gap:6px}
.dpq-tierHead{display:flex;align-items:baseline;gap:10px}
.dpq-tierLabel{color:var(--dsw-alias-label-secondary);font-size:13px;flex:none}
.dpq-tierRemain{margin-left:auto;font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dpq-tierUsed{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dpq-bar{height:14px;border-radius:7px;background:var(--dsw-alias-fill-l2);overflow:hidden}
.dpq-fill{display:block;height:100%;border-radius:7px;transition:width .4s ease}
.dpq-reset{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dpq-balance{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;line-height:34px}
.dpq-balanceNote{color:var(--dpq-tone-bad);font-size:12.5px;line-height:19px}
.dpq-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dpq-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}
.dpq-empty{color:var(--dsw-alias-label-secondary);padding:24px 0;text-align:center}
`;

			/* ---- sidebar panel icon (gauge glyph) ---- */

			function PanelIcon({ size }) {
				return h(
					"svg",
					{ width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true" },
					h("path", {
						// gauge arc from lower-left to lower-right
						d: "M2.5 11.5a5.5 5.5 0 0 1 11 0",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.6",
						strokeLinecap: "round",
						opacity: "0.85",
					}),
					h("line", {
						// needle pointing at ~70%
						x1: "8", y1: "11.5", x2: "11.2", y2: "6.9",
						stroke: "currentColor",
						strokeWidth: "1.6",
						strokeLinecap: "round",
					}),
					h("circle", { cx: "8", cy: "11.5", r: "1.3", fill: "currentColor" })
				);
			}

			/* ---- one quota window: label row over a full-width bar ---- */

			function Tier({ t, label, remain, hint }) {
				if (remain === null || remain === undefined) return null;
				const color = "var(--dpq-tone-" + toneOf(remain) + ")";
				return h(
					"div",
					{ className: "dpq-tier" },
					h(
						"div",
						{ className: "dpq-tierHead" },
						h("span", { className: "dpq-tierLabel" }, label),
						h("span", { className: "dpq-tierRemain", style: { color: color } }, t("remain") + " " + remain + "%"),
						h("span", { className: "dpq-tierUsed" }, t("used") + " " + (100 - remain) + "%")
					),
					h(
						"div",
						{ className: "dpq-bar", role: "img", "aria-label": label + " " + remain + "%" },
						h("span", { className: "dpq-fill", style: { width: remain + "%", background: color } })
					),
					hint ? h("div", { className: "dpq-reset" }, hint) : null
				);
			}

			/* ---- one provider card (full width, windows stacked vertically) ---- */

			function Card({ t, p, now }) {
				const d = p.detail || {};
				const isBalance = d.balance !== null && d.balance !== undefined;
				// Card-level tone: the worse of the two windows (balance cards use their own color).
				const tone = isBalance
					? (p.usageColor === "bad" ? "bad" : p.usageColor === "warn" ? "warn" : "ok")
					: toneOf(Math.min(d.session ?? 100, d.weekly ?? 100));
				const color = "var(--dpq-tone-" + tone + ")";
				// Reset hint builder shared by both windows (each carries its own epoch).
				const resetOf = (epoch) => (epoch && epoch > now ? t("resetIn", { d: fmtDuration(epoch - now), t: fmtClock(epoch) }) : null);
				return h(
					"div",
					{ className: "dpq-card" },
					h(
						"div",
						{ className: "dpq-cardHead" },
						h("span", { className: "dpq-dot", style: { background: p.ok ? color : "var(--dpq-tone-bad)" } }),
						h("span", { className: "dpq-cardName" }, p.base),
						d.plan ? h("span", { className: "dpq-badge" }, t("plan") + " · " + d.plan) : null,
						!p.ok ? h("span", { className: "dpq-badge dpq-badgeBad" }, t("queryFailed")) : null
					),
					isBalance
						? h("div", null,
							h("div", { className: "dpq-balance", style: { color: color } },
								(d.currency === "CNY" ? "¥" : d.currency === "USD" ? "$" : "") + d.balance.toFixed(2)),
							p.usage && p.usage.indexOf("insufficient") !== -1
								? h("div", { className: "dpq-balanceNote" }, t("insufficient")) : null)
						: h("div", { className: "dpq-list" },
							h(Tier, { t: t, label: t("tier.session"), remain: d.session, hint: resetOf(d.resetsAt) }),
							h(Tier, { t: t, label: t("tier.weekly"), remain: d.weekly, hint: resetOf(d.weeklyResetsAt) })),
					p.error ? h("div", { className: "dpq-error" }, p.error + (p.ok ? "" : " · " + t("keptOld"))) : null
				);
			}

			/* ---- dashboard page ---- */

			/**
			 * The plan-quota main panel: fetches the host-cached snapshot on mount
			 * and on a 30s cadence while visible. Copy resolves through the local
			 * `t$` driven by `<html lang>` (kept in sync by the locale service).
			 */
			function DashboardPage() {
				const [state, setState] = React.useState({ phase: "loading" });
				const [busy, setBusy] = React.useState(false);
				const [now, setNow] = React.useState(() => Date.now());
				const [locale, setLocale] = React.useState("zh");

				const load = React.useCallback((fresh) => {
					if (fresh) setBusy(true);
					const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
					const signal = controller?.signal;
					const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
					fetch(DATA_URL + (fresh ? "?refresh=1" : ""), { signal, cache: "no-store" })
						.then((response) => {
							if (!response.ok) throw new Error("HTTP " + response.status);
							return response.json();
						})
						.then((payload) => setState({ phase: "ready", payload }))
						.catch((error) => {
							if (error?.name === "AbortError") return;
							setState({ phase: "error", message: String(error?.message ?? error) });
						})
						.finally(() => {
							if (timer !== null) clearTimeout(timer);
							if (fresh) setBusy(false);
						});
					return controller;
				}, []);

				React.useEffect(() => {
					const controller = load(false);
					const interval = setInterval(() => { load(false); }, POLL_MS);
					const clock = setInterval(() => setNow(Date.now()), 30000);
					return () => {
						clearInterval(interval);
						clearInterval(clock);
						controller?.abort();
					};
				}, [load]);

				// Follow locale changes for copy and formatting.
				React.useEffect(() => {
					const apply = () => {
						const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
						setLocale(lang?.startsWith("zh") ? "zh" : "en");
					};
					apply();
					if (typeof MutationObserver === "undefined") return undefined;
					const observer = new MutationObserver(apply);
					observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
					return () => observer.disconnect();
				}, []);

				const t$ = (key, params) => {
					const dict = locale === "zh" ? zh : en;
					let text = dict[key] ?? zh[key] ?? key;
					if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll("{" + k + "}", String(v));
					return text;
				};

				// Tone colors as page-scoped CSS variables (light/dark aware).
				const toneVars = Object.entries(TONE)
					.map(([name, c]) => "--dpq-tone-" + name + ":" + c.light + ";")
					.join("") +
					"body[data-ds-dark-theme]{" +
					Object.entries(TONE).map(([name, c]) => "--dpq-tone-" + name + ":" + c.dark + ";").join("") +
					"}";

				if (state.phase === "loading") {
					return h("div", { className: "dpq-page" },
						h("style", null, CSS + ":root{" + toneVars + "}"),
						h("div", { className: "dpq-empty" }, zh["loading"]));
				}
				if (state.phase === "error") {
					return h("div", { className: "dpq-page" },
						h("style", null, CSS + ":root{" + toneVars + "}"),
						h("div", { className: "dpq-empty" },
							zh["error"] + "：" + state.message + "　",
							h("button", { className: "dpq-button", type: "button", onClick: () => { setState({ phase: "loading" }); load(true); } }, zh["retry"])));
				}

				const payload = state.payload;
				const providers = Array.isArray(payload.providers) ? payload.providers : [];

				return h("div", { className: "dpq-page" },
					h("style", null, CSS + ":root{" + toneVars + "}"),
					h("div", { className: "dpq-head" },
						h("div", null,
							h("div", { className: "dpq-title" }, t$("title")),
							h("div", { className: "dpq-subtitle" }, t$("subtitle"))),
						h("div", { className: "dpq-headRight" },
							payload.updatedAt ? h("span", { className: "dpq-updated" }, t$("updated") + " " + fmtUpdatedAt(payload.updatedAt)) : null,
							h("button", { className: "dpq-button", type: "button", disabled: busy, onClick: () => load(true) }, busy ? "…" : t$("refresh")))),
					providers.length === 0
						? h("div", { className: "dpq-empty" }, t$("empty"))
						: h("div", { className: "dpq-list" },
							providers.map((p) => h(Card, { key: p.id, t: t$, p: p, now: now }))),
					h("div", { className: "dpq-note" }, t$("note")));
			}

			/** Required client services: slot registration and the locale seat. */
			const inject = ["slots", "locale"];

			/** Client plugin body. */
			function apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "plan-quota: dictionaries");
				const t = ctx.locale.bind(NS);
				// Independent dashboard panel: a main-column page selected by the sidebar row.
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: PANEL_ID,
					locale: NS,
				}, DashboardPage), "plan-quota: main panel");
				ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 6,
					label: () => t("panel"),
					locale: NS,
				}, PanelIcon), "plan-quota: sidebar entry");
			}

			exports.apply = apply;
			exports.inject = inject;
			return module.exports;
		},
	});
})();
