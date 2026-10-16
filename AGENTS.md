# AGENTS.md

## 项目概述

「历历 · Vivid」是带 AI 伴读的 macOS 桌面电子书阅读器，以安静阅读和“悬停即见真实地图、语境释义”为核心体验。
当前处于设计阶段，尚无可运行代码；MVP 只支持 EPUB，只针对《枪炮、病菌与钢铁》中译本。
阅读是主角，AI 是配角；总结由读者按需触发，伴读遵守已读边界。

## 文档地图

| 文档 | 职责 |
|---|---|
| [README.md](README.md) | 项目入口、MVP 概览、当前状态与文档导航 |
| [docs/VISION.md](docs/VISION.md) | 产品起源、核心体验、产品原则与使用者 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | D-01～D-36 决策及理由；后续决策的记录入口 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 进程职责、技术选型、位置与边界、流水线、工具、数据模型与目录规划 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | M0～M4 里程碑、验收标准与后续版本范围 |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | MVP 依赖与精确版本、工程约定、关键技术方案、G0～G5 开发顺序与验收 |
| [docs/codex-goals.md](docs/codex-goals.md) | 交给执行 Agent 的分步 `/goal` prompt |
| [DESIGN.md](DESIGN.md) | OpenDesign 格式的视觉系统、组件、交互、可访问性与禁忌 |
| [prototype/vivid-reader-prototype-v2.html](prototype/vivid-reader-prototype-v2.html) | 已定的视觉基准原型；配套规范为 `prototype/v2-folio-atlas/DESIGN.md` |

产品与技术设计放在 `docs/`，视觉规范以 `DESIGN.md` 为依据；界面实现以 v2 原型及其规范为准，两者冲突时以 v2 为准。
新决策追加到 `docs/DECISIONS.md` 末尾，沿用 `D-xx` 编号；不得删除旧条目，推翻时标注“已被 D-xx 取代”。
文档冲突或未定项见末尾“待确认”，不得自行视为已定方案。

## 技术栈

