# 技术架构 · Architecture

> 状态：初稿（2026-10-15）。标注 **【待验证】** 的内容需要在 M0 / M1 阶段确认。

## 1. 总览

```
┌─ Electron 主进程 (Node ≥ 22) ───────────────────────────────┐
│                                                              │
│  BookStore (SQLite)          预处理流水线 Pipeline           │
│  ├─ books / chapters         ├─ 实体抽取 (DeepSeek)          │
│  ├─ entities / mentions      ├─ 实体合并 / 别名              │
│  ├─ glosses (缓存)           ├─ 实体链接 (Wikidata)          │
│  ├─ progress                 └─ 标注筛选 (稀疏化)            │
│  └─ conversations                                            │
│                                                              │
│  伴读 Agent: pi-agent-core + 读书工具集                      │
│  └─ 所有读取书本内容的工具统一按「已读边界」截断             │
│                                                              │
│  模型层: pi-ai  ── DeepSeek (文字) / OpenAI (图像, v0.2)     │
│  外部数据: Wikidata 客户端 · 图片缓存 · 本地底图 PMTiles     │
│  密钥: Electron safeStorage (macOS 钥匙串)                   │
└──────────────────────── 类型化 IPC ──────────────────────────┘
┌─ 渲染进程 (React) ──────────────────────────────────────────┐
│  阅读器 (foliate-js, iframe)   ← 注入实体标注                │
│  悬停卡片 Glimpse Card          MapLibre GL 地图             │
│  伴读栏 (对话 + 快捷总结)       目录 / 书架 / 设置           │
└──────────────────────────────────────────────────────────────┘
```

**职责划分**：渲染进程只负责展示和交互；所有模型调用、书本内容访问、数据库读写都在主进程完成。渲染进程不直接持有 API Key，也不直接把书本内容发给模型。

## 2. 技术选型

