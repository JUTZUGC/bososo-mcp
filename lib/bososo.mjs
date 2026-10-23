// 博搜搜客户端（零依赖，只需 Node 18+ 的内置 fetch）
//
// 两个能力，分两步：
//   search()       关键词搜索，拿到带 token 的结果列表
//   getResource()  用 token 换一份可保存的分享链接
//
// 为什么要封装而不是让调用方自己拼请求：
//   1) 搜索分两次才给全结果，需要按服务端给的节奏再问几次才能拿到完整结果；
//      调用方不用关心这个过程。
//   2) 获取资源时服务端可能回「还在处理」——同一份凭据再问一次通常就能直接拿到结果，
//      所以这里自动重试而不是直接报错。
//   3) 各种失败都有对应的「接下来该怎么做」，集中在这里统一给出建议。

import fs from "node:fs";

export const DEFAULT_BASE_URL = "https://www.bososo.com";

/**
 * 客户端版本号：直接从 package.json 读，避免 lib / mcp-server / package.json 三处各写一份漂移。
 * 读不到（被裁剪的安装包）时退化成 0.0.0，不影响任何功能。
 */
export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/**
 * 客户端标识头：服务端据此区分「谁在调」与版本分布，用于匿名使用统计。
 * 只带版本号，不带任何机器/用户信息。
 */
export const CLIENT_ID = `bososo-mcp/${VERSION}`;

// ---- 关键词编码纠错 ----
// Windows 上部分宿主/控制台会把 UTF-8 的中文当成 GBK 解码，关键词会变成
// 「鍓\uE045槧」这种乱码（混入私用区字符），然后原样发给服务端，搜出来必然为空。
// 这里做一次保守的反向还原：乱码按 GBK 反查回原始字节，再按 UTF-8 解回来。
// 只有「每个字都能反查到 GBK 字节 + 结果能严格按 UTF-8 解码」才采纳，避免误伤正常关键词。
let gbkReverse = null;
let gbkAvailable = true;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function getGbkReverse() {
  if (!gbkAvailable) return null;
  if (gbkReverse) return gbkReverse;
  try {
    const dec = new TextDecoder("gbk");
    const rev = new Map();
    // 单字节区（ASCII + 0x80 的 €）：GBK 解码时遇到 0x80 会单独吃掉一个字节，
    // 不把它们算进来会导致后续字节错位、整串还原失败
    for (let b = 0; b <= 0x80; b++) {
      const ch = dec.decode(Uint8Array.of(b));
      if (ch.length === 1 && !rev.has(ch)) rev.set(ch, [[b]]);
    }
    // 只遍历 GBK 双字节区（0x81-0xFE × 0x40-0xFE），一次性建表后缓存。
    // 同一个汉字可能对应多组字节（GBK 有重复映射），所以每个字保留候选数组，还原时逐个试。
    for (let hi = 0x81; hi <= 0xfe; hi++) {
      for (let lo = 0x40; lo <= 0xfe; lo++) {
        if (lo === 0x7f) continue;
        const ch = dec.decode(Uint8Array.of(hi, lo));
        if (ch.length !== 1) continue;
        const list = rev.get(ch);
        if (!list) rev.set(ch, [[hi, lo]]);
        else if (list.length < 4) list.push([hi, lo]);
      }
    }
    gbkReverse = rev;
    return gbkReverse;
  } catch {
    // 精简版 ICU 不支持 gbk：直接放弃纠错，不影响其它功能
    gbkAvailable = false;
    return null;
  }
}

/**
 * 触发条件：含非 ASCII 字符就尝试一次。
 * 真正的把关在 repairMojibake 里 —— 必须「每个字都能反查到 GBK 字节 + 字节是合法 UTF-8 +
 * 还原结果是纯汉字/常见 ASCII」，正常中文关键词基本不可能同时满足（见 isPlausibleKeyword）。
 */
function looksLikeMojibake(s) {
  if (!s || s.length < 2) return false;
  return /[^\x00-\x7F]/.test(s);
}

/** 还原结果必须是「汉字 + 常见 ASCII」，出现西里尔/希腊/日文等一律视为误判 */
function isPlausibleKeyword(s) {
  if (!s || !/[\u4E00-\u9FFF]/.test(s)) return false;
  return /^[\u4E00-\u9FFF\u3400-\u4DBF0-9A-Za-z\s\-_.,，。:：、（）()【】\[\]&+\/]+$/.test(s);
}

