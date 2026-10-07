// @local/plan-quota — host half: query Kimi / GLM Coding Plan quotas (optional DeepSeek balance),
// cache, and expose via a same-origin HTTP endpoint for the browser half.
//
// Endpoints (cross-verified against community + official implementations, tested locally 2026-09):
// - Kimi For Coding:  GET {kimiBase}/coding/v1/usages            Bearer key (limits[0] = 5h window, usage = total/weekly)
// - GLM Coding Plan:  GET {zaiBase}/api/monitor/usage/quota/limit  raw key on bigmodel.cn, Bearer on z.ai
//                     (TOKENS_LIMIT/CREDIT_LIMIT: unit 3 = 5h session window, unit 6 = weekly; percentage = used%)
//                     GET {zaiBase}/api/biz/subscription/list       plan name (best-effort, failures ignored)
// - DeepSeek balance: GET https://api.deepseek.com/user/balance   Bearer key (off by default, not a plan)
//
// Zero third-party imports: no schemastery (config defaults inline in resolveConfig) and no
// credentialRef (a credential ref is a plain string at runtime), so the package loads through
// a junction from any source directory (module resolution follows the real path).
export const name = "@local/plan-quota";
export const inject = ["webServer", "credentials"];

// Config defaults (override per id: plan-quota in the profile's cordis.patch.yml)
function resolveConfig(config) {
  const num = (v, dflt) => (Number.isFinite(v) && v > 0 ? v : dflt);
  return {
    interval: num(config?.interval, 300), // refresh interval (seconds)
    deepseek: !!config?.deepseek, // DeepSeek is pay-as-you-go balance, not a plan; off by default
    kimiBase: config?.kimiBase || "https://api.kimi.com",
    zaiBase: config?.zaiBase || "https://open.bigmodel.cn",
    zaiIntl: !!config?.zaiIntl, // true = z.ai international (Bearer auth)
  };
}

const log = (...a) => console.log("[" + new Date().toISOString() + "] [plan-quota]", ...a);

// Credential refs tried in order per provider (resolved per operation via ctx.credentials,
// so a rotated key takes effect on the next refresh without restart)
const CRED_REFS = {
  kimi: ["KIMI_CODING_API_KEY", "KIMI_API_KEY"],
  zai: ["ZAI_CODING_CN_API_KEY", "ZAI_CODING_API_KEY", "ZAI_API_KEY", "ZHIPU_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
};
const DISPLAY = { kimi: "Kimi Coding", zai: "GLM Coding", deepseek: "DeepSeek" };

async function resolveKey(ctx, refs) {
  for (const ref of refs) {
    // A credential ref is a plain string at runtime (credentialRef is a type-level brand only)
    const hit = await ctx.credentials.resolve(ref).catch(() => undefined);
    if (hit && hit.value) return { key: hit.value, ref };
  }
  return null;
}

const num = (v) => (typeof v === "number" ? v : parseFloat(v));
const clampPct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
// Remaining percentage -> color tier: >=50 green / >=20 orange / <20 red
function colorOfMin(minRemain) {
  if (minRemain === null || minRemain === undefined) return "ok";
  return minRemain >= 50 ? "ok" : minRemain >= 20 ? "warn" : "bad";
}
const minOf = (tiers) => {
  const vals = Object.values(tiers).filter((v) => v !== null && v !== undefined);
  return vals.length ? Math.min(...vals) : null;
};
const toEpochMs = (v) => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
};

// Tier text: "5h 62% | week 81%"
function tierText(tiers) {
  const parts = [];
  if (tiers.session !== null && tiers.session !== undefined) parts.push("5h " + tiers.session + "%");
  if (tiers.weekly !== null && tiers.weekly !== undefined) parts.push("week " + tiers.weekly + "%");
  return parts.join(" ");
}

async function fetchJson(url, headers, timeoutMs = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + text.slice(0, 120));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("non-JSON response: " + text.slice(0, 120));
  }
}

// -- Kimi For Coding --------------------------------------------------------------
async function queryKimi(base, key) {
  const body = await fetchJson(base.replace(/\/+$/, "") + "/coding/v1/usages", {
    authorization: "Bearer " + key,
    accept: "application/json",
  });
  const tiers = {};
  let resetsAt = null;
  for (const item of body.limits || []) {
    const d = item?.detail;
    if (d && num(d.limit) > 0) {
      const remain = clampPct((num(d.remaining) / num(d.limit)) * 100);
      if (tiers.session === undefined) {
        tiers.session = remain;
        resetsAt = toEpochMs(d.resetTime);
      }
    }
  }
  let weeklyResetsAt = null;
  if (body.usage && num(body.usage.limit) > 0) {
    tiers.weekly = clampPct((num(body.usage.remaining) / num(body.usage.limit)) * 100);
    weeklyResetsAt = toEpochMs(body.usage.resetTime); // weekly/total window reset
  }
  if (tiers.session === undefined && tiers.weekly === undefined) throw new Error("no usable quota window in response");
  return { usage: tierText(tiers), usageColor: colorOfMin(minOf(tiers)), detail: { ...tiers, resetsAt, weeklyResetsAt } };
}

