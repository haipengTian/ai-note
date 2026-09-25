/**
 * 上下文编排器：把各类上下文块按预算裁剪、按稳定度排序后拼成提示词，并输出可追溯的 trace。
 *
 * - protected：永不裁剪（规则、本章任务、出场人物状态……）
 * - compressible：超预算时先退化为 fallback（缩略版），仍超则丢弃
 * - optional：超预算时直接丢弃
 * 排序：稳定的内容在前、变化的在后，让同一作品连续多章的请求共享最长前缀，命中接口的前缀缓存。
 */

export type Tier = "protected" | "compressible" | "optional";

export interface ContextBlock {
  id: string;
  /** 块标题，如 "# 世界观设定" */
  title: string;
  text: string;
  tier: Tier;
  /** 0~1，越稳定越靠前 */
  stability: number;
  /** 裁剪时优先级低的先被处理 */
  priority: number;
  /** compressible 块的缩略版本 */
  fallback?: string;
}

export interface TraceItem {
  id: string;
  title: string;
  tier: Tier;
  chars: number;
  status: "full" | "fallback" | "dropped";
}

export interface Compiled {
  text: string;
  trace: TraceItem[];
  chars: number;
  budget: number;
  overBudget: boolean;
}

const render = (title: string, text: string) => `${title}\n${text.trim()}`;
const SEP = "\n\n";

export function compile(blocks: ContextBlock[], budget: number): Compiled {
  const live = blocks
    .map((b, order) => ({ b, order, status: "full" as TraceItem["status"] }))
    .filter((x) => x.b.text.trim());

  const textOf = (x: (typeof live)[number]) =>
    x.status === "dropped" ? "" : render(x.b.title, x.status === "fallback" ? x.b.fallback ?? "" : x.b.text);
  const total = () => {
    const parts = live.map(textOf).filter(Boolean);
    return parts.reduce((s, p) => s + p.length, 0) + SEP.length * Math.max(0, parts.length - 1);
  };

  // 可裁剪的块按优先级从低到高
  const trimmable = live.filter((x) => x.b.tier !== "protected").sort((a, b) => a.b.priority - b.b.priority);
  for (const x of trimmable) {
    if (total() <= budget) break;
    if (x.b.tier === "compressible" && x.b.fallback?.trim()) {
      x.status = "fallback";
      if (total() <= budget) break;
    }
    x.status = "dropped";
  }

  const ordered = [...live].sort((a, b) => b.b.stability - a.b.stability || a.order - b.order);
  const text = ordered.map(textOf).filter(Boolean).join(SEP);
  return {
    text,
    trace: ordered.map((x) => ({ id: x.b.id, title: x.b.title, tier: x.b.tier, chars: textOf(x).length, status: x.status })),
    chars: text.length,
    budget,
    overBudget: text.length > budget,
  };
}
