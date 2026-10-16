# 给 Codex 的 `/goal` 执行 prompt

> 配套文档：`docs/IMPLEMENTATION.md`（技术方案与开发顺序）。本文件只放可以直接粘贴的 prompt。
> 前提：`docs/IMPLEMENTATION.md` 第 3 节的方案已确认，见 `docs/DECISIONS.md` D-29～D-36。

## 使用方式

1. 开启 Codex 的 goals 功能（实验特性）。在 `~/.codex/config.toml` 中加入下面两行，然后重启 Codex：
   ```toml
   [features]
   goals = true
   ```
2. 在仓库根目录启动 Codex。需要真实书或真实模型的步骤（G1 起），先在**同一个终端**里设置环境变量，再启动 Codex。不要把这两个值写进任何文件：
   ```bash
   export VIVID_TEST_EPUB="$HOME/Books/guns-germs-steel.epub"   # 仓库外的路径，改成你自己的
   export DEEPSEEK_API_KEY="sk-..."                              # 只用于 test:live 和 M1 实跑
   ```
3. **一次只跑一个 goal**。跑完先自己看结果，再回来贴下一个；不要把 G0～G5 合成一个大 goal。
4. 每个 goal 完成后，Codex 会按“结束汇报”的格式回报。你确认无误后再开始下一个。G2 结束时必须你人工核对抽取结果，然后才能进入 G3。
5. 建议在 Codex 里给每个 goal 设置 token 预算。G0、G1 较小，G3、G4 较大。

---

## G0 · 工程骨架

```text
/goal 为「历历 · Vivid」搭好可运行的 Electron + React + TypeScript 工程骨架，完成 docs/IMPLEMENTATION.md 第 4 节「G0 · 工程骨架」的全部条目，并让 npm run check、npm run build、npm run test:e2e 全部通过。

开始前先完整阅读：AGENTS.md、docs/IMPLEMENTATION.md（第 1、2 节和第 4 节 G0）、docs/ARCHITECTURE.md 第 9 节；视觉参考 prototype/vivid-reader-prototype-v2.html 与 prototype/v2-folio-atlas/DESIGN.md。

具体要求：
- 依赖严格按 IMPLEMENTATION.md 1.1、1.2 安装（不含标注「M4」的包），全部用 npm install -E 锁定精确版本。TypeScript 用 6.0.3，不用 7.x。不得安装 better-sqlite3、@electron/rebuild、pi-coding-agent、pi-durable、任何 ORM。遇到 peer 冲突时选最近的兼容版本，并把原因写进 IMPLEMENTATION.md 第 1 节。
- 用 electron-vite 6 搭建 main / preload / renderer 三端；TS strict；ESLint flat config + Prettier；Vitest；Playwright _electron。
- 落实 IMPLEMENTATION.md 2.2 的 Electron 安全默认和 CSP、2.3 的 IPC 骨架（src/shared/ipc.ts 用 typebox 定义；preload 只暴露 window.vivid）、2.1 的全部脚本名。
- src/shared/position.ts 只写 Position 接口和类型，不写 CFI 实现。
- src/renderer/styles/tokens.css 从 v2 原型的 :root 和 .night 原样迁移设计令牌。打包 lxgw-wenkai-webfont 的 Regular。主窗口显示一页静态示例正文，按 v2 版心排版：左页边竖排书口、版心 680px、宋体 19px / 1.85、首行缩进 2em、两端对齐、底部宋体页码、窗口底边进度发丝线（石青当前点 + 朱色边界刻度）。示例文字只用 DESIGN.md 第 11、12 节的自拟段落。
- tests/fixtures/build-epub.ts：在测试运行时用 fflate 生成一个 5 章的合成 EPUB 到临时目录，文字全部自拟；第四、五章各放一个唯一的哨兵字符串（SENTINEL-AFTER-BOUNDARY-4、SENTINEL-AFTER-BOUNDARY-5），并埋几个只在后文出现的实体名。写一个测试验证生成的 EPUB 结构合法（有 container.xml、OPF、spine、nav）。
- 实现 npm run audit:repo，规则见 IMPLEMENTATION.md 2.4。
- Playwright 冒烟测试：应用能启动，窗口标题为「历历」，示例正文可见。
- 把实际脚本写进 AGENTS.md 的「常用命令」节，替换「待 M0 初始化后补充」。

不可违反：
- 仓库里不得出现任何书籍原文、EPUB 文件或由书生成的数据；.gitignore 已有的规则不得放宽。
- 渲染进程不得持有 API Key，不得发外网请求，不得直接调用模型。
- 不打印任何密钥。
- 标识符、注释、commit message 用英文；文档用中文。

完成条件（全部满足才算完成）：
1. npm run check 通过（typecheck、lint、test、audit:repo）。
2. npm run build 通过，npm run test:e2e 通过。
3. git ls-files 中没有 .epub、.sqlite、.db、.pmtiles 文件。
4. 已提交一个 commit：chore: scaffold electron-vite app (G0)。

遇到以下情况停下来问我，不要自己决定：需要偏离 IMPLEMENTATION.md 的技术选型；某个依赖找不到兼容版本；需要放宽任何安全或仓库规则。

结束汇报：列出安装的依赖及精确版本、新增的目录结构、每个完成条件的实际命令输出摘要（失败就如实写失败），以及你认为下一步 G1 需要注意的风险。
```

