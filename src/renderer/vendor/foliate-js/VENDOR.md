# foliate-js

- 来源：https://github.com/johnfactotum/foliate-js
- Commit：`78914aef4466eb960965702401634c2cb348e9b1`（2026-05-01）
- 许可证：MIT，见 LICENSE；嵌套 vendor 保留其自身版权声明。
- 复制根目录 JavaScript 运行时代码及 vendor 资源；不复制上游测试、示例页面、构建配置或版本库元数据。
- 本地改动：仅在 `paginator.js` 与 `fixed-layout.js` 各删除 sandbox 属性中的 `allow-scripts`。上游为 WebKit 兼容而启用脚本；Electron 使用 Chromium，必须服从项目的禁脚本规则。其余源码字节保持原样，见 D-37（待 review）。
- 产品入口只接受 EPUB，未启用其他格式；保留运行时动态 import 的原始依赖以免修改上游代码。
- 第三方文件不参与项目 ESLint / Prettier / 中文字面量检查。
