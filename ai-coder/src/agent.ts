/**
 * Agent 核心：会话状态 + “模型 → 工具 → 模型” 循环。
 */
import crypto from "node:crypto";
import { config } from "./config.js";
import { streamChat, type ChatMessage, type ToolCall } from "./llm.js";
import { buildSystemPrompt } from "./prompt.js";
import { toolMap, toolSchemas, type ToolContext } from "./tools/index.js";
import { truncate } from "./util/path.js";

/** 推送给前端的事件 */
export type AgentEvent =
  | { type: "start" }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "approval_request"; id: string; name: string; preview: string }
  | { type: "approval_result"; id: string; approved: boolean }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "usage"; prompt: number; completion: number }
  | { type: "error"; message: string }
  | { type: "done"; reason: string };

export type Emit = (e: AgentEvent) => void;

export class Session {
  readonly id = crypto.randomUUID();
  readonly createdAt = Date.now();
  title = "新会话";
  messages: ChatMessage[] = [];
  autoApprove = false;
  busy = false;
  private abort?: AbortController;
  private pending = new Map<string, (approved: boolean) => void>();
  private readFiles = new Map<string, number>();

  constructor(readonly workspace: string) {}

  approve(callId: string, approved: boolean): boolean {
    const r = this.pending.get(callId);
    if (!r) return false;
    this.pending.delete(callId);
    r(approved);
    return true;
  }

  stop() {
    this.abort?.abort();
    for (const [id, r] of this.pending) {
      r(false);
      this.pending.delete(id);
    }
  }