---

## G1 · 阅读器探针

```text
/goal 完成 docs/IMPLEMENTATION.md 第 4 节「G1 · 阅读器探针」：能导入并分页阅读 EPUB、保存与恢复位置、在正文中注入硬编码的专名线并悬停出卡，完成「偏移 ↔ CFI」与「标注注入」两个技术探针并写出结论，主进程用 pi-ai 跑通一次 DeepSeek。

开始前先阅读：AGENTS.md、docs/IMPLEMENTATION.md（第 2 节、第 3.2、3.3、3.8 节和第 4 节 G1）、docs/ARCHITECTURE.md 第 3、4 节、docs/DECISIONS.md 中 D-19、D-25～D-28、D-29、D-31、D-36。

具体要求：
- 把 foliate-js 按 IMPLEMENTATION.md 1.3 原样复制到 src/renderer/vendor/foliate-js/（commit 78914aef4466eb960965702401634c2cb348e9b1），附 LICENSE 和 VENDOR.md。
- 导入流程：文件对话框 → 主进程按内容 hash 复制到 app.getPath('userData')/books/ → 经 IPC 把字节传给渲染进程 → foliate-js 打开。导入的书路径记在内存或临时 JSON 即可，数据库留到 G2。
- 分页阅读、目录、方向键与空格翻页；排版遵循 v2 原型和 DESIGN.md 第 3.2 节。
- 保存并恢复当前 CFI。实现 Position 的 CFI 版本（用 foliate-js 的 CFI 比较），并写单元测试：同章先后、跨章、同一节点内不同偏移、非法输入。
- 标注探针（IMPLEMENTATION.md 3.3）：硬编码合成 EPUB 第一章中的两个实体，先试 CSS Custom Highlight API，不行再用带 data-vivid-inert 的 span 包裹。专名线为 1px 淡色实线、悬停为 1.5px 类型全色、不加底色。悬停 250ms 后弹出一张简易卡片，卡片不遮挡当前行。写测试：同一页注入前后，foliate 报告的当前位置 CFI 完全相同。
- 偏移 ↔ CFI 探针（IMPLEMENTATION.md 3.2）：先实现方案 A（主进程 fflate + linkedom），做往返测试：在合成 EPUB 上随机抽 200 个偏移（若设置了 VIVID_TEST_EPUB，真书再抽 200 个），主进程生成的 CFI 在渲染进程 foliate 中解析回的文字必须逐字一致。不一致率必须为 0；做不到就按方案 B 实现，并记录原因。结论、数据和最终选择写进 docs/spikes/M0-offset-cfi.md；文档里只写统计数字，不写真书的任何文字。
- 密钥：设置页的雏形，或一个开发用的入口，提供 setApiKey / hasApiKey / clearApiKey 三个 IPC，用 Electron safeStorage 加密后存到 userData。不存在任何把密钥返回渲染进程的通道。
- src/main/llm/：用 pi-ai 的 deepseek provider，按请求传 apiKey（来自 safeStorage）。模型 ID 从 pi-ai 目录中读取，默认 deepseek-flash。test:live 中写一个真实调用测试，没有 DEEPSEEK_API_KEY 时自动跳过；测试里不得打印密钥。

不可违反：
- 书籍内容永不进入仓库，测试只用合成 EPUB，真书只通过 VIVID_TEST_EPUB 读取。
- 模型调用、数据库读写、书本内容的程序化处理只在主进程进行。
- 密钥只用 safeStorage，不写明文，不进日志。
- 实体定位不信任 LLM 返回的偏移（本步虽是硬编码，接口设计要为字符串匹配留好位置）。

完成条件：
1. npm run check、npm run test:e2e 通过；E2E 覆盖：导入合成 EPUB → 翻页 → 悬停硬编码实体 → 卡片出现 → 重启后恢复到原位置。
2. 偏移往返测试不一致率为 0（合成 EPUB 必测；真书在设置了变量时测）。
3. 标注注入前后 CFI 不变的测试通过。
4. 有密钥时 npm run test:live 通过；没有时显示为 skipped。
5. docs/spikes/M0-offset-cfi.md 已写明采用方案 A 还是 B、标注用哪种注入方式，以及依据。
6. 提交：feat: reader probe with foliate-js, cfi position and mark injection (G1)。

遇到以下情况停下来问我：方案 A 与 B 都达不到 0 不一致；Custom Highlight 和 span 两种方式都会改变 CFI；foliate-js 需要本地修改才能工作。

结束汇报：完成条件逐条的实际结果、两个探针的结论与数据、已知问题，以及对 G2 的风险提示。
```

