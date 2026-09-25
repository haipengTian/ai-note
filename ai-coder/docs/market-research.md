# AI 写代码产品调研（2026-09）

## 一、产品形态

| 形态 | 商业产品 | 开源参考 | 交互方式 |
|---|---|---|---|
| 终端 / CLI Agent | Claude Code、OpenAI Codex CLI、Gemini CLI | OpenCode、Aider、Pi | 终端里对话，Agent 自主读改代码、跑命令 |
| AI IDE / 插件 | Cursor、Windsurf、GitHub Copilot、Kiro、Antigravity | Cline、Roo Code、Continue | 补全 + 侧边栏对话 + Agent 模式 |
| 云端自主工程师 | Devin、Codex Cloud、Copilot Coding Agent | OpenHands | 异步在云沙箱里完成任务，产出 PR |
| Prompt → 应用 | v0、Bolt.new、Lovable | bolt.diy | 一句话生成可预览的 Web 应用 |

## 二、共同的核心：Agent 循环（Harness）

```
用户需求 → [系统提示 + 历史 + 工具定义] → 模型
      ↑                                     ↓
   工具结果  ←── 执行（读/搜/改/跑命令）←── 工具调用
                                            ↓
                                    没有工具调用 → 结束
```

各家差异集中在"循环之外"的工程：

1. **编辑方式**：整文件重写（简单、费 token）→ search/replace（Claude Code、Cline）→ unified diff / patch（Codex、Aider）。精确替换 + 唯一性校验是目前最稳的方案。
2. **上下文获取**：
   - 让模型自己用 grep/glob/read 探索（Claude Code 路线，简单有效）
   - 仓库地图：tree-sitter 抽取符号签名（Aider）
   - 向量索引 / 语义检索（Cursor、Windsurf）
3. **上下文管理**：长任务的历史压缩、工具输出截断、子 Agent 隔离上下文。
4. **权限与安全**：按工具分级审批、命令白名单、沙箱（容器 / seatbelt / landlock）。
5. **项目记忆**：`AGENTS.md`、`CLAUDE.md`、`.cursorrules` 这类规则文件已成事实标准。
6. **扩展**：MCP 协议接外部工具，Skills / 自定义命令，Hooks。
7. **验证闭环**：改完自动跑测试/类型检查/lint，失败再修。

## 三、本项目的定位与取舍

- 形态：Web 界面 + 本地后端 Agent（介于 CLI Agent 与 IDE 之间，浏览器即可使用）
- 模型：OpenAI 兼容接口，一套代码对接国内外模型
- 编辑：search/replace + 先读后改校验 + diff 审批
- 上下文：模型自主探索（grep/glob/read）+ 历史裁剪；后续再加索引与压缩

## 参考资料

- [Best AI Coding Agent (2026): Ranked by Terminal-Bench, Price, and Source](https://www.morphllm.com/ai-coding-agent)
- [Open-Source AI Coding Agents 2026: The Complete Comparison](https://wetheflywheel.com/en/guides/open-source-ai-coding-agents-2026/)
- [Best Open Source CLI Coding Agents in 2026 | Pinggy](https://pinggy.io/blog/best_open_source_cli_coding_agents/)
- [AI Coding Agents 2026: Claude Code vs Antigravity 2.0 vs Codex vs Cursor vs Kiro vs Copilot vs Windsurf](https://lushbinary.com/blog/ai-coding-agents-comparison-cursor-windsurf-claude-copilot-kiro-2026/)
- [Top AI Coding Agents and Development Platforms in 2026 - MarkTechPost](https://www.marktechpost.com/2026/06/10/ai-coding-agents-development-platforms-2026/)
- [Building a Coding Agent From Scratch: Harness Architecture](https://www.decodingai.com/p/building-a-coding-agent-from-scratch-system-design)
- [How to Build a Coding Agent Harness From Scratch](https://futureagi.com/blog/how-to-build-a-coding-agent-harness/)