- Electron、React、TypeScript；Electron 主进程的 Node.js 必须 ≥ 22。
- Pi 仅使用 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`；**禁止引入 `pi-coding-agent`**。
- foliate-js 渲染 EPUB，位置使用 EPUB CFI；通过薄 `Position` 接口封装其 CFI 比较能力。
- 旁注卡舆图用 d3-geo 绘制 Natural Earth 数据（SVG）；可缩放大图用 MapLibre GL JS + PMTiles，属于 M4 可选项（D-30）。Wikidata 用于实体链接，GeoNames 可补充。
- SQLite 使用 Node 内置的 `node:sqlite`，只在 `src/main/db/` 内部使用（D-29）。
- 文字模型使用云端 DeepSeek；OpenAI GPT Image 场景示意属于 v0.2。
- 构建用 electron-vite；MVP 不用 better-sqlite3、`@electron/rebuild` 和 `pi-durable`（D-29、D-36）。各依赖的精确版本与理由见 `docs/IMPLEMENTATION.md` 第 1 节。

## 常用命令

| 命令 | 内容 |
|---|---|
| `npm run dev` | electron-vite 开发模式 |
| `npm run build` | 三端构建 |
| `npm run typecheck` | Node 与 Web strict 类型检查 |
| `npm run lint` | ESLint 与 Prettier |
| `npm test` | 无密钥单元测试 |
| `npm run test:live` | 真实模型测试，无密钥自动跳过 |
| `npm run test:e2e` | 构建后启动 Electron 验收 |
| `npm run check` | 类型、格式、单元测试、仓库卫生 |
| `npm run audit:repo` | 禁止书籍、数据库、瓦片及密钥日志入库 |
| `npm run report:m1` | 在 userData/reports 生成统计报告 |
| `npm run preprocess:m1` | 环境变量齐备时实跑前两章并生成报告，否则跳过 |

包管理器为 npm，依赖锁定精确版本。

## 代码结构

遵循 [ARCHITECTURE.md 第 9 节](docs/ARCHITECTURE.md#9-代码结构建议)的建议规划：单个 Electron 应用起步，不过早拆成 monorepo。以下目录尚未创建。

| 规划路径 | 职责 |
|---|---|
| `src/main/db/` | SQLite schema 与访问 |
| `src/main/pipeline/` | 预处理流水线各步骤 |
| `src/main/agent/` | Pi Agent 装配与读书工具集 |
| `src/main/llm/` | Pi 模型配置 |
| `src/main/wikidata/` | 实体链接客户端 |
| `src/main/ipc/` | 类型化 IPC 处理 |
| `src/renderer/reader/` | foliate-js 封装、标注注入 |
| `src/renderer/glimpse/` | 悬停卡片 |
| `src/renderer/map/` | MapLibre 地图组件 |
| `src/renderer/companion/` | 伴读栏 |
| `src/shared/` | 共享类型：Position、Entity、IPC 协议 |
| `docs/`、`DESIGN.md`、`README.md` | 产品与技术文档、视觉规范、项目入口 |

## 不可违反的规则

- **书籍内容永不进入仓库**：仓库永不包含书籍原文、EPUB 文件或任何由书籍生成的缓存，包括实体表、释义、图片、数据库。测试用书必须放在仓库外；原型使用自拟占位文字。
- **防剧透是硬约束**：所有读取书本内容的 Agent 工具必须在主进程实现，内部读取当前书的已读边界并截断；不得通过工具参数绕过。任何改动都不得破坏此约束，相关改动必须附带测试。
- 已读边界表示真正读过的最远位置，不等于当前页；目录或搜索跳到后文不得立即推进边界。释义预取、实体提及、足迹、图谱及引用链接均不得暴露边界后的内容；不得把提示词当作截断机制。
- **进程隔离**：模型调用、书本内容访问、数据库读写只在主进程进行。渲染进程只负责展示和交互，不持有 API Key，不直接调用模型。
- **密钥保护**：API Key 只用 Electron `safeStorage` 加密保存，不写入明文文件，不打印到日志。
- **真实资料**：地图只用真实地理数据，禁止 AI 生成地图；族群外貌不得用 AI 生成。历史人物优先真实画像并注明来源；允许的 AI 场景示意必须标注“AI 示意”。
- **实体定位**：不信任 LLM 返回的位置偏移；必须用表面形式及别名在原文章节中做字符串匹配，再经偏移映射转换为 CFI 区间。
- **人工纠错优先**：读者手动纠错优先于自动结果，纠错记录单独保存；重跑流水线不得覆盖。

## 代码规范

- TypeScript 开启 `strict`。
- 标识符、代码注释和 commit message 使用英文；文档使用中文。
- IPC 协议与共享类型放在 `src/shared/`，主进程 IPC 处理放在 `src/main/ipc/`。
- 新增外部依赖必须写明理由，并锁定精确版本；不得将候选技术当作已定选型。

## UI 工作

- 任何界面改动都遵循 `DESIGN.md`，包括日夜主题色值、字体栈、排印、组件、动效和可访问性要求。
- 日间阅读背景 `#F6F3EC`、卡片 `#FBFAF6`、正文 `#1F1D1A`、强调色 `#2E6B78`；强调色面积 ≤ 5%。正文默认宋体 19px / 1.85，界面使用系统无衬线。
- **朱色只属于已读边界**：朱 `#A8432F`（夜间 `#D9826A`）只用于进度线边界刻度、目录“以下未读”分隔和伴读栏边界标识，必须配文字，不得用于按钮、链接、标注或其他状态（D-26）。
- **三声字体**：书的原文用宋体，伴读回答与卡片释义用楷体，界面与读者提问用系统黑体；读者把正文切为楷体时，伴读回答与释义改用宋体（D-27）。
- **标注要稀疏**：1px 淡色实线“专名线”（类型色 55% 预混合到宣纸），悬停时变为 1.5px 类型全色且不加底色（D-25、D-28）；每实体每章只标首次出现，一屏约不超过 6 处；标为“已知”后不再标注。正文文字颜色不随实体类型改变。
- **卡片绝不遮挡当前行**：优先放在当前行上方或下方，靠边时自动翻转；地图和基础事实先显示，释义可单独加载。
- 遵守 `DESIGN.md` 第 10 节禁忌清单：禁止满屏高亮、背景色块标注、自动弹出的总结或提示、游戏化、聊天机器人头像、“✨ AI”图标、紫色渐变、纯白背景、纯黑文字和冷灰色。
- 真实图片标注来源，AI 场景图的“AI 示意”始终可见；任何页面不得暴露未读内容。原型占位文字按 `DESIGN.md` 第 11 节处理。

## 测试

以下要求在实现相应代码时落实；当前无测试可运行。

- **防剧透截断、CFI 比较、实体定位必须有单元测试**；使用自拟文本，不提交真实书籍片段或衍生缓存。
- 防剧透测试须验证请求超出边界时仍拿不到后文原文，覆盖读取、搜索、实体查询、总结等相关工具，不能只测试提示词。
- 需要 LLM 的测试在没有 API Key 时自动跳过；不把密钥写入测试、日志或仓库。

## 提交前检查清单

- [ ] 有代码后，类型检查与测试通过；M0 前仅做文档检查，不声称已完成代码验证。
- [ ] 没有书籍原文、EPUB 或由书籍生成的缓存进入 git；测试用书留在仓库外。
- [ ] 防剧透相关改动包含测试，进程隔离、密钥保护及人工纠错优先规则未被破坏。
- [ ] 涉及架构或产品的决定已追加到 `docs/DECISIONS.md`，保留旧条目及替代关系。

## 待确认

- **族群图像例外**：D-03 保留“若使用 AI，必须标注”的例外，与本次要求的族群外貌禁生成规则不一致；旧决策如何修订待确认，不能据此启用例外。
- **MVP 功能归属**：README 的 MVP 包含逐步生长的知识图谱，ROADMAP 将其列为 v0.2，足迹地图仅注明可提前；具体范围需对齐。（真实画像已由 D-35 定为 v0.2。）
- **技术验证**：标注注入方式与性能、偏移 ↔ CFI 往返（D-31）在 G1 验证；Wikidata 中文链接准确率在 G2 验证；底图中文覆盖与离线体积只涉及 M4 可选大图。结论写入 `docs/spikes/`，未验证前不得视为已通过。
- **衍生数据分享**：D-22 与 ARCHITECTURE 第 10 节仍未决定实体表、纠错记录能否及如何分享；不得因此放宽书籍内容与缓存禁止入库的规则。