---

## G2 · 抽取质量

```text
/goal 完成 docs/IMPLEMENTATION.md 第 4 节「G2 · 抽取质量」：建立数据库与可断点续跑的预处理流水线（解析 → 抽取 → 合并 → Wikidata 链接），在合成 EPUB 上全流程跑通，对真书第一、二章生成核对报告和开发用核对页，然后停下等我人工核对。

开始前先阅读：AGENTS.md、docs/IMPLEMENTATION.md（第 3.1、3.5 节和第 4 节 G2）、docs/ARCHITECTURE.md 第 4、7 节、docs/DECISIONS.md 中 D-16、D-18、D-22、D-29、D-31、D-32、docs/spikes/M0-offset-cfi.md。

具体要求：
- src/main/db/：使用 node:sqlite 的 DatabaseSync，只在这个目录内部使用；对外暴露 repository 接口。编号迁移文件 + schema_migrations 表。按 ARCHITECTURE 第 7 节建表，并新增 pipeline_jobs（book_id、step、chapter_id、status、attempts、error、updated_at）和 wikidata_cache。corrections 表独立保存，重跑流水线不得覆盖人工纠错。
- 流水线（src/main/pipeline/），每步结果落库，可中断、可续跑：
  ① 解析章节：沿用 G1 选定的方案，生成章节纯文本与偏移映射；
  ② 实体抽取：DeepSeek；固定指令和输出格式放在 prompt 最前，章节文本放最后，以命中前缀缓存；长章节按段落切块并保留重叠；输出用 typebox 校验，失败重试且有上限；
  ③ 合并别名；
  ④ Wikidata 链接：中文名和推测的原文名分别检索（wbsearchentities，language=zh / en），取 P625、P31、P17、P18、P569、P570、中文标签与描述；只有一个合理候选时直接采用，多个候选时交给 LLM 结合上下文消歧，并记录置信度；无候选或低置信度标为 unlinked。
- Wikidata 客户端（src/main/wikidata/）：符合 Wikimedia 规范的 User-Agent（含项目名和联系方式占位），并发 ≤ 2，指数退避，响应写入 wikidata_cache。单元测试用录制的 Wikidata 响应作为 fixtures（外部公开数据，可以提交），不发真实网络请求。
- 用 pi-ai 的 fauxProvider 为 ② 和 ④ 的消歧写单元测试，不需要密钥。
- 抽取阶段 LLM 写的自由文本（note 等）只存不显示（IMPLEMENTATION.md 3.5）。
- 开发用核对页：只在 dev 模式出现，列出第一、二章每个实体的抽取结果、候选、采用项、置信度，可以标记对 / 错，标记写入数据库。
- 统计脚本 npm run report:m1：输出抽取数量、链接准确率（基于核对页的标记）、未链接比例、输入 / 输出 / 缓存命中 token、成本、耗时。报告写到 userData/reports/，不写进仓库。

不可违反：
- 实体表、释义、报告、数据库都是由书生成的数据，永不进入仓库；核对页截图也不得提交。
- 不信任 LLM 返回的位置偏移，本步不使用任何偏移字段。
- 读者纠错优先，重跑不覆盖。
- 密钥只经 safeStorage 或当前终端的 DEEPSEEK_API_KEY 环境变量取得，不写文件，不打印。

完成条件：
1. npm run check 通过；流水线各步、断点续跑、纠错不被覆盖都有单元测试。
2. 合成 EPUB 上用 fauxProvider 和录制的 Wikidata fixtures 端到端跑通，并演示中断后续跑。
3. 若设置了 VIVID_TEST_EPUB 和 DEEPSEEK_API_KEY：真书第一、二章实跑完成，report:m1 已生成（数字在结束汇报里给我，文件不进仓库）；核对页可以打开。
4. 提交：feat: preprocessing pipeline and wikidata linking (G2)。
5. 然后停止，不要开始 G3。

遇到以下情况停下来问我：抽取或链接需要偏离 ARCHITECTURE 第 4 节的设计；单章成本明显超出 ARCHITECTURE 第 4 节的估算；Wikidata 访问被限流且无法通过退避解决。

结束汇报：完成条件逐条结果；report:m1 的汇总数字（只要数字，不要实体名和原文）；你观察到的主要失败类型（用类型描述，例如“音译不一致”“同名异地”，不要举真书里的例子）；以及建议我在核对页重点检查什么。
```

