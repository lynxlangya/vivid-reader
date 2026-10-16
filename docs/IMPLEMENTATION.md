# MVP 实施计划 · Implementation

> 状态：已确认（2026-10-16）。第 3 节的关键方案对应 D-29～D-36。
> 视觉基准：`prototype/vivid-reader-prototype-v2.html`（已定）与 `prototype/v2-folio-atlas/DESIGN.md`。根目录 `DESIGN.md` 已并入 D-25～D-28；两者冲突时，以 v2 原型和 v2 草案为准。两处例外：原型人物卡的画像占位属于 v0.2（D-35）；原型设置页的模型名已过时，以 pi-ai 目录为准（3.7）。
> 本文细化 `docs/ROADMAP.md` 的 M0～M4，不改变其范围；执行用的 prompt 见 `docs/codex-goals.md`。

## 1. 技术栈与依赖

版本为 2026-10-16 在 npm 上查得的最新稳定版，安装时一律锁定精确版本（`npm install -E`）。若安装时遇到 peer 冲突，选最近的兼容版本，并在本表“理由”栏写明原因。

### 1.1 运行时依赖

| 包 | 版本 | 用途 | 理由 |
|---|---|---|---|
| `react` / `react-dom` | 19.3.1 | 渲染进程 UI | D-21 |
| `@earendil-works/pi-ai` | 1.3.0 | 模型调用（DeepSeek） | D-13、D-20；支持按请求传入 `apiKey`，密钥不必进环境变量；自带 `fauxProvider()`，测试无需真实模型 |
| `@earendil-works/pi-agent-core` | 1.3.0 | 伴读 Agent 与工具调用 | D-13 |
| `typebox` | 1.3.27 | IPC 载荷校验、Agent 工具参数 schema | 与 pi-agent-core 1.3.0 锁定的版本一致，全项目只用一套 schema 库 |
| `fflate` | 0.8.3 | 主进程读取 EPUB（zip）；测试时生成合成 EPUB | 纯 JS、无原生模块、体积小 |
| `linkedom` | 0.18.13 | 主进程解析章节 XHTML | 见 3.2；比 jsdom 轻，够用 |
| `d3-geo` | 3.1.1 | 旁注卡舆图投影（墨卡托、正射小地球） | 见 3.6 |
| `topojson-client` | 3.1.0 | 解码 Natural Earth TopoJSON | 同上 |
| `world-atlas` | 2.0.2 | Natural Earth 50m / 110m 陆地与国界（公有领域） | 同上；离线、体积小 |
| `lxgw-wenkai-webfont` | 1.7.0 | 楷体（伴读的声音，D-27），只打包 Regular | OFL-1.1；应用离线运行，不从 CDN 加载 |

M4 可选“大图”才安装：`maplibre-gl` 6.14.0、`pmtiles` 4.5.0、`@protomaps/basemaps` 5.7.2。

### 1.2 开发依赖

| 包 | 版本 | 说明 |
|---|---|---|
| `electron` | 44.7.2 | 内置 Node 24.21.0、Chromium 152；满足 pi 对 Node ≥ 22.19 的要求 |
| `electron-vite` | 6.0.0 | 主进程 / preload / 渲染进程三端构建 |
| `vite` | 8.3.4 | electron-vite 的 peer |
| `@vitejs/plugin-react` | 6.1.2 | |
| `typescript` | **6.0.3** | **不用 7.x**：typescript-eslint 8.71.2 只支持 `<6.1.0` |
| `@types/node` | 24.19.2 | 与 Electron 内置的 Node 24 对齐 |
| `@types/react` / `@types/react-dom` | 19.3.0 | |
| `@types/d3-geo` / `@types/topojson-client` | 3.1.1 / 3.1.5 | |
| `vitest` | 5.0.5 | 单元测试；本机 Node 22.22.3 满足其要求 |
| `jsdom` | 30.1.3 | 渲染进程组件测试环境 |
| `@playwright/test` | 1.64.1 | 用 `_electron` 做端到端冒烟测试 |
| `eslint` / `@eslint/js` | 10.12.0 / 10.0.1 | |
| `typescript-eslint` | 8.71.2 | |
| `eslint-plugin-react-hooks` | 7.1.1 | |
| `globals` | 17.13.0 | |
| `prettier` | 3.9.10 | |
| `electron-builder` | 26.15.3 | G5 已安装；本机 arm64 未签名 dmg，identity=null，不发布 |

