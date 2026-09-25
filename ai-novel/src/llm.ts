/**
 * OpenAI 兼容 Chat Completions 客户端（零依赖，内置 fetch，流式）。
 */
import type { z, ZodTypeAny } from "zod";
import { config } from "./config.js";

export interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 流式输出回调 */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface Usage {
  prompt: number;
  completion: number;
}

/** 全局 token 统计（进程内） */
export const usageTotal: Usage = { prompt: 0, completion: 0 };

export async function chat(messages: Msg[], opt: ChatOptions = {}): Promise<string> {
  const body = {
    model: opt.model || config.model,
    messages,
    temperature: opt.temperature ?? config.temperature,
    max_tokens: opt.maxTokens ?? config.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  let res: Response | undefined;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: opt.signal,
      });
    } catch (e) {
      if (opt.signal?.aborted) throw e;
      lastErr = (e as Error).message;
      await sleep(1500 * 2 ** attempt, opt.signal);
      continue;
    }
    if (res.ok) break;
    lastErr = `${res.status} ${await res.text().catch(() => "")}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1500 * 2 ** attempt, opt.signal);
  }
  if (!res || !res.ok || !res.body) throw new Error(`模型接口请求失败：${lastErr.slice(0, 800)}`);

  let text = "";
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new Error(`模型返回错误：${JSON.stringify(j.error).slice(0, 500)}`);
      if (j.usage) {
        usageTotal.prompt += j.usage.prompt_tokens || 0;
        usageTotal.completion += j.usage.completion_tokens || 0;
      }
      const d = j.choices?.[0]?.delta?.content;
      if (typeof d === "string" && d) {
        text += d;
        opt.onText?.(d);
      }
    }
  }
  return text;
}

/** 从模型输出中提取 JSON（兼容 ```json 代码块、前后多余文字） */
export function extractJSON<T = any>(raw: string): T {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error("输出中没有 JSON");
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) throw new Error("JSON 不完整");
  const body = s.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // 常见小毛病：尾逗号、中文引号
    return JSON.parse(body.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"'));
  }
}

/** 要求模型输出 JSON 并按 schema 校验，解析或校验失败自动重试一次 */
export async function chatJSON<S extends ZodTypeAny>(messages: Msg[], schema: S, opt: ChatOptions = {}): Promise<z.output<S>> {
  const o = { model: config.modelFast, temperature: 0.5, ...opt };
  const parse = (raw: string) => schema.parse(extractJSON(raw)) as z.output<S>;
  const raw = await chat(messages, o);
  try {
    return parse(raw);
  } catch (e) {
    const retry = await chat(
      [
        ...messages,
        { role: "assistant", content: raw },
        { role: "user", content: `你的输出无法被解析为符合要求的 JSON（${(e as Error).message.slice(0, 300)}）。请只输出合法的 JSON，不要任何解释。` },
      ],
      { ...o, onText: undefined },
    );
    return parse(retry);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });
}
