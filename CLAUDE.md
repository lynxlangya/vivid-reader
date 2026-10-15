# CLAUDE.md

本项目的协作规则以 AGENTS.md 为唯一来源，请先阅读：

@AGENTS.md

## Claude Code 补充说明

- 回复用中文。
- 动手前先说明计划。
- 架构或产品层面的改动先和我讨论，达成一致后再追加到 `docs/DECISIONS.md`。
- 协作规则的增改写进 AGENTS.md，本文件只放 Claude Code 特有的内容。
- 硬约束同样适用于 Claude Code 自己的通道：auto memory 不记录书籍原文或由书生成的数据；派给 subagent 的任务若涉及书本内容、防剧透或密钥，在提示里写明相关约束（subagent 未必加载本文件）。
