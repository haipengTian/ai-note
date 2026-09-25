# AI Coder

一个 **Web 界面 + 后端 Agent** 的 AI 编程助手：在浏览器里描述需求，后端 Agent 在你的项目目录里读代码、搜索、修改文件、运行命令，改动和命令执行前会在网页上请求你确认。

- 支持任意 **OpenAI 兼容接口**：DeepSeek、通义千问、Kimi、OpenAI、Ollama、vLLM……
- **零运行时依赖**：后端只用 Node 内置模块（`http`、`fetch`、`child_process`），前端是原生 JS
- 流式输出、并行工具调用、diff 预览、一键停止、会话切换、文件浏览

## 快速开始

需要 Node.js ≥ 20.12。

```bash
cd ai-coder
npm install
cp .env.example .env        # Windows: copy .env.example .env
# 编辑 .env：填 OPENAI_BASE_URL / OPENAI_API_KEY / MODEL，WORKSPACE 指向要操作的项目
npm start
```

打开 http://127.0.0.1:3000 。

> `WORKSPACE` 为空时默认操作启动目录本身。建议先用一个测试项目或确保项目在 git 下，方便回滚。

## 架构

```
浏览器 (public/)                       Node 后端 (src/)
┌─────────────────────┐   POST /api/chat    ┌──────────────────────────────┐
│ 聊天 / 工具卡片      │ ─────────────────▶ │ server.ts  HTTP + SSE         │
│ diff 审批 / 文件树   │ ◀───── SSE 事件 ── │   └─ agent.ts  Session.run()  │
│                     │   POST /api/approve │        │  ▲                   │
└─────────────────────┘ ─────────────────▶ │        ▼  │ tool 结果          │
                                            │   llm.ts 流式调用模型          │
                                            │   tools/ 读/写/改/搜/执行      │
                                            └──────────────────────────────┘
```

**Agent 循环**（`src/agent.ts`）：

1. 用户消息加入历史，拼上系统提示（`src/prompt.ts`，含 OS、git 状态、项目规则文件）
2. 流式调用模型，文本/思考过程实时推给前端
3. 模型返回工具调用 → 需要审批的工具先生成预览（diff / 命令）→ 等前端确认
4. 执行工具，结果回填历史，回到第 2 步；模型不再调用工具时结束

### 文件说明

| 文件 | 作用 |
|---|---|
| `src/server.ts` | HTTP 路由、静态文件、SSE 推送 |
| `src/agent.ts` | 会话状态、Agent 循环、审批等待、中止、历史修复与裁剪 |
| `src/llm.ts` | OpenAI 兼容流式客户端，拼装分片的 tool_calls，429/5xx 重试 |
| `src/prompt.ts` | 系统提示词；自动读取 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` |
| `src/tools/fs.ts` | `list_dir` `read_file` `write_file` `edit_file` |
| `src/tools/search.ts` | `find_files`（glob）`grep`（有 ripgrep 用 rg，否则 JS 实现） |
| `src/tools/shell.ts` | `run_command`（Windows 用 PowerShell，超时、中止、输出截断） |
| `src/util/diff.ts` | 行级 unified diff，用于审批预览 |
| `public/` | 前端：`app.js` 主逻辑、`markdown.js` 渲染、`style.css`（自动明暗主题） |

### 安全设计

- 所有路径强制限制在 `WORKSPACE` 内
- 写文件、编辑、执行命令默认需要网页确认（可开“自动批准”）
- `edit_file` 必须先 `read_file`，且读取后文件被外部改动会拒绝编辑，防止覆盖
- 服务默认只监听 `127.0.0.1`

## 项目规则

在被操作的项目根目录放一个 `AGENTS.md`，写上技术栈、代码规范、测试命令等，Agent 每轮都会读取并遵守。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/info` | 模型、工作区信息 |
| GET/POST | `/api/sessions` | 会话列表 / 新建会话 |
| GET/DELETE | `/api/session?id=` | 会话详情 / 删除 |
| POST | `/api/chat` | `{sessionId, message}`，返回 SSE 事件流 |
| POST | `/api/approve` | `{sessionId, callId, approved}` |
| POST | `/api/stop` | `{sessionId}` 中止当前任务 |
| POST | `/api/settings` | `{sessionId, autoApprove}` |
| GET | `/api/tree?path=` `/api/file?path=` | 文件树 / 文件内容 |

SSE 事件类型：`start` `text` `reasoning` `tool_call` `approval_request` `approval_result` `tool_result` `usage` `error` `done`。

## 路线图（MVP 之后）

- [ ] 会话持久化到磁盘（`.ai-coder/sessions/*.json`）
- [ ] 上下文压缩：接近上限时让模型总结早期对话，替代直接丢弃
- [ ] 检查点 / 撤销：每次写文件前做快照，一键回滚（或基于 git stash）
- [ ] 多工作区 / 在网页上切换项目目录
- [ ] 子 Agent：把大范围代码搜索交给独立上下文执行
- [ ] MCP 客户端：接入外部工具（浏览器、数据库、文档）
- [ ] 代码索引：仓库地图（符号级摘要）或向量检索，提升大项目的定位能力
- [ ] 前端代码高亮、编辑器内嵌（Monaco）、图片输入
- [ ] Docker 沙箱执行命令、多用户与鉴权