---

## G3 · 旁注卡

```text
/goal 完成 docs/IMPLEMENTATION.md 第 4 节「G3 · 旁注卡」：提及定位与稀疏化、正文专名线、完全符合 v2 原型的旁注卡（舆图插页、释义、足迹、三种状态、页边与回退布局）、标为已知与纠错、已读边界状态机、进度线与目录的朱色边界、夜间主题，以及全套防剧透测试。

开始前先阅读：AGENTS.md、docs/IMPLEMENTATION.md（第 3.3～3.6 节和第 4 节 G3）、prototype/v2-folio-atlas/DESIGN.md（全文，尤其第 4～8、13 节）、prototype/vivid-reader-prototype-v2.html（第 01～06 屏，含布局函数 layoutScreen）、DESIGN.md 第 5.1、5.2、8 节、docs/DECISIONS.md 中 D-25～D-28、D-30、D-32～D-35。我已在 G2 结束后人工核对过抽取结果。

具体要求：
- 流水线 ⑤ 定位提及：用表面形式和别名在章节纯文本中做字符串匹配，再经 G1 的映射转换为 CFI 区间；⑥ 稀疏化：每实体每章只标首次出现、重要度阈值随标注密度变化、“已知”不标、单屏上限约 6 处。
- 正文专名线：按 D-25 / D-28 与 G1 探针选定的注入方式实现，类型色取 tokens.css。
- 旁注卡（src/renderer/glimpse/）：
  - 布局与引线：页边 ≥ 400px 时放在右页边，引线从版心右缘出发；页边不足时放到当前行下方，并给遮住的每一整行加宣纸色蒙层，任何一行都不能被切成半截。逻辑参照 v2 原型的 layoutScreen；
  - 结构、字号、三声字体：按 v2 DESIGN 第 5.2 节；人物卡只放基础事实和生卒时间轴，不放画像位（D-35）；
  - 时机与动效：悬停 250ms 打开，离开 200ms 关闭，鼠标可移入卡片，单击固定，Esc 关闭；动效按 v2 DESIGN 第 8 节，支持 prefers-reduced-motion；
  - 可访问性：悬停时 role=tooltip，固定时 role=dialog。
- 舆图插页（src/renderer/map/）：按 IMPLEMENTATION.md 3.6 用 d3-geo + world-atlas 绘制 SVG，包括经纬网、图框刻度、比例尺、正射小地球、当前点、参照地、距离线和图版编号；夜间配色取令牌。区域实体用中心点加半径圈；未能定位时显示淡色世界图。地理数据只能来自 world-atlas，不得手绘或生成。
- 释义：打开章节时后台预取本章实体的释义，输入规则和缓存键按 IMPLEMENTATION.md 3.6；提及位于边界之后时不显示释义。足迹只统计边界之前的提及。
- 标为已知；纠错面板：列出 Wikidata 候选、支持中文 / 原文搜索、“这不是一个具体地方”、“以后别再标注它”。纠错写入 corrections 表，优先于自动结果。
- 已读边界（src/main/boundary/）：按 IMPLEMENTATION.md 3.4 实现纯函数状态机，并写全情景单元测试；跳读到边界之后时，页边显示“此处在已读范围之后 · 设为已读至此”。
- 进度发丝线（已读淡墨、石青当前点、朱色边界刻度和“已读至 第X章”）；目录用点线引导、显示朱色“以下未读”分隔线，线后章节只显示章名；朱色只用于已读边界（D-26）；夜间主题。
- 防剧透测试（src/main/content/ 与相关 IPC）：边界设在合成 EPUB 第三章时，所有给渲染进程的 IPC 返回值、释义模型的输入、足迹、目录统计中，都不得出现第四、五章的哨兵字符串或只在后文出现的实体。

不可违反：
- 卡片绝不遮挡当前行。
- 地图只用真实地理数据。
- 标注稀疏，不使用背景色块，悬停也不加底色。
- 不得把提示词当作截断机制，截断必须在 src/main/content/ 的代码里完成。
- 不得把书籍内容或衍生数据写进仓库；截图只用合成 EPUB。

完成条件：
1. npm run check、npm run test:e2e 通过；E2E 覆盖：悬停地点实体出现页边旁注卡与舆图、展开伴读栏后卡片走回退布局、Esc 关闭、标为已知后标注消失、跳读不推进边界。
2. 边界状态机、提及定位、稀疏化、防剧透的单元测试全部通过。
3. 对照 v2 DESIGN 第 13 节检查清单逐条自查，并用合成 EPUB 截图（日间、夜间、回退态各一张，存到仓库外的临时目录）。
4. 提交：feat: glimpse margin notes with atlas plates and read boundary (G3)。

遇到以下情况停下来问我：v2 原型的某个布局在真实分页（CSS 多栏）下做不到；需要显示边界后的任何信息；悬停到卡片出现的延迟超过 300ms 且优化不下来。

结束汇报：完成条件逐条结果、第 13 节检查清单的逐条结论（不确定的写不确定）、截图路径、性能数据（悬停到出卡的耗时），以及已知问题。
```