### 1.3 vendored（直接放进仓库的第三方源码）

| 名称 | 版本 | 位置 | 说明 |
|---|---|---|---|
| foliate-js | commit `78914aef4466eb960965702401634c2cb348e9b1`（2026-05-01） | `src/renderer/vendor/foliate-js/` | MIT；npm 上没有正式包。原样复制，附 `LICENSE` 和 `VENDOR.md`（写明来源 URL、commit、本地改动；原则上不做本地改动）。实际集成只移除分页 / 固定版式两处 `allow-scripts`，遵守 2.2，见 D-37（待 review） |

### 1.4 明确不用

- `pi-coding-agent`：AGENTS.md 禁止。
- `better-sqlite3`、`@electron/rebuild`：改用内置 `node:sqlite`（D-29，见 3.1）。
- `@earendil-works/pi-durable`：MVP 不用，对话直接存 SQLite（D-36，见 3.7）。
- ORM（drizzle、kysely 等）：表不多，手写 SQL 加编号迁移文件更透明。

### 1.5 工具链

- 包管理器：**npm**（本机 10.9.8）。没有原生模块后，npm 的默认布局与 electron-builder 配合最省事。
- 本地 Node：22.22.3。`package.json` 写 `"engines": { "node": ">=22.19.0" }`，并加 `.nvmrc`。

## 2. 工程约定

### 2.1 脚本

| 命令 | 内容 |
|---|---|
| `npm run dev` | `electron-vite dev` |
| `npm run build` | `electron-vite build` |
| `npm run typecheck` | 对 node 端和 web 端两个 tsconfig 分别执行 `tsc --noEmit` |
| `npm run lint` | `eslint .` 加 `prettier --check .` |
| `npm test` | `vitest run`（单元测试，不需要密钥） |
| `npm run test:live` | 需要 `DEEPSEEK_API_KEY` 的测试；没有密钥时自动跳过 |
| `npm run test:e2e` | 先 build，再用 Playwright `_electron` 跑冒烟测试 |
| `npm run check` | `typecheck` + `lint` + `test` + `audit:repo`，每一步收尾都要跑 |
| `npm run audit:repo` | 仓库卫生检查，见 2.4 |
| `npm run build:mac` | build 后 electron-builder，arm64 未签名 dmg，禁止自动发布 |

G0 完成后，把这张表写进 AGENTS.md 的“常用命令”节，替换掉“待 M0 初始化后补充”。

### 2.2 Electron 安全默认

- 所有窗口：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`。
- 拦截 `will-navigate`；`setWindowOpenHandler` 一律拒绝（外链交给 `shell.openExternal`，且只放行 https）；权限请求一律拒绝。
- CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' blob:; frame-src blob:; connect-src 'self' vivid-book:`（foliate-js 用 blob URL 装载章节及其中的图片、字体、样式；G1 若发现还缺哪项，按最小范围补充并记录）。渲染进程不发起任何外网请求，Wikidata 等外部请求都在主进程完成。
- G3 原文装载改为主进程本地 `vivid-book:` capability 协议，普通 IPC 不传原文；增加的 CSP scheme 只服务本地当前书，不开放外网（D-38，待 review）。
- EPUB 内的脚本不执行（foliate-js iframe 不开放 scripts）。

### 2.3 IPC

- 协议类型和 typebox schema 放在 `src/shared/ipc.ts`。preload 只暴露一个 `window.vivid` 对象，方法一一对应 IPC 通道，不暴露 `ipcRenderer`。
- 主进程在 `src/main/ipc/` 中对每个入参先做 schema 校验再处理。
- **渲染进程拿不到 API Key**：只有 `setApiKey`、`hasApiKey`、`clearApiKey` 三个通道，不存在任何读取密钥的通道。