  private waitApproval(callId: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      this.pending.set(callId, resolve);
    });
  }

  /** 处理一条用户消息，直到模型不再调用工具 */
  async run(userText: string, emit: Emit): Promise<void> {
    if (this.busy) throw new Error("当前会话正在执行任务");
    this.busy = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    if (this.messages.length === 0) this.title = userText.slice(0, 40);
    this.messages.push({ role: "user", content: userText });
    emit({ type: "start" });

    const ctx: ToolContext = { workspace: this.workspace, signal, readFiles: this.readFiles };
    let reason = "completed";
    try {
      for (let step = 0; ; step++) {
        if (step >= config.maxSteps) {
          reason = "max_steps";
          emit({ type: "error", message: `已达到最大轮数 ${config.maxSteps}，任务暂停。可以回复“继续”。` });
          break;
        }
        this.trimHistory();
        const system: ChatMessage = { role: "system", content: buildSystemPrompt(this.workspace) };
        const res = await streamChat(
          [system, ...this.messages],
          toolSchemas(),
          {
            onText: (delta) => emit({ type: "text", delta }),
            onReasoning: (delta) => emit({ type: "reasoning", delta }),
          },
          signal,
        );
        if (res.usage) emit({ type: "usage", prompt: res.usage.prompt_tokens, completion: res.usage.completion_tokens });

        const assistant: ChatMessage = { role: "assistant", content: res.content || null };
        if (res.toolCalls.length) assistant.tool_calls = res.toolCalls;
        // DeepSeek 思考模式在工具调用轮需要回传 reasoning_content
        if (res.reasoning && res.toolCalls.length) assistant.reasoning_content = res.reasoning;
        this.messages.push(assistant);

        if (!res.toolCalls.length) break;

        for (const call of res.toolCalls) {
          const output = await this.executeTool(call, ctx, emit);
          this.messages.push({ role: "tool", tool_call_id: call.id, content: output });
        }
        if (signal.aborted) {
          reason = "aborted";
          break;
        }
      }
    } catch (e) {
      if (signal.aborted) reason = "aborted";
      else {
        reason = "error";
        emit({ type: "error", message: (e as Error).message });
      }
      this.repairHistory();
    } finally {
      this.busy = false;
      this.abort = undefined;
      emit({ type: "done", reason });
    }
  }

  private async executeTool(call: ToolCall, ctx: ToolContext, emit: Emit): Promise<string> {
    const tool = toolMap.get(call.function.name);
    let args: any;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      const msg = `工具参数不是合法 JSON：${call.function.arguments.slice(0, 500)}`;
      emit({ type: "tool_call", id: call.id, name: call.function.name, args: call.function.arguments });
      emit({ type: "tool_result", id: call.id, ok: false, output: msg });
      return `错误：${msg}`;
    }
    emit({ type: "tool_call", id: call.id, name: call.function.name, args });
    if (!tool) {
      const msg = `未知工具 ${call.function.name}`;
      emit({ type: "tool_result", id: call.id, ok: false, output: msg });
      return `错误：${msg}`;
    }
    if (ctx.signal.aborted) {
      emit({ type: "tool_result", id: call.id, ok: false, output: "已中止" });
      return "用户中止了任务，工具未执行。";
    }

    try {
      if (tool.needsApproval && !this.autoApprove) {
        // 预览失败（如 old_string 找不到）会直接抛错反馈给模型，不打扰用户
        const preview = tool.preview ? await tool.preview(args, ctx) : JSON.stringify(args, null, 2);
        emit({ type: "approval_request", id: call.id, name: tool.name, preview });
        const approved = await this.waitApproval(call.id, ctx.signal);
        emit({ type: "approval_result", id: call.id, approved });
        if (!approved) {
          const msg = ctx.signal.aborted ? "用户中止了任务" : "用户拒绝了这个操作";
          emit({ type: "tool_result", id: call.id, ok: false, output: msg });
          return `${msg}。请不要重复同样的操作，必要时询问用户想怎么做。`;
        }
      }
      const out = truncate(await tool.run(args, ctx), config.maxToolOutput);
      emit({ type: "tool_result", id: call.id, ok: true, output: out });
      return out;
    } catch (e) {
      const msg = (e as Error).message;
      emit({ type: "tool_result", id: call.id, ok: false, output: msg });
      return `错误：${msg}`;
    }
  }

  /** 中途出错/中止后，保证每个 tool_call 都有对应的 tool 消息，否则下次请求会 400 */
  private repairHistory() {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant" && last.tool_calls?.length) {
      for (const c of last.tool_calls) this.messages.push({ role: "tool", tool_call_id: c.id, content: "已中止，未执行" });
      return;
    }
    // 部分工具已有结果，补齐剩余的
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant" && m.tool_calls?.length) {
        const done = new Set(
          this.messages.slice(i + 1).flatMap((x) => (x.role === "tool" ? [x.tool_call_id] : [])),
        );
        for (const c of m.tool_calls)
          if (!done.has(c.id)) this.messages.push({ role: "tool", tool_call_id: c.id, content: "已中止，未执行" });
        return;
      }
      if (m.role === "user") return;
    }
  }

  /** 简单的上下文管理：历史过长时，从最早的用户轮次开始整轮丢弃 */
  private trimHistory() {
    const size = () => this.messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
    while (size() > config.maxHistoryChars) {
      const nextUser = this.messages.findIndex((m, i) => i > 0 && m.role === "user");
      if (nextUser <= 0) {
        // 只剩当前这一轮：压缩较早的工具输出
        let shrunk = false;
        for (const m of this.messages.slice(0, -6)) {
          if (m.role === "tool" && m.content.length > 500) {
            m.content = m.content.slice(0, 300) + "\n...[为节省上下文已省略]";
            shrunk = true;
          }
        }
        if (!shrunk) break;
        continue;
      }
      this.messages.splice(0, nextUser);
    }
  }

  /** 给前端回放历史用的精简视图 */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      autoApprove: this.autoApprove,
      busy: this.busy,
      messages: this.messages,
    };
  }
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  create(workspace: string) {
    const s = new Session(workspace);
    this.sessions.set(s.id, s);
    return s;
  }
  get(id: string) {
    return this.sessions.get(id);
  }
  list() {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  delete(id: string) {
    this.sessions.get(id)?.stop();
    return this.sessions.delete(id);
  }
}