/**
 * 尝试把「UTF-8 被当 GBK 解码」的乱码还原成原文。
 * @param {string} input
 * @returns {string|null} 还原成功返回原文，不像乱码/无法还原返回 null
 */
export function repairMojibake(input) {
  const s = String(input ?? "");
  if (!looksLikeMojibake(s)) return null;
  const rev = getGbkReverse();
  if (!rev) return null;

  // 原始 UTF-8 字节数为奇数时（关键词字数为奇数），GBK 解码会在末尾留下一个 U+FFFD。
  // 末尾残缺的那个字恢复不了，只能把前面能还原的部分用起来。
  const brokenTail = s.endsWith("\uFFFD");
  const source = brokenTail ? s.slice(0, -1) : s;

  // 每个字可能有 1~n 组候选字节，交给回溯去找「能解成合法 UTF-8」的那组
  const options = [];
  for (const ch of source) {
    const pairs = rev.get(ch);
    if (!pairs) return null; // 有字反查不到 → 不是纯 GBK 产物
    options.push(pairs);
  }

  const decode = (bytes) => {
    try {
      return utf8Decoder.decode(Uint8Array.from(bytes));
    } catch {
      return null;
    }
  };

  let attempts = 0;
  const bytes = [];
  const dfs = (i) => {
    if (++attempts > 4096) return null; // 防组合爆炸，超限就放弃
    if (i === options.length) {
      let out = decode(bytes);
      if (!out && brokenTail) {
        // 末尾残缺 1~2 字节：退到能严格解码的最长前缀
        for (let cut = 1; cut <= 2 && bytes.length - cut > 3 && !out; cut++) {
          out = decode(bytes.slice(0, bytes.length - cut));
        }
      }
      return out;
    }
    for (const pair of options[i]) {
      for (const b of pair) bytes.push(b);
      const out = dfs(i + 1);
      for (let k = 0; k < pair.length; k++) bytes.pop();
      if (out) return out;
    }
    return null;
  };

  const recovered = dfs(0);
  if (!recovered || recovered === s || /[\uFFFD]/.test(recovered)) return null;
  if (!isPlausibleKeyword(recovered)) return null;
  return recovered;
}

/** 服务端可能返回的结果码 → 调用方（尤其是 AI）接下来该怎么做 */
const TEMP_UNAVAILABLE = "该平台暂时不可用，换一个平台的资源。";
const HINTS = {
  CAPTCHA_REQUIRED:
    "本机短时间内的「获取资源」次数偏多，需要先在浏览器里打开站点手动完成一次安全验证。被拦下的请求没有产生任何消耗，所以验证之前反复重试没有意义。",
  RATE_LIMITED: "操作过于频繁，等一会儿再试。",
  TOO_MANY_TRANSFERS: "服务端当前任务较多，等几秒后重试。",
  TOO_MANY_SEARCHES: "服务端当前任务较多，等几秒后重试。",
  KEYWORD_BLOCKED: "关键词命中内容风控，换一个关键词。",
  RESTRICTED_RESOURCE: "该条结果无法获取，换一条结果。",
  INVALID_REQUEST: "参数不合法；若是 token 无效，说明这条结果已过期，需要重新搜索拿新的 token。",
  TIMEOUT: "服务端还在处理这条资源；用同一个 token 再请求一次，通常就能直接拿到结果。",
  NO_ACCOUNT: TEMP_UNAVAILABLE,
  CAPACITY_FULL: TEMP_UNAVAILABLE,
  PLATFORM_MAINTENANCE: TEMP_UNAVAILABLE,
};

/** 统一的错误对象：CLI 与 MCP 都只需要读这一种 */
export class BososoError extends Error {
  constructor(message, { code = "UNKNOWN", status = 0, rawError = "", hint = "", retryAfterMs = 0 } = {}) {
    super(message || code);
    this.name = "BososoError";
    this.code = code;
    this.status = status;
    this.rawError = rawError;
    this.hint = hint || HINTS[code] || "";
    // 服务端给出的建议重试间隔
    this.retryAfterMs = Number(retryAfterMs) > 0 ? Number(retryAfterMs) : 0;
  }