### 2.4 测试数据与仓库卫生

- **合成 EPUB**：`tests/fixtures/build-epub.ts` 在测试运行时，用 fflate 把自拟文字生成一个 EPUB，写到临时目录。仓库里只有生成脚本，没有 `.epub` 文件。
  - 文字取自 DESIGN.md 的示例段落，以及其他自拟内容，共 5 章。
  - 第四、五章各放一个唯一的“哨兵”字符串（如 `SENTINEL-AFTER-BOUNDARY-4`），并埋几个只在后文出现的实体，专门用于防剧透测试。
- **真实测试书**：路径由环境变量 `VIVID_TEST_EPUB` 指定，文件放在仓库外。用到它的测试和脚本在没有这个变量时自动跳过。
- **报告**：凡是由真书生成的结果（实体表、M1 核对报告等）只写到 `~/Library/Application Support/Vivid/` 下，不进仓库。可以提交的只有不含名字和原文的汇总数字。
- **`npm run audit:repo`**：
  - 若 `git ls-files` 中出现 `.epub`、`.sqlite`、`.db`、`.pmtiles` 文件，失败；
  - 若 `src/`、`tests/` 中出现单段超过 200 个汉字的字符串字面量，失败（防止把原文粘进代码）；
  - 若源码中出现 `console.log` 打印含 `key` / `apiKey` 的变量，失败。

### 2.5 目录

沿用 ARCHITECTURE 第 9 节，补充以下目录：
- `src/main/boundary/`：已读边界状态机；
- `src/main/content/`：章节文本访问层，所有读取书本内容的代码都从这里过，并在这里统一截断；
- `src/renderer/vendor/`：vendored 的 foliate-js；
- `src/renderer/styles/tokens.css`：v2 设计令牌；
- `tests/fixtures/`：合成 EPUB 生成脚本；
- `docs/spikes/`：技术探针结论。

## 3. 关键技术方案

### 3.1 SQLite：用内置 `node:sqlite`（D-29）
- 主进程使用 `DatabaseSync`。Electron 44 内置的 Node 24.21 和本机 Node 22.22 都自带这个模块，API 相同，所以单元测试和应用跑的是同一套代码。不需要原生编译，也不需要 `@electron/rebuild`。
- 风险：Node 仍把它标为 Experimental（API 已稳定）。为此只在 `src/main/db/` 内部使用它，对外暴露自己的 repository 接口，日后需要时可以换回 better-sqlite3。
- 迁移：`src/main/db/migrations/NNN_name.sql` 按编号执行，执行记录写入 `schema_migrations` 表。
- 写操作较重的地方（流水线批量写入）用事务；如果确实阻塞了 UI，再挪到 `utilityProcess`。

### 3.2 章节解析与“偏移 ↔ CFI”（D-31）
- **方案 A（默认）**：主进程用 fflate 解包，用 linkedom 解析 XHTML。按 foliate-js 的 `epubcfi.js` 生成 CFI，并为每章建立“规范化纯文本偏移 ↔ (文本节点路径, 节点内偏移) ↔ CFI”的映射。书本内容从头到尾只在主进程里处理。
- **验收测试**：在合成 EPUB 和真书（若提供）上随机抽 200 个偏移。主进程生成 CFI 后，在渲染进程的 foliate-js 中解析回 Range，取出的文字必须和主进程偏移处的文字逐字相同。不一致率必须为 0。
- **方案 B（只在 A 不达标时启用）**：主进程开一个隐藏的 `BrowserWindow` 专门做解析：`sandbox` 开启、`show: false`，不加载任何远程内容，不持有密钥，也不调用模型，结果只经 IPC 交回主进程。它被视为主进程信任边界的一部分。切换到 B 前，先把 A 的失败证据写进 `docs/spikes/M0-offset-cfi.md`。

