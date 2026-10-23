# 博搜搜 MCP 工具

> 把博搜搜的资源搜索能力接给 AI —— 支持 **MCP 协议**，同时提供**命令行工具**。

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![MCP](https://img.shields.io/badge/MCP-stdio-blueviolet)
![零依赖](https://img.shields.io/badge/dependencies-0-success)
![License](https://img.shields.io/badge/license-MIT-blue)

**不需要任何 API Key。** 零第三方依赖，只用 Node 18+ 内置能力。

> ⚠️ **本项目目前仅支持在「百度搭子」中使用。** 在 Cursor、Claude Desktop 等其它 AI 工具里接入会被拒绝，并提示改用百度搭子（见 [使用范围](#使用范围仅支持百度搭子)）。

> 本目录可以整体作为一个独立仓库使用：`cli.mjs` / `mcp-server.mjs` 都在根目录。
> 如果你把它放在别的仓库的子目录里，把下面命令里的路径相应调整即可。

---

## 一键部署（仅支持：百度搭子）

不想装 Node、不想敲命令？让 AI 把这一切做完。

> ⚠️ **仅支持电脑端**（Windows / macOS / Linux）。手机、平板装不了也用不了。

**1. 装客户端**

打开 [百度搭子官网](https://www.dumate.cn/)，下载电脑端客户端并安装，用百度账号登录。

**2. 发送部署指令**

进入对话窗口，直接发这一句：

```
你好，帮我从 github 部署 JUTZUGC/bososo-mcp 到我的电脑上
```

**3. 等它装完**

AI 会自动完成下载、环境配置，对话里提示「部署成功」就结束了。

**4. 开始搜资源**

不用再启动任何程序，直接在同一个对话窗口里说你要找什么：

> 帮我找一下「囧次元」的安装包

也可以说得很短，怎么顺口怎么来：

- 搜 囧次元
- 找 囧次元
- 囧次元 资源
- 下载 囧次元
- 有没有《遮天》4K
- 来点剪映教程

AI 会搜出结果列表，你回复序号，它就把**网盘分享链接和提取码**发给你。

> 全程不需要 GitHub 账号，也不用自己装 Node.js / Git。部署指令可以反复发送，卡住了就再发一次。
> 图文步骤见 [博搜搜 · AI 工具接入引导](https://www.bososo.com/pages/guide/guide)。

---

## 目录

- [一键部署（仅支持：百度搭子）](#一键部署仅支持百度搭子)
- [这是什么](#这是什么)
- [特性](#特性)
- [环境要求](#环境要求)
- [使用范围（仅支持百度搭子）](#使用范围仅支持百度搭子)
- [快速开始](#快速开始)
- [命令行用法](#命令行用法)
- [MCP 工具契约](#mcp-工具契约)
- [接入 AI 客户端](#接入-ai-客户端)
- [常见问题](#常见问题)
- [失败时怎么办](#失败时怎么办)
- [免责声明](#免责声明)
- [License](#license)

---

## 这是什么

博搜搜是一个网盘资源搜索引擎。这个工具把它的两个能力包装成 **AI 可以直接调用** 的形式：

| 步骤 | 工具 | 作用 |
|---|---|---|
| 1 | `bososo_search` | 按关键词搜索，列出找到的资源 |
| 2 | `bososo_get_resource` | 把其中一条换成**可保存的分享链接** |

两步的顺序不能颠倒：搜索结果里每条都带一个 **`token`**，它是第 2 步的唯一凭据。

**一个典型的对话**：

> 用户：帮我找一下「囧次元」的安装包
> AI：*调用 `bososo_search`，关键词「囧次元」* → 找到 42 条 → *挑最相关的一条调用 `bososo_get_resource`* → 拿到一条夸克网盘的分享链接和提取码。

```
├── README.md           本文件
├── lib/bososo.mjs      客户端封装
├── cli.mjs             命令行工具
└── mcp-server.mjs      MCP server
```

---

## 特性

- **双形态**：既能作为 MCP server 接入 AI 客户端，也能当普通命令行工具用
- **零依赖**：不需要 `npm install`，clone 下来就能跑
- **无需密钥**：走公开接口，不用申请任何 token 或 API Key
- **两步操作自动衔接**：`token` 的传递、等待、重试都在工具内部处理，调用方只管拿结果
- **错误可操作**：每个失败都会带 `code` + `hint`，明确告诉你下一步该做什么（而不是丢一句「失败」）

---

## 环境要求

- **Node.js ≥ 18**（需要内置的 `fetch`）
- 能访问 `https://www.bososo.com`

```bash
node -v   # 确认 >= 18
```

---

## 使用范围（仅支持百度搭子）

MCP 版本**只允许在 [百度搭子](https://www.dumate.cn/) 中使用**。

- **在百度搭子里**：正常连接、正常搜索、正常拿分享链接。
- **在其它 AI 工具里**（Cursor、Claude Desktop、Windsurf 等）：连接能建立，但调用工具时会返回：

  ```json
  {
    "ok": false,
    "code": "HOST_NOT_ALLOWED",
    "error": "本工具目前仅支持在「百度搭子」中使用。",
    "reason": "检测到当前是由「Cursor」启动的，不在允许范围内。",
    "detected": { "name": "Cursor", "processes": ["node.exe", "Cursor.exe"] },
    "howToFix": [
      "1. 打开 https://www.dumate.cn/ ，下载并安装「百度搭子」电脑端（Windows / macOS）",
      "2. 用百度账号登录",
      "3. 在对话窗口里发送：你好，帮我从 github 部署 JUTZUGC/bososo-mcp 到我的电脑上",
      "4. 部署完成后，直接在同一对话窗里说：帮我找一下「囧次元」"
    ],
    "hint": "请改用「百度搭子」部署后再搜索；本工具不依赖浏览器，也没有网页版入口。图文步骤：https://www.bososo.com/pages/guide/guide",
    "downloadUrl": "https://www.dumate.cn/",
    "guideUrl": "https://www.bososo.com/pages/guide/guide"
  }
  ```

判断依据是「启动 MCP 服务的进程链里是否出现百度搭子的进程」，与客户端自报的名称无关
（百度搭子走 stdio 时自报的是 MCP SDK 默认值 `mcp-client`，和其它工具重名）。

> 命令行工具 `bososo`（`node cli.mjs ...`）与 MCP 共用同一条限制：同样只能在百度搭子环境中执行；
> 只有 `--help` 不受限制。在普通终端里直接运行会返回 `HOST_NOT_ALLOWED` 并给出引导。

---

## 快速开始

> 已经用上面的百度搭子部署好了？这一节可以跳过，直接看 [接入 AI 客户端](#接入-ai-客户端)。
>
> ⚠️ 下面的命令同样**只能在百度搭子环境中执行**（MCP 与命令行共用同一条使用范围限制），
> 在普通终端里直接运行会被拒绝并提示去装百度搭子。`node cli.mjs --help` 不受限制。

### 1. 拿到代码

```bash
git clone <本仓库地址>
cd <仓库目录>
```

不需要 `npm install`。

### 2. 试一次搜索

```bash
node cli.mjs search "囧次元"
```

> 第一次调用会慢一些（通常 20~40 秒）——搜索需要一点时间把结果找全，工具会等到结果齐了再返回。

输出类似：

```
共 42 条结果（第 1 页 / 共 3 页，服务端检索 18240ms）

[1] 囧次元.apk
    平台：夸克网盘    时间：2026-03-15
    token：s1.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

要保存这条资源：node cli.mjs get "<token>"
```

### 3. 把结果换成可保存的链接

复制上一步某个结果的 `token`：

```bash
node cli.mjs get "s1.xxxxxxxxxxxx"
```

```
✅ 获取成功
分享链接：https://pan.example.com/s/xxxxxxxxxxxx
提取码：abcd
```

### 4. （可选）接入 AI 客户端

见 [接入 AI 客户端](#接入-ai-客户端)。

---

## 命令行用法

```bash
node cli.mjs <命令> [参数]
```

### `search <关键词>`

```bash
node cli.mjs search "囧次元"
node cli.mjs search "酷我音乐" --clouds quark,uc --page-size 50 --json
node cli.mjs search "剪映" --days 30 --match-mode precise
```

| 选项 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `--page <N>` | ≥1 | `1` | 页码 |
| `--page-size <N>` | 1~50 | `20` | 每页条数 |
| `--line <N>` | 线路编号 | 默认线路 | 不同线路的搜索结果不同 |
| `--match-mode <M>` | `fuzzy` / `precise` | `fuzzy` | `precise` 只按标题匹配（更准、更少）；`fuzzy` 标题+正文都匹配 |
| `--clouds <A,B>` | `quark,uc,baidu,xunlei,guangyapan` | 不限 | 只看指定网盘的结果 |
| `--days <N>` | ≥0 | 不限 | 只看最近 N 天 |
| `--max <N>` | 1~500 | 服务端决定 | 结果上限 |
| `--refresh` | 开关 | 关 | 忽略缓存，重新检索一遍 |
| `--wait <秒>` | ≥5 | `120` | 等待结果找全的最长时间 |

### `get <token>`

```bash
node cli.mjs get "s1.xxxxxxxxxxxx"
node cli.mjs get "s1.xxxxxxxxxxxx" --json
```

| 选项 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `--wait <秒>` | ≥5 | `90` | 服务端还在处理时，允许等待/重试的最长时间 |

### 通用选项

| 选项 | 说明 |
|---|---|
| `--json` | 输出 JSON，给程序 / AI 消费（人类可读信息走 stderr，JSON 走 stdout） |
| `--base-url <URL>` | 覆盖接口域名，默认 `https://www.bososo.com` |
| `--verbose` | 出错时额外打印服务端原始报错（排障用） |
| `-h, --help` | 帮助 |

### 退出码

| 码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 失败（需要安全验证、请求过多、资源取不到等，详见 [失败时怎么办](#失败时怎么办)） |
| `2` | 用法错误（缺参数、命令拼错） |

---

## MCP 工具契约

### `bososo_search`

**入参**（`keyword` 必填）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `keyword` | string | — | **必填**，上限 200 字符 |
| `page` | integer ≥1 | `1` | 页码 |
| `pageSize` | integer 1~50 | `20` | 每页条数 |
| `matchMode` | `fuzzy` \| `precise` | `fuzzy` | 匹配模式 |
| `cloudTypes` | string[] | 不限 | `quark` / `uc` / `baidu` / `xunlei` / `guangyapan` |
| `timeRangeDays` | integer ≥0 | 不限 | 最近 N 天 |
| `maxResults` | integer 1~500 | 服务端决定 | 结果上限 |
| `refresh` | boolean | `false` | 忽略缓存重新检索 |
| `waitSeconds` | integer 5~300 | `120` | 等待结果找全的最长秒数 |

**返回**

| 字段 | 类型 | 说明 |
|---|---|---|
| `total` | number | 命中总数 |
| `page` / `maxPage` | number | 当前页 / 总页数 |
| `incomplete` | boolean | `true` = 还没找全，结果可能不完整（可再调用一次或加大 `waitSeconds`） |
| `tookMs` | number | 服务端检索耗时 |
| `waitedMs` | number | 本次实际等待耗时 |
| `serverNote` | string | 服务端提示，正常为空 |
| `resultCount` | number | 本次返回条数 |
| `results[]` | array | 见下 |
| `nextStep` | string | 下一步提示 |

`results[]` 元素：

| 字段 | 类型 | 说明 |
|---|---|---|
| `n` | number | 序号 |
| `title` | string | 资源标题 |
| `platform` | string | 中文平台名，如 `夸克网盘` |
| `datetime` | string | 资源时间，`YYYY-MM-DD` |
| `token` | string | **第 2 步要用的凭据** |

```json
{
  "total": 42, "page": 1, "maxPage": 3,
  "incomplete": false, "tookMs": 18240, "waitedMs": 18310,
  "serverNote": "", "resultCount": 2,
  "results": [
    { "n": 1, "title": "囧次元.apk", "platform": "夸克网盘", "datetime": "2026-03-15", "token": "s1.xxxxxxxxxxxx" },
    { "n": 2, "title": "酷我音乐_v9.3.0.apk", "platform": "百度网盘", "datetime": "2026-03-12", "token": "s1.yyyyyyyyyyyy" }
  ],
  "nextStep": "用 bososo_get_resource 传某个结果的 token，即可拿到可保存的分享链接。"
}
```

### `bososo_get_resource`

**入参**（`token` 必填）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `token` | string | — | **必填**，来自 `bososo_search` |
| `waitSeconds` | integer 5~180 | `90` | 允许等待/重试的最长秒数 |

**成功返回**

| 字段 | 类型 | 说明 |
|---|---|---|
| `shareUrl` | string | 可保存的分享链接 |
| `sharePassword` | string | 提取码，可能为空串 |
| `reused` | boolean | `true` = 这条资源此前已获取过，本次直接返回了已有结果 |

```json
{ "ok": true, "shareUrl": "https://pan.example.com/s/xxxxxxxxxxxx", "sharePassword": "abcd", "reused": false, "note": "" }
```

**失败返回**（`isError: true`）

```json
{
  "ok": false,
  "code": "INVALID_REQUEST",
  "error": "token 无效，请重新搜索后再获取",
  "hint": "参数不合法；若是 token 无效，说明这条结果已过期，需要重新搜索拿新的 token。",
  "retryAfterMs": 0
}
```

失败时以 `hint` 为准决定下一步。

### 支持的 MCP 方法

`initialize` / `tools/list` / `tools/call` / `ping`（stdio 传输，换行分隔的 JSON-RPC 2.0）

---

## 接入 AI 客户端

> 仅支持百度搭子。其它客户端虽然能连上，但调用工具会被 `HOST_NOT_ALLOWED` 拦下并提示改用百度搭子
> （见 [使用范围](#使用范围仅支持百度搭子)）。

在客户端的 MCP 配置里加上这一段（`args` 请填**绝对路径**）：

```json
{
  "mcpServers": {
    "bososo": {
      "command": "node",
      "args": ["<本目录的绝对路径>/mcp-server.mjs"]
    }
  }
}
```

也可以手动验证 server 是否正常：

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node mcp-server.mjs
```

应当看到两行 JSON 响应（`initialize` 结果 + 两个工具的定义）。

> MCP server 的所有日志都走 stderr，stdout 只输出 JSON-RPC 消息，不会污染协议流。

---

## 常见问题

**Q：能在 Cursor / Claude Desktop / Windsurf 里用吗？**
目前不行。MCP 与命令行 `bososo` 都只支持百度搭子，在其它工具里调用会返回 `HOST_NOT_ALLOWED`，并提示去装百度搭子。

**Q：需要申请 API Key 吗？**
不需要。走公开接口，clone 下来直接就能用。

**Q：为什么搜索这么慢？**
搜索需要一点时间把结果找全，通常 20~40 秒。工具会等到结果齐了再返回，所以单次调用耗时长是正常现象。**不要因为慢就重复调用**——重复调用不会更快。

**Q：搜索很慢的话，能先看部分结果吗？**
可以。把 `waitSeconds` 调小（比如 `10`），工具会在等不到全量时先把已有的结果返回，并在 `incomplete` 里标 `true`。

**Q：为什么有时要求我做「安全验证」？**
短时间内获取资源过于频繁时会触发。**这个验证只能由人在浏览器里手动完成**，工具不做任何绕过。被拦下的请求没有产生任何消耗，所以在完成验证之前反复重试没有意义。

**Q：`token` 能用多久？**
长期有效。但如果服务端返回「token 无效」，说明这条结果已经失效，重新搜索拿一个新的即可。

**Q：为什么同一条资源有时拿不到？**
常见原因是对方的分享链接失效了、内容被平台限制，或者当前网盘平台临时不可用。换一条结果或换一个平台即可。

**Q：为什么我搜到的和网页上搜到的条数不一样？**
工具默认等到结果全了再返回；如果你调小了 `waitSeconds`，拿到的是当前已有的部分结果（`incomplete: true`）。

**Q：能不能不带 Node 用？**
工具本身是 Node 脚本。MCP server 只依赖 Node ≥18，没有其它运行时要求。

**Q：`--json` 的输出怎么有两条流？**
人类可读的提示走 stderr，JSON 走 stdout，所以可以直接 `node cli.mjs search xxx --json > out.json` 而不被提示文字污染。

**Q：Windows 上路径怎么写？**
MCP 配置里的 `args` 用双反斜杠或正斜杠都可以，例如 `"D:/tools/bososo-mcp/mcp-server.mjs"`。

---

## 失败时怎么办

| `code` | 你会看到 | 怎么办 |
|---|---|---|
| `CAPTCHA_REQUIRED` | 需要完成安全验证 | **在浏览器里打开站点手动完成一次验证**，验证前重试没有意义 |
| `RATE_LIMITED` | 操作过于频繁 | 等一会儿再试 |
| `TOO_MANY_TRANSFERS` | 服务端当前任务较多 | 等几秒再试 |
| `TOO_MANY_SEARCHES` | 服务端当前任务较多 | 等几秒再试 |
| `KEYWORD_BLOCKED` | 关键词被拦 | 换一个关键词 |
| `RESTRICTED_RESOURCE` | 该条结果无法获取 | 换一条结果 |
| `INVALID_REQUEST` | 参数或 token 无效 | 重新搜索拿新 token |
| `TIMEOUT` | 还在处理中 | 工具已自动重试；仍失败就稍后再试一次 |
| `SHARE_NOT_EXIST` / `SHARE_RESTRICTED` / `SHARE_SENSITIVE` / `PASSCODE_WRONG` / `TRANSFER_LIMIT` | 该条资源当前取不到 | 换一条结果 |
| `CAPACITY_FULL` / `NO_ACCOUNT` / `PLATFORM_MAINTENANCE` | 该平台暂时不可用 | 换一个平台的资源 |
| `INTERNAL` | 服务端异常 | 稍后再试 |

---

## 免责声明

- 本工具只是一个**接口客户端**，本身不存储、不传播任何文件，也不提供下载或在线播放能力。
- 所有搜索结果与分享链接均来自**第三方网盘平台**，工具不对其内容、合法性、安全性做任何保证。
- 请在使用前自行判断资源的合法性与安全性，并遵守所在地区的法律法规及各网盘平台的服务条款。
- 请勿将本工具用于任何侵权、违法或商业侵权的用途。如有侵权问题，请联系相关网盘平台处理。

---

## License

MIT