---

## G4 · 伴读

```text
/goal 完成 docs/IMPLEMENTATION.md 第 4 节「G4 · 伴读」：用 pi-agent-core 装配受已读边界约束的读书工具集，实现 v2 批注本样式的伴读栏与正文选区工具条，并用 fauxProvider 写出覆盖读取、搜索、实体查询、总结的防剧透测试，证明后文原文拿不到。

开始前先阅读：AGENTS.md、docs/IMPLEMENTATION.md（第 3.4、3.5、3.7 节和第 4 节 G4）、docs/ARCHITECTURE.md 第 6 节、prototype/v2-folio-atlas/DESIGN.md 第 5.3、10 节、v2 原型第 04 屏、docs/DECISIONS.md 中 D-05、D-08、D-17、D-27、D-32、D-33、D-36。

具体要求：
- src/main/agent/：工具为 get_reading_context、read_text、search_book、lookup_entity、summarize，参数 schema 用 typebox。所有工具只经 src/main/content/ 读取内容，并在内部读取当前书的边界后截断。工具参数中不得有任何能指定或放宽边界的字段。
- 系统提示写明边界、读者标为“已知”的实体、书籍类型；但防剧透不依赖提示词。
- 回答中的引用只能指向边界之前的位置，生成后在主进程再校验一次，越界引用直接删除。
- 伴读栏（src/renderer/companion/）：
  - 头部：“伴读”（宋体）+“已读至 第X章 · N%”+ 朱色短竖线 + 说明“伴读只知道朱线之前的内容”；
  - 对话：读者提问用黑体、右对齐、前缀“问”；伴读回答用楷体、不加气泡、流式输出；引用写成“见第三章 ›”，点击跳转（属于 jump，不推进边界）；
  - 快捷操作：一行文字按钮“总结选中 · 总结本章 · 总结至此”；选区不完全在边界之前时，“总结选中”禁用并提示“这段在已读范围之后”；
  - 输入框占位文字“问一个关于已读部分的问题”，⌘↩ 发送。
- 正文选区工具条只有“问伴读”和“总结”两项。
- 对话存入 conversations 表，每本书一条进行中的会话；手动往回调整边界时归档旧会话、另起新会话。
- 防剧透测试（合成 EPUB，边界设在第三章中间）。用 fauxProvider 编排模型依次尝试：read_text 请求第四、五章范围；search_book 搜只在后文出现的词和哨兵字符串；lookup_entity 查只在后文出现的实体；summarize 本章（当前章跨越边界）和至此。断言所有工具结果、最终回答、数据库里存下的消息中，都不出现哨兵字符串、后文实体名和后文原文。

不可违反：
- 防剧透是硬约束，相关改动必须附带测试。
- 模型调用只在主进程进行；渲染进程不持有密钥。
- 不出现聊天机器人头像、“✨ AI”图标、自动弹出的总结或提示。

完成条件：
1. npm run check、npm run test:e2e 通过；E2E 覆盖：提问 → 流式回答 → 点击引用跳转且边界不变。
2. 上述防剧透测试全部通过。
3. 有 DEEPSEEK_API_KEY 时，用 test:live 在合成 EPUB 上跑一次真实对话和一次“总结至此”，断言回答中没有哨兵字符串。
4. 提交：feat: boundary-limited companion agent (G4)。

遇到以下情况停下来问我：pi-agent-core 的 API 无法在工具层做到不可绕过的截断；需要让模型看到边界之后的任何内容才能完成某个功能。

结束汇报：完成条件逐条结果、工具清单及各自的截断方式、防剧透测试用例清单，以及已知局限（例如模型训练记忆带来的剧透风险，见 D-05）。
```

