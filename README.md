# 历历 · Vivid

读到哪里，哪里就历历在目。

历历是一个优先照顾阅读体验的 macOS EPUB 阅读器。专名线保持稀疏，悬停时展示真实地图和此处语境释义；伴读和按需总结只能通过工具读取已读边界之前的内容。

## 当前能力

- EPUB 分页、目录、位置恢复，日夜主题，宋体 / 楷体对调。
- 本机书架、题签封面、导入进度；整理时可以先开始读。
- Natural Earth 舆图插页、Wikidata 基础事实、语境释义、已知标记与人工纠错。
- 批注本式流式伴读，选区 / 本章 / 至此总结，经过校验的引用跳转。
- 独立的已读边界：顺序翻页停留 5 秒后推进；目录和引用跳读不推进。手动回退会归档旧对话。
- ⌥ 进入标注导航，Tab 切换，↩ 打开，Esc 退出；⌘↩ 发送问题。

本次 G0～G5 未实现知识图谱、真实人物画像、AI 场景图及可缩放大图。知识图谱的 MVP 归属仍待统一 review，ROADMAP 目前将其列为 v0.2；真实书的链接准确率仍待人工核对。

## 界面

以下均为自拟合成 EPUB，不是真实出版物或书籍缓存。

![日间阅读与舆图](docs/screenshots/reader.png)

![批注本式伴读](docs/screenshots/companion.png)

![题签书架](docs/screenshots/library.png)

## 安装与运行

目前提供本机构建的 **Apple Silicon、未签名** dmg，没有发布下载页。自行构建需 macOS、Node.js ≥22.19 和 npm；推荐 `.nvmrc` 的版本。

```sh
npm ci
npm run dev
```

导入自己拥有使用权的 EPUB。书籍放在仓库外；应用把它复制到本机用户数据目录。设置 → 模型中填写自己的 DeepSeek Key，再选择目录中的文字模型。没有 Key 仍可阅读，整理与伴读会显示等待或失败状态。

```sh
npm run build:mac
```

产物在 `release/`。未签名应用需由用户在 macOS 中明确允许打开；本项目没有签名、公证或自动更新渠道。该命令只打包，不上传或发布。

## 隐私与已读边界

EPUB、数据库、释义、人工纠错、报告和对话保存在本机 `~/Library/Application Support/Vivid/`，不进入仓库。Key 只通过 Electron safeStorage 加密保存；应用没有读取 Key 到渲染器的接口。设置中的“保存在系统钥匙串中”指使用系统保护能力加密，本机文件中保存的是密文。

使用 AI 功能会向 **DeepSeek** 发送必要的文字：预处理允许发送全书的分块，伴读只发送已读材料，释义只发送该提及之前的上下文。实体链接和手动搜索会向 **Wikidata** 发送实体名称。地图与字体随应用打包；渲染器不发外网请求。默认题签封面不使用出版物封面，开启原书封面后才从本机文件读取。

工具层逐次读取并强制截断已读边界，不靠提示词防剧透。但模型可能在训练中见过这本书，无法保证其训练记忆完全不提及后文；这项局限仍需读者知晓。

## 开发与验收

```sh
npm run check       # 类型、lint、单元测试、仓库卫生
npm run build       # 三端生产构建
npm run test:e2e    # 实际 Electron：导入、CFI、旁注、边界、伴读、设置
npm run test:live   # 缺少 DEEPSEEK_API_KEY 时自动跳过
npm run test:perf   # 合成大书上的主进程热路径耗时
npm run report:m1   # 本机报告，只输出统计与报告路径
```

真实 EPUB 通过 `VIVID_TEST_EPUB` 环境变量提供，必须放在仓库外。真实模型 Key 通过 `DEEPSEEK_API_KEY` 提供给 live 测试，不写进文件或日志。E2E 使用合成书和 fauxProvider，报告与测试截图均在仓库外。`preprocess:m1` 仅处理指定测试书的前两章并生成核对报告，人工准确率不能由自动测试代替。

项目入口：[AGENTS.md](AGENTS.md)、[实施方案](docs/IMPLEMENTATION.md)、[决策](docs/DECISIONS.md)、[开发验收日志](docs/dev-log.md)、[贡献指南](CONTRIBUTING.md)。视觉以 [v2 规范](prototype/v2-folio-atlas/DESIGN.md) 为准。

## 许可证

待定。尚未创建项目 LICENSE；`package.json` 的 `UNLICENSED` 只表示暂未授予开源许可。第三方组件保留各自许可证，foliate-js 原始 MIT LICENSE 与字体 OFL 文件随应用保留。公开发布前仍需确定项目许可证和维护者联系方式。
