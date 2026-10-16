# 无人值守开发日志

## 执行约定与起点

- 日期：2026-10-16（Asia/Singapore）。分支 main，起点 e3fad6a，工作区干净。
- 完整阅读 AGENTS.md、IMPLEMENTATION、codex-goals；阶段开始前按清单阅读关联资料。
- 严格 G0 → G5，逐阶段验收与本地提交，不 push、不建分支、不改写历史。
- 当前未提供真实测试书和模型密钥环境变量；依赖它们的实跑标为“未实跑”。不记录值与路径。
- 真书内容、实体及衍生数据均不进入日志和提交；测试只用自拟合成数据。

## G0 · 工程骨架

### 开始

2026-10-16：读取 G0 完整需求、架构第 9 节、v2 视觉规范与原型，开始搭建。

### 自主决定

- 按总目标覆盖逐步确认要求，验收通过后直接进入下一阶段。
- 许可证保持待定，不做可选大图；人工链接准确率保留待核对，不伪造人工结果。

- 静态示例只选 v2 规范的无专名自拟段落，避免把示例中的真实实体名带入新增代码。

### 完成条件

1. `npm run check`：通过。双端 strict 类型检查、ESLint、Prettier、1 个单元测试、仓库卫生检查均通过。
2. `npm run build`：通过；`npm run test:e2e`：通过，1 passed (2.9s)，窗口标题、正文、无 require、受控 IPC 与非法载荷拒绝均实测通过。
3. 仓库文件检查：44 个索引文件审计通过；受禁扩展名列表为空，暂存差异无书籍内容或衍生数据。
4. 提交：使用指定信息 `chore: scaffold electron-vite app (G0)`。

### 验证补充

- `npm ls --depth=0`：11 个运行时、19 个开发直接依赖，全部与实施计划精确版本一致。
- manifest 与 lockfile 的 dependencies / devDependencies 一致；npm install 审计为 0 vulnerabilities。
- `npm run test:live`：1 skipped（无密钥）；G0 仅建立测试入口，真实模型调用在 G1 实现。
- 首轮类型检查中的 E2E 全局声明缺失已修复；当前 Electron 不再声明旧的窗口偏好读取 API，改为验证渲染层没有 require、且只通过受控 IPC 通信。
- 字体构建仅包含 Regular 子集。现有文档保持原格式，Prettier 检查源码、配置及新增开发记录。

### 遗留与下一步

- 2026-10-16：G0 结束，完成全部条件；截图 `/tmp/vivid-g0-reader.png` 已视觉检查，未入库。首次 Electron 下载较慢，但最终成功，无需变更版本。
- G1 需实测真实浏览器与主进程 DOM 的 CFI 往返一致性。

## G1 · 阅读器探针

### 开始

2026-10-16：G0 已提交为 2a3d1da。重新读取 G1 完整代码块、IMPLEMENTATION 第 2 / 3.2 / 3.3 / 3.8 节与 G1、ARCHITECTURE 第 3 / 4 节及所列决定，开始阅读器与两项探针。

### 自主决定与进行中事项

- 真实书与模型环境变量仍未提供，相应测试按约定跳过。
- 先验证方案 A；只有明确失败证据时才采用方案 B。
- 发现上游分页及固定版式 iframe 为 WebKit 兼容开放了脚本。按不可违反的进程隔离和实施计划安全默认，仅移除两处 allow-scripts，其他源码保持原样；追加 D-37（待 review），并增加脚本不执行验收。

### 自主决定补充

- CSS Custom Highlight 的线宽、偏移及实际绘制可用，采用首选方式，不包装正文 DOM。
- 纯文本偏移采用 DOM 解码后的 UTF-16 单元，保留空白，CFI 生成按节点所在逻辑文本块累加偏移。
- 保留 4% 栏间距，避免零间距下前一栏边缘被分页器误计入后一页；实际正文约 34 字一行。
- 阅读器等待章节字体与排版帧就绪后宣告可交互，消除过早命中的布局竞态。
- 位置 JSON 使用串行原子写入，防止连续 relocate 覆盖临时文件。G2 再迁移到数据库。

### 完成条件逐条结果

1. `npm run check`：通过，5 个测试文件、12 个单元测试；双端 strict / ESLint / Prettier / audit 均通过。`npm run test:e2e`：2 passed、1 skipped（3.1s），覆盖合成书导入、翻页、悬停出卡、Esc、重启恢复。
2. 合成书 200 个偏移：0 不一致。首次 5 不一致定位到 XML 解码后的相邻节点，已修复并复测为 0。真实书：未实跑，无变量，测试 skipped。
3. 同页 Custom Highlight 注入前、移除后、恢复后 CFI 完全相同。默认线宽 1px、偏移 5px，浏览器样式与截图验证通过。
4. `npm run test:live`：1 skipped，无密钥；真实调用代码已接入 pi-ai 的 DeepSeek 目录，默认模型由目录选择，未声称实跑。
5. `docs/spikes/M0-offset-cfi.md` 已完成：采用 A 和 Custom Highlight，记录初始失败、修复、最终数字与限制。
6. 使用指定提交信息 `feat: reader probe with foliate-js, cfi position and mark injection (G1)`，提交前再次检查索引与卫生。

### 结束与遗留

2026-10-16：G1 条件全部满足（真实书和模型按授权跳过），准备本地提交。

- D-37 安全补丁待 review；源码其他部分不改。当前仅启用 EPUB 产品入口。
- 合成截图 `/tmp/vivid-g1-reader.png` 已视觉检查，不入库。
- 地图、实体流水线和完整旁注在后续阶段实现；当前标注仅为合成探针。
- 真实 EPUB 兼容性与真实模型响应未实跑；不同 EPUB 结构仍可能出现新类型问题。