  /**
   * 对外表示：默认**不带 rawError**（那是服务端内部的原始报错，对使用者没有可操作性，
   * 只应在排障时看）。需要时用 toDebugJSON()。
   */
  toJSON() {
    return {
      ok: false,
      code: this.code,
      error: this.message,
      hint: this.hint,
      retryAfterMs: this.retryAfterMs,
    };
  }

  /** 排障用：多了 HTTP 状态码与服务端原始报错 */
  toDebugJSON() {
    return { ...this.toJSON(), httpStatus: this.status, rawError: this.rawError };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把查询参数对象拼成 URL（跳过 undefined / 空串） */
function buildUrl(base, path, params = {}) {
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * 发一次请求并解析 JSON；任何非 ok:true 的结果都抛 BososoError。
 * @param {string} url
 * @param {object} init - fetch init
 * @param {number} timeoutMs
 * @returns {Promise<object>} 服务端返回的 JSON 对象
 */
async function requestJson(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    let text;
    try {
      // 统一挂上客户端标识：搜索与获取两条链路都经过这里，服务端按它统计版本分布
      res = await fetch(url, {
        ...init,
        headers: { "x-bososo-client": CLIENT_ID, ...(init?.headers || {}) },
        signal: ctrl.signal,
      });
      // ⚠️ 必须和 fetch 一起待在同一个超时窗口里：服务端可能先把响应头发出来、
      // 正文却还在算（搜索常见 30~40s）。之前 fetch 一返回就 clearTimeout，
      // 正文读取完全没有超时保护 —— 实测 timeoutMs=5000 也能跑 48 秒。
      text = await res.text();
    } catch (e) {
      const aborted = ctrl.signal.aborted || e?.name === "AbortError";
      throw new BososoError(
        aborted ? `请求超时（${timeoutMs}ms）` : `网络请求失败：${e?.message || e}`,
        { code: aborted ? "NETWORK_TIMEOUT" : "NETWORK_ERROR" }
      );
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new BososoError(`响应不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`, {
        code: "BAD_RESPONSE",
        status: res.status,
      });
    }

    if (body && body.ok === true) return body;
    throw new BososoError(body?.error || `HTTP ${res.status}`, {
      code: body?.code || `HTTP_${res.status}`,
      status: res.status,
      rawError: body?.rawError || "",
      retryAfterMs: body?.retryAfterMs,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 创建客户端
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] - 默认取环境变量 BOSOSO_BASE_URL，再退回主站
 * @param {number} [opts.timeoutMs] - 单次 HTTP 请求超时（默认 120s，覆盖「响应头 + 正文」全程）
 */
export function createClient(opts = {}) {
  const baseUrl = String(opts.baseUrl || process.env.BOSOSO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // 默认 120s：实测单次搜索可能跑 40~55s（服务端要等上游检索完才吐正文），
  // 原来 60s 在「超时真正覆盖正文读取」之后会误杀这类正常请求
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120_000;

  /**
   * 关键词搜索。
   *
   * 返回最终结果集。服务端需要一点时间把结果找全，本方法会一直等到结果齐了再返回；
   * 超过 `waitMs` 仍未齐则把当前已有的结果原样返回，并在 `incomplete` 上标出
   * 「结果可能不完整」。
   *
   * @param {object} p
   * @param {string} p.kw - 关键词（必填，上限 200 字符）
   * @param {number} [p.page=1]
   * @param {number} [p.pageSize=20] - 服务端上限 50
   * @param {number} [p.line] - 线路编号（不传用默认线路）
   * @param {"fuzzy"|"precise"} [p.matchMode] - precise 只匹配标题，fuzzy 匹配标题+正文
   * @param {string[]} [p.cloudTypes] - 平台白名单，如 ["quark","uc"]
   * @param {number} [p.timeRangeDays] - 只取最近 N 天的结果，0 = 不限
   * @param {number} [p.maxResults] - 结果上限
   * @param {boolean} [p.refresh] - true 忽略服务端缓存，强制重跑
   * @param {number} [p.waitMs=120000] - 等待结果找全的最长时间
   * @returns {Promise<object>} { keyword, keywordRepaired, total, page, pageSize, maxPage, incomplete, took, waitedMs, note, results: [...] }
   */
  async function search(p = {}) {
    const rawKw = String(p.kw ?? "");
    // 宿主把 UTF-8 当 GBK 解码时进来的关键词是乱码，先尝试还原（不像乱码就原样使用）
    const repaired = repairMojibake(rawKw);
    const kw = String(repaired ?? rawKw).trim();
    if (!kw) throw new BososoError("kw 必填", { code: "INVALID_REQUEST" });
    if (kw.length > 200) throw new BososoError("kw 过长（上限 200）", { code: "INVALID_REQUEST" });

    const page = Math.max(1, Number(p.page) > 0 ? Math.floor(Number(p.page)) : 1);
    const pageSize = Math.min(50, Math.max(1, Number(p.pageSize) > 0 ? Math.floor(Number(p.pageSize)) : 20));
    const waitMs = Number(p.waitMs) > 0 ? Number(p.waitMs) : 120_000;
    const startedAt = Date.now();

    // snapshot 由服务端下发，后续轮询必须原样带回，否则拿不到同一轮的结果
    let snapshot = "";
    let last = null;
    for (;;) {
      last = await requestJson(
        buildUrl(baseUrl, "/api/search.page", {
          kw,
          page,
          pageSize,
          snapshot,
          line: p.line,
          matchMode: p.matchMode,
          cloud_types: Array.isArray(p.cloudTypes) && p.cloudTypes.length ? p.cloudTypes.join(",") : "",
          // 用 time_range_days（真正的天数）；time_range 是 1.0 的 code（1=周/2=月…），别混用
          time_range_days: p.timeRangeDays > 0 ? p.timeRangeDays : "",
          maxResults: p.maxResults,
          refresh: p.refresh ? "1" : "",
        }),
        { method: "GET" },
        timeoutMs
      );
      snapshot = last.snapshot || snapshot;
      if (!last.pending) break;
      if (Date.now() - startedAt >= waitMs) break;
      await sleep(Number(last.retryAfterMs) > 0 ? Number(last.retryAfterMs) : 1500);
    }

    // 只挑出对使用者有意义的字段返回。
    // 服务端响应里还有若干字段（有的只在本次请求过程中用得到）对使用者没有用处，不往外暴露。
    return {
      // 实际用于检索的关键词（乱码已还原时与入参不同，调用方据此提示用户）
      keyword: kw,
      keywordRepaired: Boolean(repaired),
      total: Number(last.total) || 0,
      page: Number(last.page) || page,
      pageSize: Number(last.pageSize) || pageSize,
      maxPage: Number(last.maxPage) || 1,
      incomplete: Boolean(last.pending),
      took: Number(last.took) || 0,
      waitedMs: Date.now() - startedAt,
      note: last.error || "",
      results: Array.isArray(last.results) ? last.results : [],
    };
  }

  /**
   * 获取资源：用搜索结果里的 token 换一份可保存的分享链接。
   *
   * 注意：这个动作服务端要真实处理一次，比较花时间，且请求过多时会要求完成安全验证。
   *
   * 若服务端返回「还在处理」，本方法会用同一个 token 自动再问几次（服务端此时往往已经
   * 处理好了，再问一次就能直接拿到结果），而不是直接失败。
   *
   * @param {string} token - 搜索结果项里的 token
   * @param {object} [p]
   * @param {number} [p.waitMs=90000] - 允许自动重试的总时长
   * @returns {Promise<object>} { ok:true, shareUrl, sharePassword, reused }
   */
  async function getResource(token, p = {}) {
    const t = String(token ?? "").trim();
    if (!t) throw new BososoError("token 必填", { code: "INVALID_REQUEST" });

    const waitMs = Number(p.waitMs) > 0 ? Number(p.waitMs) : 90_000;
    const startedAt = Date.now();

    for (;;) {
      let body;
      try {
        body = await requestJson(
          buildUrl(baseUrl, "/api/transfer"),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: t }),
          },
          timeoutMs
        );
      } catch (e) {
        // TIMEOUT 是「可能仍在后台跑」而不是彻底失败，值得再问一次
        if (e instanceof BososoError && e.code === "TIMEOUT") {
          const wait = Math.max(3000, Number(e.retryAfterMs) || 8000);
          if (Date.now() - startedAt + wait < waitMs) {
            await sleep(wait);
            continue;
          }
        }
        throw e;
      }
      return {
        ok: true,
        shareUrl: body.shareUrl || "",
        sharePassword: body.sharePassword || "",
        reused: Boolean(body.reused),
        waitedMs: Date.now() - startedAt,
      };
    }
  }

  return { baseUrl, search, getResource };
}