### 3.3 标注注入【实现细节，M0 探针决定】
- 首选 **CSS Custom Highlight API**（`CSS.highlights` 加 `::highlight()`）。它完全不改 iframe 的 DOM，foliate 生成的位置 CFI 不受影响。悬停判定用 `caretPositionFromPoint` 命中测试。
- 若 Chromium 152 的 `::highlight` 不支持 `text-decoration` 或 `text-underline-offset`，退回方案二：用带 `data-vivid-inert` 的 `<span>` 包裹实体，并确认 foliate 生成 CFI 时会跳过这些节点。
- 两种方案都要通过同一个测试：同一页注入标注前后，foliate 报告的当前位置 CFI 完全相同。

### 3.4 已读边界（D-33）
- 边界状态机放在主进程 `src/main/boundary/`。渲染进程只上报 `relocate` 事件：当前 CFI，加上导航方式 `next` / `prev` / `jump`。
- **自动推进**只在同时满足两个条件时发生：导航方式为 `next`，且翻页前所在页的起点不晚于当前边界（读者正站在边界上往前读）；新的一页停留满 **5 秒**才推进到该页末尾。阈值写成配置常量，之后再调。
- **跳转**（目录、搜索、引用链接、拖动）**永不推进**。跳到边界之后的地方读，边界不动；页边会出现一行烟色小字“此处在已读范围之后 · 设为已读至此”，读者点击后才推进。
- **自动推进只增不减**；设置里的**手动调整**可以前后移动，这是读者明确的意图。手动往回调时，当前这本书的伴读对话归档，另起新会话，避免旧对话里带着后文。
- 状态机要做成纯函数，覆盖：顺序阅读、回头重读、跳读、跳读后顺序读、手动前调、手动后调。

### 3.5 预处理与剧透隔离（D-32）
- 导入时的流水线**允许读全书**，否则做不了抽取和链接。这是唯一的例外，它的产物受下面三条约束：
  1. **抽取阶段 LLM 写的自由文本（`note` 等）永不显示，也永不进入伴读上下文**，只用于消歧。界面上能看到的只有外部事实（Wikidata）和按 3.6 规则生成的释义。
  2. 所有读取路径（IPC 给渲染进程、Agent 工具、释义输入、足迹、目录统计）都经过 `src/main/content/` 的边界过滤，按位置截断。
  3. 导入进度页只显示数量。
- 原则：“流水线可以知道全书，但读者和伴读只能经过边界过滤的出口拿到东西。”

### 3.6 旁注卡：数据与地图（D-30、D-34、D-35）
- **舆图插页用 SVG 渲染**：d3-geo 投影 world-atlas 的 50m 陆地与国界，加上经纬网、图框刻度、比例尺、正射小地球、参照地和距离线，与 v2 原型一致。数据随应用打包，悬停时同步渲染，不用为每张卡片创建一个 WebGL 上下文。
  - 理由：v2 的图版语法（刻度、小地球）用 MapLibre 很难做；悬停 250ms 就要出卡，WebGL 初始化太慢。
- **参照地**：先取本书已读范围内、距离最近的两个已链接地点；没有就取所在国首都。距离用球面距离，四舍五入到百公里，写成“约 1000 公里”。
- **可缩放的大图**（单击舆图打开）：MapLibre 加 PMTiles，放到 M4，属于可选项。底图用脚本下载到 userData，不进仓库（`.gitignore` 已屏蔽 `*.pmtiles`）。
- **释义（在本书此处）**：
  - 输入只包含**该提及之前的本章文字**，加上**该提及之前**同一实体历次提及的短句。输入完全由提及的位置决定，与边界无关，所以缓存键 `(实体, 章节)` 在边界变化时仍然有效。
  - **提及位于边界之后时，不返回实体标注或卡片**，避免基础层名称泄露后文专属实体；读者明确设置已读后再启用（D-41，待 review）。
- **足迹**（“第三章初见 · 已见 N 次”）：只统计边界之前的提及。
- **人物卡**：MVP 只做生卒时间轴和基础事实（ROADMAP 已把真实画像列入 v0.2），不显示画像位。