// -- GLM Coding Plan (open.bigmodel.cn / z.ai) -------------------------------------
async function queryZai(base, intl, key) {
  const auth = intl ? "Bearer " + key : key; // bigmodel.cn monitor endpoint uses the raw key
  const body = await fetchJson(base.replace(/\/+$/, "") + "/api/monitor/usage/quota/limit", {
    authorization: auth,
    accept: "application/json",
  });
  const limits = body.data?.limits || (Array.isArray(body.data) ? body.data : []);
  const tiers = {};
  let resetsAt = null;
  let weeklyResetsAt = null;
  for (const item of limits) {
    const type = String(item.type || item.name || "").toUpperCase();
    if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue;
    const used = num(item.percentage);
    const remain = Number.isFinite(used) ? clampPct(100 - used) : null;
    if (remain === null) continue;
    if (item.unit === 3 && tiers.session === undefined) {
      tiers.session = remain;
      resetsAt = toEpochMs(item.nextResetTime);
    } else if (item.unit === 6 && tiers.weekly === undefined) {
      tiers.weekly = remain;
      weeklyResetsAt = toEpochMs(item.nextResetTime); // weekly window carries its own reset
    } else if (tiers.session === undefined) {
      tiers.session = remain;
    } else if (tiers.weekly === undefined) {
      tiers.weekly = remain;
    }
  }
  if (tiers.session === undefined && tiers.weekly === undefined) throw new Error("no usable quota window in response");
  // Plan name best-effort (failures ignored)
  let plan = null;
  try {
    const sub = await fetchJson(base.replace(/\/+$/, "") + "/api/biz/subscription/list", {
      authorization: auth,
      accept: "application/json",
    });
    plan = sub?.data?.[0]?.productName || null;
  } catch { /* no subscription or endpoint drift must not break the quota display */ }
  return { usage: tierText(tiers), usageColor: colorOfMin(minOf(tiers)), detail: { ...tiers, resetsAt, weeklyResetsAt, plan } };
}

// -- DeepSeek balance (optional) ---------------------------------------------------
async function queryDeepSeek(key) {
  const body = await fetchJson("https://api.deepseek.com/user/balance", {
    authorization: "Bearer " + key,
    accept: "application/json",
  });
  const info = (body.balance_infos || [])[0];
  if (!info) throw new Error("no balance_infos");
  const total = num(info.total_balance);
  const sym = info.currency === "CNY" ? "CNY " : info.currency === "USD" ? "$" : info.currency + " ";
  return {
    usage: sym + (Number.isFinite(total) ? total.toFixed(2) : "?") + (body.is_available === false ? " (insufficient)" : ""),
    usageColor: body.is_available === false ? "bad" : total >= 10 ? "ok" : total >= 2 ? "warn" : "bad",
    detail: { balance: Number.isFinite(total) ? total : null, currency: info.currency || null },
  };
}

// -- refresh & state ----------------------------------------------------------------
let state = { updatedAt: null, providers: [] };

async function refresh(ctx, config) {
  const jobs = [
    { id: "kimi", run: async (key) => queryKimi(config.kimiBase, key) },
    { id: "zai", run: async (key) => queryZai(config.zaiBase, !!config.zaiIntl, key) },
    ...(config.deepseek ? [{ id: "deepseek", run: (key) => queryDeepSeek(key) }] : []),
  ];
  const prev = Object.fromEntries(state.providers.map((p) => [p.id, p]));
  const next = [];
  for (const job of jobs) {
    const cred = await resolveKey(ctx, CRED_REFS[job.id]);
    if (!cred) continue; // no credential = plan not in use, hide the card entirely
    try {
      const r = await job.run(cred.key);
      next.push({ id: job.id, base: DISPLAY[job.id], ok: true, ...r, at: Date.now() });
      log(job.id + ": " + r.usage);
    } catch (e) {
      log(job.id + ": query failed: " + e.message);
      // Keep the previous data and attach the error so the strip never flashes empty
      const p = prev[job.id];
      next.push(p ? { ...p, ok: false, error: e.message } : { id: job.id, base: DISPLAY[job.id], ok: false, usage: "query failed", usageColor: "bad", detail: {}, error: e.message, at: Date.now() });
    }
  }
  state = { updatedAt: Date.now(), providers: next };
  return state;
}

export function apply(ctx, entryConfig = {}) {
  const config = resolveConfig(entryConfig);
  let timer = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await refresh(ctx, config);
    } catch (e) {
      log("refresh failed: " + e.message);
    } finally {
      running = false;
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/plan-quota.json",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        if (url.searchParams.get("refresh") === "1") await tick();
      } catch { /* forced refresh failure still returns the cache */ }
      const body = JSON.stringify(state);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
    },
  }), "plan-quota: json route");

  timer = setInterval(tick, Math.max(30, config.interval) * 1000);
  ctx.effect(() => () => clearInterval(timer), "plan-quota: refresh timer");
  tick();
  log("started: refresh every " + Math.max(30, config.interval) + "s, endpoint GET /api/plan-quota.json");
}