---

## G5 · 打磨与开源准备

```text
/goal 完成 docs/IMPLEMENTATION.md 第 4 节「G5 · 打磨与开源准备」：书架、导入页、设置、可访问性、打包与开源文档，让别人在干净的 clone 上自备 EPUB 和 API Key 就能跑起来。

开始前先阅读：AGENTS.md、docs/IMPLEMENTATION.md 第 4 节 G5、docs/ROADMAP.md 的 M4、prototype/v2-folio-atlas/DESIGN.md 第 5.4～5.8、9、11 节、v2 原型第 07～09 屏。

具体要求：
- 书架：题签封面（2:3 色纸 + 右上竖排宋体题签 + 作者），六种纸色按书名哈希选取；不显示 EPUB 自带封面（设置里可以选择开启“显示原书封面”，运行时从本机文件读取）；进度线为淡墨已读加朱色边界刻度。
- 导入页：点线步骤、只显示数量、“现在就可以开始读。”加主按钮“开始阅读”；预处理期间允许阅读，已处理的章节先出现标注。
- 设置：
  - 阅读：正文宋体 / 楷体切换（附实时预览，伴读字体自动对调）、字号、行高、主题；
  - 标注：密度和类型复选，用专名线样式做示例；
  - 模型：DeepSeek Key 用密码框，注明“保存在系统钥匙串中”；模型列表来自 pi-ai 目录；
  - 伴读：手动调整边界、专注模式。
  - 选中项用石青浅底，不用实底。
- 可访问性：按 ⌥ 进入标注导航，Tab 切换，↩ 打开卡片，Esc 退出；所有可交互元素有 focus-visible 焦点环；正文 26px 时每行仍不少于 24 字。
- 可选（时间允许再做）：单击舆图打开 MapLibre + PMTiles 大图；PMTiles 用脚本下载到 userData，不进仓库。安装依赖时锁定版本，并更新 IMPLEMENTATION.md。
- 安装 electron-builder（锁定版本），打一个未签名的 macOS dmg。
- README（中文）：功能、截图（只用合成 EPUB）、安装、如何配置 Key、隐私说明（书和数据都在本地）、开发命令。另写 LICENSE（我还没选，先停下问我用哪个许可证）、CONTRIBUTING。
- 有 VIVID_TEST_EPUB 时，用真书全书跑一遍流水线，修正纠错流程中的问题。真书的任何数据都不提交。

不可违反：AGENTS.md「不可违反的规则」全部条目；DESIGN 禁忌清单（不做游戏化，不用纯白、纯黑、冷灰，不使用真实出版物封面作为默认封面）。

完成条件：
1. 在全新 clone 的目录中执行 npm ci && npm run check && npm run build && npm run test:e2e，全部通过。
2. dmg 产出成功（路径写在汇报里，不提交）。
3. audit:repo 通过，git log 全历史中没有新增的书籍文件。
4. 提交：feat: library, settings, a11y and release prep (G5)。

遇到以下情况停下来问我：选择许可证；是否加入可选的大图；任何需要发布、上传或推送到远端的操作。

结束汇报：完成条件逐条结果、未完成的可选项，以及开源前还需要我决定的事项。
```