### 3.7 伴读 Agent（D-36）
- 工具：`get_reading_context`、`read_text`、`search_book`、`lookup_entity`、`summarize`，全部通过 `src/main/content/` 截断。工具参数里没有任何可以指定边界的字段。
- “总结选中”：只有选区完全在边界之前时才可用；否则按钮禁用，并提示“这段在已读范围之后”。
- 引用链接只能指向边界之前的位置。生成后再校验一次，越界的引用直接删掉。
- 对话存在 `conversations` 表，每本书一条进行中的会话；按 3.4 规则归档。
- 模型 ID 不写死，从 pi-ai 的目录读取 `deepseek` provider 的模型，默认 `deepseek-flash`（v2 原型设置页里的 `deepseek-chat` / `deepseek-reasoner` 已过时）。

### 3.8 字体（D-27、D-36）
- 宋体：`Source Han Serif SC` → `Noto Serif SC` → `Songti SC`，用系统字体，不打包。
- 楷体：打包 `lxgw-wenkai-webfont` 的 Regular。
- 读者把正文切成楷体时，伴读回答与卡片释义改用宋体（D-27）。

## 4. 开发顺序

每一步对应 `docs/codex-goals.md` 里的一个 `/goal`。上一步验收通过、你确认后，再开始下一步。

### G0 · 工程骨架（M0 前半）
1. `npm init`，安装 1.1、1.2 中除 M4 专用以外的依赖（锁定精确版本），配置 electron-vite 三端构建，TypeScript `strict`。
2. 落实 2.2 的安全默认、2.3 的 IPC 骨架，以及 2.1 的全部脚本。
3. `src/shared/position.ts`：`Position` 接口（`compare`、`toString`、`fromString`），先写类型，CFI 实现留到 G1。
4. `tokens.css`：从 v2 原型抄日夜两套令牌；打包楷体。主窗口显示一页静态示例正文，按 v2 版心排版：书口、页码、进度发丝线。
5. `tests/fixtures/build-epub.ts`，以及 `audit:repo`。
6. 一个 Playwright 冒烟测试：应用能启动，窗口标题为“历历”。
7. 更新 AGENTS.md 的“常用命令”。

**验收**：`npm run check`、`npm run build`、`npm run test:e2e` 全部通过；`git ls-files` 中没有书籍文件。

### G1 · 阅读器探针（M0 后半）
1. vendored foliate-js，按 1.3 的要求放置。
2. 导入：打开文件对话框 → 主进程按 hash 把 EPUB 复制到 `userData/books/` → 经 IPC 以字节传给渲染进程 → foliate-js 打开。
3. 分页阅读、目录、键盘翻页；排版按 v2（宋体 19px / 1.85、两端对齐、首行缩进、版心宽度）。
4. 保存并恢复当前 CFI；`Position` 的 CFI 实现，用 foliate 的 CFI 比较，附单元测试。
5. 3.3 的标注探针：硬编码两个实体，在 iframe 中显示专名线，悬停弹出简易卡片。
6. 3.2 的偏移 ↔ CFI 探针与往返测试，结论写进 `docs/spikes/M0-offset-cfi.md`。
7. 密钥：设置 / 检查 / 清除 DeepSeek Key（`safeStorage`）；主进程用 pi-ai 调用一次 DeepSeek（`test:live`）。

**验收**：ROADMAP M0 的四条；偏移往返不一致率为 0；标注注入前后 CFI 不变；探针结论已写入文档。

### G2 · 抽取质量（M1）
1. 数据库：按 ARCHITECTURE 第 7 节建表，并加 `pipeline_jobs`（步骤、章节、状态，可断点续跑）和 `wikidata_cache`。
2. 流水线 ① 解析 → ② 抽取（DeepSeek，固定前缀以命中缓存，JSON 输出用 typebox 校验，失败重试）→ ③ 合并 → ④ Wikidata 链接（中英文检索、取 P625 / P31 / P17 / P18 / P569 / P570、单候选直接采用、多候选交给 LLM 消歧、记录置信度）。
3. Wikidata 客户端：带规范的 `User-Agent`，限速，响应缓存，失败退避。单元测试用录制的 Wikidata 响应（外部数据，可以入库）。
4. 只跑第一、二章，做一个开发用的核对页（只在 `dev` 模式出现），逐条显示：抽取结果、链接候选、采用项、置信度，并可标记对 / 错。
5. 统计脚本输出召回、链接准确率、未链接比例、token、成本、耗时。报告写到 userData，不进仓库。

