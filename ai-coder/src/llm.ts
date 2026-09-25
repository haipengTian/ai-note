/**
 * OpenAI 兼容的 Chat Completions 流式客户端（零依赖，使用内置 fetch）。
 * 兼容 OpenAI / DeepSeek / 通义千问 / Kimi / Ollama / vLLM 等。
 */
import { config } from "./config.js";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function streamChat(
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  let res: Response | undefined;
  let lastErr = "";
  // 对 429 / 5xx 做指数退避重试
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) break;
    lastErr = `${res.status} ${await res.text().catch(() => "")}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1000 * 2 ** attempt, signal);
  }
  if (!res || !res.ok || !res.body) throw new Error(`模型接口请求失败：${lastErr.slice(0, 1000)}`);

  const result: ChatResult = { content: "", reasoning: "", toolCalls: [], finishReason: null };
  const partial: { id: string; name: string; args: string }[] = [];

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new Error(`模型返回错误：${JSON.stringify(json.error)}`);
      if (json.usage) result.usage = json.usage;
      const choice = json.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      if (typeof d.reasoning_content === "string" && d.reasoning_content) {
        result.reasoning += d.reasoning_content;
        cb.onReasoning?.(d.reasoning_content);
      }
      if (typeof d.content === "string" && d.content) {
        result.content += d.content;
        cb.onText?.(d.content);
      }
      if (Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          const i = typeof tc.index === "number" ? tc.index : partial.length;
          partial[i] ??= { id: "", name: "", args: "" };
          if (tc.id) partial[i].id = tc.id;
          if (tc.function?.name) partial[i].name += tc.function.name;
          if (tc.function?.arguments) partial[i].args += tc.function.arguments;
        }
      }
      if (choice.finish_reason) result.finishReason = choice.finish_reason;
    }
  }

  result.toolCalls = partial
    .filter((p) => p && p.name)
    .map((p, i) => ({
      id: p.id || `call_${Date.now()}_${i}`,
      type: "function" as const,
      function: { name: p.name, arguments: p.args || "{}" },
    }));
  return result;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });
}
