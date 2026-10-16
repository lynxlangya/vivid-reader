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