**验收**：合成 EPUB 上全流程跑通，且可以断点续跑；真书第一、二章的报告已生成；**然后停下，等你人工核对**（地点链接准确率目标 ≥ 90%）。

### G3 · 旁注卡（M2）
1. 流水线 ⑤ 定位提及（表面形式和别名做字符串匹配 → 偏移 → CFI 区间）→ ⑥ 稀疏化（每章首次出现、重要度阈值、“已知”、单屏上限）。人工纠错优先，重跑不覆盖。
2. 阅读器按章注入专名线，按 D-25 / D-28 和 v2 规范实现。
3. 旁注卡完全按 v2：
   - 右页边 ≥ 400px 时放在页边，用引线从版心右缘连到卡片；页边不够时放到当前行下方，并给遮住的整行加蒙层；
   - 舆图插页按 3.6；
   - 状态：加载中、未能定位、生成失败；
   - 时机：悬停 250ms 打开，离开 200ms 关闭；单击固定，`Esc` 关闭。
4. 释义预取与缓存（3.6）；足迹；标为已知；纠错面板（Wikidata 候选、搜索、“这不是一个具体地方”）。
5. 已读边界状态机（3.4）；进度发丝线（石青当前点、朱色边界刻度）；目录中的朱色“以下未读”；夜间主题。
6. 防剧透测试：IPC、释义输入、足迹、目录统计中都不出现边界后的提及或哨兵文字。

**验收**：ROADMAP M2 各条；v2 设计规范第 13 节检查清单逐条自查；防剧透测试通过。

### G4 · 伴读（M3）
1. pi-agent-core 装配 3.7 的工具集；系统提示写明边界、读者标为“已知”的实体、书籍类型。
2. 伴读栏按 v2 的批注本样式：提问用黑体右对齐，回答用楷体、不加气泡；引用为“见第三章 ›”；快捷操作用中点分隔；`⌘↩` 发送；流式输出。
3. 正文选区工具条只有“问伴读”和“总结”两项。
4. 防剧透测试（用 `fauxProvider` 编排模型“试图读后文”）：
   - 模型请求越界范围；
   - 搜索只在后文出现的词；
   - 查询后文才出现的实体；
   - “总结至此”、“总结本章”（当前章跨越边界时）。
   断言所有工具结果和最终消息里都没有哨兵字符串和后文实体。

**验收**：ROADMAP M3 各条；上述测试全部通过；有密钥时用 `test:live` 跑一次真实对话。

### G5 · 打磨与开源准备（M4）
1. 书架（题签封面，六种纸色由书名哈希决定）、导入页（点线步骤、只显示数量）、设置（字体对调预览、标注密度与类型、密钥、模型列表、手动调整边界、专注模式）。
2. 可访问性：按 `⌥` 进入标注导航，`Tab` 切换，`↩` 打开，`Esc` 退出；`prefers-reduced-motion`；焦点环；正文 26px 时布局不崩。
3. 可选：MapLibre + PMTiles 大图。
4. 用 electron-builder 打未签名的 dmg；README、截图（用合成 EPUB 截，不用真书）、LICENSE、CONTRIBUTING。
5. 用真书全书跑一遍，修正纠错流程中的问题。

**验收**：ROADMAP M4 各条；在干净的 clone 上执行 `npm ci && npm run check && npm run build` 通过。

## 5. 每一步的完成标准

- `npm run check` 通过；UI 有改动时 `npm run test:e2e` 也要通过。
- 涉及防剧透、CFI、实体定位的改动都附带单元测试（AGENTS.md）。
- 没有书籍原文、EPUB 或衍生缓存进入 git。
- 新增依赖锁定精确版本，并更新本文第 1 节。
- 遇到第 3 节没有覆盖的产品或架构问题时，停下来提问，不要自行决定。
- 每一步结束时提交一次，commit message 用英文。