| 领域 | 选择 | 备注 |
|---|---|---|
| 桌面壳 | Electron | Pi 需要 Node ≥ 22，Electron 自带 Node |
| 构建 | electron-vite（候选） | |
| 前端 | React + TypeScript | |
| EPUB 渲染 | [foliate-js](https://github.com/johnfactotum/foliate-js) | 自带 CFI 解析 / 比较；在 iframe 中渲染 |
| 地图 | MapLibre GL JS + PMTiles（Protomaps） | 底图离线；中文标注覆盖情况 **【待验证】** |
| 数据库 | SQLite（better-sqlite3 候选） | 原生模块需随 Electron 重编译 **【待验证】** |
| LLM | `@earendil-works/pi-ai` | 内置 DeepSeek；`generateImages()` 统一生图接口 |
| Agent | `@earendil-works/pi-agent-core` | 工具调用与状态管理 |
| 持久化会话 | `@earendil-works/pi-durable` | 是否适合存"每本书的阅读会话" **【待评估】** |
| 实体链接 | Wikidata（`wbsearchentities` + 实体数据 / SPARQL） | GeoNames 作为补充 |

**明确不用** `pi-coding-agent`：它默认带 bash 与文件读写工具，且没有权限系统，读书场景不需要。

## 3. 位置模型与「已读边界」

### 3.1 位置表示
- 只支持 EPUB，阅读位置直接使用 **EPUB CFI**，比较大小用 foliate-js 的 CFI 比较函数。
- 内部封装一层很薄的 `Position` 接口（`compare(a, b)`、`toString()`、`fromString()`），目前唯一实现是 CFI。以后接入其他格式时只需新增实现。

### 3.2 已读边界（Read Boundary）
"读到哪里"不等于"当前页"。读者可能翻回前面重读，这时 Agent 仍应知道他读过后面的内容。因此：

- **已读边界 = 读者真正读过的最远位置**（high-water mark），只增不减。
- **边界如何推进**：顺序翻页、在某页停留超过若干秒，才推进边界。通过目录或搜索跳到后面时**不立即推进**，避免误点导致"解锁"后文。
- 读者可以在设置里手动调整边界（例如这本书以前读过一半）。
- 所有"会接触书本内容"的操作都以已读边界为准：Agent 工具、释义预取、足迹地图、知识图谱。

> 跳读策略的具体阈值需要实际阅读后再调，**【待验证】**。

## 4. 导入与预处理流水线

导入一本 EPUB 后，在后台一次性跑完，可中断、可续跑，每一步结果都落库。

```
EPUB ─▶ ① 解析章节 ─▶ ② 实体抽取 ─▶ ③ 合并别名 ─▶ ④ 实体链接 ─▶ ⑤ 定位提及 ─▶ ⑥ 标注筛选
```

### ① 解析章节
- 读取 OPF / 目录，按 spine 得到章节列表。
- 对每个章节抽取纯文本，同时建立"文本偏移 ↔ CFI"的映射，供第 ⑤ 步使用。
- foliate-js 依赖浏览器 DOM，计划在一个**隐藏的渲染进程**中加载章节、生成映射，再交回主进程。**【待验证】**

### ② 实体抽取（DeepSeek）
- 按章节调用模型，要求输出 JSON：

```json
{
  "entities": [
    {
      "surface": "查塔姆群岛",
      "type": "place",
      "original_name_guess": "Chatham Islands",
      "aliases_in_text": ["查塔姆"],
      "importance": 0.8,
      "note": "莫里奥里人居住的岛屿"
    }
  ]
}
```

- 实体类型：`place` 地点 · `person` 人物 · `people` 族群 · `species` 物种（动植物、病菌）· `concept` 概念 / 事件。
- **命中前缀缓存**：固定指令和输出格式放在 prompt 最前，章节文本放最后。
- 章节过长时按段落切块，块间保留少量重叠。

### ③ 合并别名
- 同一实体在不同章节、不同译名下出现（全称 / 简称 / 不同译法），先按字面和原文名合并，链接到同一个 Wikidata QID 后再做最终合并。

### ④ 实体链接（Wikidata）
1. 用中文名和推测的原文名分别调用 `wbsearchentities`（`language=zh` / `en`）。
2. 取回候选实体的关键属性：坐标 `P625`、类型 `P31`、所属国家 `P17`、图像 `P18`、中文标签与描述、中文维基链接。
3. 只有一个合理候选时直接采用；有多个时，把候选列表和书中上下文交给 LLM 选择，并记录置信度。
4. 低置信度或无候选：标记为 `unlinked`，卡片上显示"未能定位"，引导读者纠错。
5. **读者纠错永远优先于自动结果**，纠错记录单独保存，重跑预处理时不覆盖。

地理实体的三种形态：

| 形态 | 例子 | 地图画法 |
|---|---|---|
| 点 | 卡哈马卡、查塔姆群岛 | 标记点 |
| 区域 | 新月沃地、新几内亚高地 | MVP：中心点 + 大致半径的圈；后续：多边形（Wikidata `P3896` geoshape 等） |
| 族群 | 莫里奥里人、南岛语族 | 关联到其主要分布地；后续：迁徙路线 |

### ⑤ 定位提及
- **不信任模型给出的位置偏移**。拿到实体的表面形式和别名后，用字符串匹配在章节文本中找到所有出现位置，再通过偏移映射转换为 CFI 区间。

### ⑥ 标注筛选（稀疏化）
决定哪些提及在阅读器里显示标注：
- 每个实体在每章只标注**首次出现**；
- `importance` 低于阈值的不标注（阈值随"标注密度：少 / 中 / 多"设置变化）；
- 读者标为"已知"的实体不标注；
- 单屏标注数量设上限，超出时保留重要度最高的。

### 成本粗估
《枪炮》中译本约 40～50 万字，抽取全书大约需要几十万到一百多万 token 的输入。使用 DeepSeek 这类低价模型，加上前缀缓存，预计**几美元以内**。实际数字在 M1 测出后补充。

## 5. 悬停卡片的数据来源

| 层 | 内容 | 生成时机 | 剧透风险 |
|---|---|---|---|
| 基础层 | 地图位置、中文名 / 原文名、类型、现代所属国家、一句话外部简介、真实图像 | 预处理（第 ④ 步） | 非虚构类基本无 |
| 语境层 | "在本书此处它指什么"的释义 | 打开某章时后台预取，缓存 | 有，严格限制输入 |
| 足迹层 | "第 X 章初见 · 已见 N 次" | 实时计算（只统计已读边界之前的提及） | 无 |

**语境释义的输入**只包含：该提及之前的一段上下文 + 该实体在已读范围内的历次提及摘要。缓存键为 `(实体, 章节)`。

悬停时绝大多数情况命中缓存；未命中时，基础层立即显示，语境层显示骨架屏并即时生成。

## 6. 伴读 Agent

### 6.1 工具集
所有工具都在主进程实现，内部统一读取当前书的已读边界并截断。模型无法传参绕过这个边界。

| 工具 | 作用 |
|---|---|
| `get_reading_context()` | 当前位置、已读边界、当前章节标题、读者选中的文本 |
| `read_text(range)` | 读取指定范围原文；超出已读边界的部分被截掉 |
| `search_book(query)` | 只在已读范围内搜索 |
| `lookup_entity(name)` | 查询本书实体表（只返回已读范围内的提及） |
| `get_map(entity)` | 返回地图所需数据，供前端渲染 |
| `summarize(scope)` | 按需总结：选中段落 / 本章（至边界）/ 全书至今 |
| `generate_image(prompt)` | **v0.2**，仅场景示意，结果标注"AI 示意" |

### 6.2 上下文
- 每本书一条持续的对话记录。
- 系统提示中注明：已读边界、读者标为"已知"的实体、书籍类型。
- 回答中引用书中位置时，附带可点击的位置链接（只能指向已读范围）。

### 6.3 防剧透的局限
工具截断只能拦住原文。模型训练时可能"读过"这本书。非虚构类影响有限；扩展到小说时，需要在系统提示中加约束，并对输出做检查。

## 7. 数据模型（草案）

```sql
books        (id, title, author, file_path, file_hash, book_type, imported_at)
chapters     (id, book_id, idx, title, start_cfi, end_cfi, char_count)
entities     (id, book_id, type, name_zh, name_original, aliases_json,
              wikidata_qid, lat, lon, geo_shape, country, summary_ext,
              image_url, image_credit, link_status, link_confidence, importance)
mentions     (id, entity_id, chapter_id, cfi_range, char_offset,
              is_first_in_chapter, is_highlighted)
glosses      (id, entity_id, chapter_id, text, model, created_at)
corrections  (id, entity_id, field, old_value, new_value, created_at)
known        (book_id, entity_id)            -- 读者标为"已知"
progress     (book_id, current_cfi, boundary_cfi, updated_at)
conversations(id, book_id, messages_json, updated_at)
images       (id, entity_id, kind, source, path, is_ai, prompt, created_at)  -- v0.2
```

## 8. 本地存储

```
~/Library/Application Support/Vivid/
├── vivid.sqlite        # 全部结构化数据
├── books/              # 导入的 EPUB 副本（以 hash 命名）
├── images/             # 下载的真实图像与生成的图像缓存
└── tiles/              # 本地底图 PMTiles
```

- 世界底图只放一份**低缩放级别**的离线文件，控制体积（具体级别与大小 **【待验证】**）；放大到更细时可选在线加载。
- API Key 用 Electron `safeStorage` 加密保存（底层为 macOS 钥匙串），不写入明文配置文件。

## 9. 代码结构（建议）

单个 Electron 应用起步，不过早拆成 monorepo：

```
vivid-reader/
├── src/
│   ├── main/            # 主进程
│   │   ├── db/          # SQLite schema 与访问
│   │   ├── pipeline/    # 预处理流水线各步骤
│   │   ├── agent/       # pi-agent-core 装配与读书工具集
│   │   ├── llm/         # pi-ai 模型配置
│   │   ├── wikidata/    # 实体链接客户端
│   │   └── ipc/         # 类型化 IPC 处理
│   ├── renderer/        # React 界面
│   │   ├── reader/      # foliate-js 封装、标注注入
│   │   ├── glimpse/     # 悬停卡片
│   │   ├── map/         # MapLibre 地图组件
│   │   └── companion/   # 伴读栏
│   └── shared/          # 共享类型（Position、Entity、IPC 协议）
├── docs/
├── DESIGN.md
└── README.md
```

## 10. 开放问题

1. foliate-js 在 iframe 内注入标注、拦截悬停事件的方式与性能。（M0 验证）
2. 隐藏渲染进程生成"文本偏移 ↔ CFI"映射是否可行，还是改用 Node 端解析。（M0）
3. 中文译名关联 Wikidata 的准确率。（M1 的核心指标）
4. `pi-durable` 是否适合存阅读会话。
5. Protomaps 底图的中文标注覆盖情况、离线文件的体积。
6. 已读边界在跳读场景下的推进规则。
7. 衍生数据（实体表、纠错记录）能否、以何种形式在用户之间分享。
