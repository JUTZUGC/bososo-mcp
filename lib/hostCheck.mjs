// ---- 使用范围限制：只允许在百度搭子（DuMate）里调用 ----
//
// 为什么不用 clientInfo：MCP 是本地 stdio 进程，客户端名由宿主自报；
// 百度搭子走 stdio 时用的是 MCP SDK 的默认值（mcp-client/1.0.0），
// 与其它 AI 工具完全一样，无法区分。
// 可靠依据是进程祖先链：百度搭子的 MCP 服务由 dumate-opencode.exe 启动，
// 即使中间隔了 npx，也能在祖先链里找到 DuMate 相关进程。
//
// 这是「软限制」，用于引导用户去百度搭子；本地代码可改、进程名可仿，不构成安全边界。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** 允许的宿主进程名（大小写不敏感，包含即可） */
const HOST_PATTERN = /dumate/i;
const MAX_DEPTH = 6;

export const ALLOW_ANY = /^(1|true|yes)$/i.test(String(process.env.BOSOSO_MCP_ALLOW_ANY || ""));
export const PROBE = /^(1|true|yes)$/i.test(String(process.env.BOSOSO_MCP_CLIENT_PROBE || ""));
export const PROBE_FILE = path.join(os.tmpdir(), "bososo-mcp-host.json");

let cached = null;

/** 按表头定位列索引，兼容 wmic 与 CIM 两种列序 */
function parseTable(text) {
  const rows = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!rows.length) return null;
  const header = rows[0].split(",").map((s) => s.trim().replace(/^"|"$/g, "").toLowerCase());
  const iName = header.indexOf("name");
  const iParent = header.indexOf("parentprocessid");
  const iPid = header.indexOf("processid");
  if (iName < 0 || iParent < 0 || iPid < 0) return null;
  const map = new Map();
  for (const line of rows.slice(1)) {
    const cells = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    const pid = Number(cells[iPid]);
    const ppid = Number(cells[iParent]);
    if (!Number.isFinite(pid)) continue;
    map.set(pid, { name: cells[iName] || "", ppid });
  }
  return map;
}

async function readProcessTable() {
  if (process.platform === "win32") {
    // wmic 快，但新系统可能已移除 → 失败退回 PowerShell CIM
    try {
      const { stdout } = await execFileAsync(
        "wmic",
        ["process", "get", "ProcessId,ParentProcessId,Name", "/format:csv"],
        { windowsHide: true, timeout: 5000 }
      );
      const t = parseTable(stdout);
      if (t) return t;
    } catch {}
    try {
      const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation";
      const { stdout } = await execFileAsync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { windowsHide: true, timeout: 15000 }
      );
      return parseTable(stdout);
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,comm="], { timeout: 5000 });
    const map = new Map();
    for (const line of String(stdout).split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (m) map.set(Number(m[1]), { name: m[3], ppid: Number(m[2]) });
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * 读取当前进程的祖先链（最多 MAX_DEPTH 层）。
 * @returns {Promise<{known:boolean, chain:Array<{pid:number,name:string}>}>}
 *          known=false 表示读不到进程表（权限/系统限制），调用方应放行
 */
export async function detectHostChain() {
  const table = await readProcessTable();
  if (!table) return { known: false, chain: [] };
  const chain = [];
  let pid = process.ppid;
  for (let i = 0; i < MAX_DEPTH && pid > 0; i++) {
    const p = table.get(pid);
    if (!p) break;
    chain.push({ pid, name: p.name });
    pid = p.ppid;
  }
  return { known: true, chain };
}

/** 祖先链里是否出现 DuMate 相关进程 */
export function isAllowedChain(chain) {
  return Array.isArray(chain) && chain.some((p) => HOST_PATTERN.test(String(p?.name || "")));
}

/**
 * 判断当前宿主是否允许使用。
 * 规则：BOSOSO_MCP_ALLOW_ANY 直接放行；探测模式放行并落盘；
 *      能读到进程表时按祖先链判断；读不到进程表则放行（避免误伤正常用户）。
 */
export async function checkHost(clientInfo = null) {
  if (ALLOW_ANY) return { allowed: true, reason: "allow-any" };
  if (PROBE) {
    const info = await detectHostChain();
    const payload = { at: new Date().toISOString(), clientInfo, ...info };
    try {
      fs.writeFileSync(PROBE_FILE, JSON.stringify(payload, null, 2));
      console.error(`[bososo-mcp] 宿主探测结果已写入 ${PROBE_FILE}: ${JSON.stringify(payload)}`);
    } catch (e) {
      console.error(`[bososo-mcp] 宿主探测结果写入失败: ${e?.message || e}`);
    }
    return { allowed: true, reason: "probe", ...info };
  }
  if (cached) return cached;

  const info = await detectHostChain();
  const allowed = !info.known || isAllowedChain(info.chain);
  cached = {
    allowed,
    reason: info.known ? (allowed ? "allowed-host" : "denied-host") : "unknown-fail-open",
    ...info,
  };
  return cached;
}

/** 常见宿主进程名 → 好读的名字（命不中就显示原始进程名） */
const HOST_NAMES = [
  [/\bdumate\b/i, "百度搭子（DuMate）"],
  [/doubao|豆包/i, "豆包"],
  [/cursor/i, "Cursor"],
  [/claude/i, "Claude Desktop"],
  [/windsurf/i, "Windsurf"],
  [/\btrae\b/i, "Trae"],
  [/vscode|visual studio code/i, "VS Code"],
  [/idea|jetbrains|pycharm|webstorm/i, "JetBrains IDE"],
  [/terminal|powershell|cmd\.exe|conhost|wt\.exe|bash|zsh|iterm|warp/i, "普通终端"],
];

/**
 * 描述当前宿主：给用户看的名字 + 进程链（用于排障）
 * @param {Array<{pid:number,name:string}>} chain
 */
export function describeHost(chain = []) {
  const names = chain.map((p) => String(p?.name || "")).filter(Boolean);
  for (const [re, label] of HOST_NAMES) {
    if (names.some((n) => re.test(n))) {
      return { name: label, processes: names.slice(0, 5) };
    }
  }
  return { name: names[0] || "未知程序", processes: names.slice(0, 5) };
}

/** 被拦时给模型/用户的提示（含为什么被拦、怎么改用百度搭子） */
export function buildHostBlocked(chain = []) {
  const host = describeHost(chain);
  return {
    ok: false,
    code: "HOST_NOT_ALLOWED",
    error: "本工具目前仅支持在「百度搭子」中使用。",
    reason: `检测到当前是由「${host.name}」启动的，不在允许范围内。`,
    detected: host,
    howToFix: [
      "1. 打开 https://www.dumate.cn/ ，下载并安装「百度搭子」电脑端（Windows / macOS）",
      "2. 用百度账号登录",
      "3. 在对话窗口里发送：你好，帮我从 github 部署 JUTZUGC/bososo-mcp 到我的电脑上",
      "4. 部署完成后，直接在同一对话窗里说：帮我找一下「囧次元」",
    ],
    hint:
      "请改用「百度搭子」部署后再搜索；本工具不依赖浏览器，也没有网页版入口。" +
      "图文步骤：https://www.bososo.com/pages/guide/guide",
    downloadUrl: "https://www.dumate.cn/",
    guideUrl: "https://www.bososo.com/pages/guide/guide",
  };
}
