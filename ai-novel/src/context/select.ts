/**
 * 取材：写第 N 章时从作品中挑出哪些内容，组装成上下文块（交给 compiler 裁剪排序）。
 */
import type { Arc, Chapter, Character, Novel } from "../model/types.js";
import type { ContextBlock } from "./compiler.js";
import { stateAt, type WorldState } from "../state/events.js";
import { relevantHooks } from "../state/hooks.js";
import { resolveCharacter } from "../state/digest.js";
import { novelHeader } from "../prompts/shared.js";
import { clip } from "../util/text.js";

const MAX_FALLBACK_CHARS = 8;
const PREV_TAIL = 1500;

// ------------------------------------------------------------------ 分层记忆
export interface MemoryLayers {
  synopsis: string;
  arcSummaries: Arc[];
  chapterSummaries: Chapter[];
}

/** 第 N 章之前的剧情记忆：全书梗概 → 已冻结的弧摘要 → 其余章节的章摘要 */
export function memoryLayers(n: Novel, index: number): MemoryLayers {
  const upTo = n.memory.synopsisUpTo;
  const arcSummaries = n.arcs.filter((a) => a.summary && a.range[0] > upTo && a.range[1] < index);
  const inSummarizedArc = (i: number) => arcSummaries.some((a) => i >= a.range[0] && i <= a.range[1]);
  const chapterSummaries = n.chapters.filter(
    (c) => c.status === "written" && c.summary && c.index < index && c.index > upTo && !inSummarizedArc(c.index),
  );
  return { synopsis: n.memory.bookSynopsis, arcSummaries, chapterSummaries };
}

// ------------------------------------------------------------------ 人物
const appeared = (c: Character, index: number) => c.firstAppearance === undefined || c.firstAppearance <= index;

/** 本章出场人物 + 主角；章纲没列人物时取前 8 个已登场人物 */
export function selectCharacters(n: Novel, chapter: Chapter): Character[] {
  const pool = n.characters.filter((c) => appeared(c, chapter.index));
  if (!chapter.characters.length) return pool.slice(0, MAX_FALLBACK_CHARS);
  const named = new Set(chapter.characters.map((name) => resolveCharacter(pool, name)?.id).filter(Boolean));
  return pool.filter((c) => named.has(c.id) || /主角/.test(c.role));
}

export function renderProfiles(chars: Character[]): string {
  return chars.map((c) => `## ${c.name}（${c.role}）${c.aliases.length ? ` 又称：${c.aliases.join("、")}` : ""}\n${c.profile}`).join("\n\n");
}

export function renderStates(n: Novel, chars: Character[], world: WorldState): string {
  const nameOf = (id: string) => n.characters.find((c) => c.id === id)?.name ?? id;
  const secretOf = (id: string) => n.memory.secrets.find((s) => s.id === id)?.content ?? id;
  return chars
    .map((c) => {
      const s = world[c.id];
      if (!s) return `## ${c.name}\n（无记录）`;
      const lines = [
        !s.alive ? "- **已死亡**" : "",
        Object.keys(s.attrs).length ? `- ${Object.entries(s.attrs).map(([k, v]) => `${k}：${v}`).join("；")}` : "",
        Object.keys(s.inventory).length ? `- 持有：${Object.entries(s.inventory).map(([k, v]) => `${k}×${v}`).join("、")}` : "",
        Object.keys(s.relations).length ? `- 关系：${Object.entries(s.relations).map(([k, v]) => `${nameOf(k)}（${v}）`).join("、")}` : "",
        s.knows.length ? `- 知道的秘密：${s.knows.map(secretOf).join("；")}` : "",
      ].filter(Boolean);
      return `## ${c.name}\n${lines.join("\n") || "（无记录）"}`;
    })
    .join("\n\n");
}

export function renderHooks(n: Novel, index: number): string {
  const list = relevantHooks(n.memory.hooks, index);
  if (!list.length) return "（无）";
  return list
    .map(
      ({ hook: h, overdue }) =>
        `- [${h.id}]${h.importance === "major" ? "【主线】" : ""}${overdue ? "【已超期，尽快推进或回收】" : ""} ${h.content}（第${h.plantedIn}章埋下${h.lastAdvancedIn ? `，第${h.lastAdvancedIn}章推进` : ""}）`,
    )
    .join("\n");
}

const summaryLine = (c: Chapter) => `- 第${c.index}章《${c.title}》：${c.summary}`;

// ------------------------------------------------------------------ 上下文块
/** 写作 / 审校共用的上下文块 */
export function chapterBlocks(n: Novel, index: number, prevText: string): ContextBlock[] {
  const chapter = n.chapters.find((c) => c.index === index)!;
  const next = n.chapters.find((c) => c.index === index + 1);
  const chars = selectCharacters(n, chapter);
  const world = stateAt(n.characters, n.memory.events, index);
  const mem = memoryLayers(n, index);

  const blocks: ContextBlock[] = [
    { id: "header", title: "# 作品信息", text: novelHeader(n), tier: "protected", stability: 1, priority: 100 },
    {
      id: "worldview",
      title: "# 世界观设定",
      text: n.worldview,
      tier: "compressible",
      stability: 0.95,
      priority: 70,
      fallback: clip(n.worldview, 3000),
    },
    {
      id: "synopsis",
      title: "# 全书梗概（更早的剧情）",
      text: mem.synopsis,
      tier: "compressible",
      stability: 0.9,
      priority: 60,
      fallback: clip(mem.synopsis, 1200),
    },
    ...mem.arcSummaries.map(
      (a, i): ContextBlock => ({
        id: `arc:${a.index}`,
        title: `# 第 ${a.range[0]}~${a.range[1]} 章剧情`,
        text: a.summary ?? "",
        tier: "compressible",
        stability: 0.85,
        priority: 40 + i, // 越近越重要
      }),
    ),
    { id: "profiles", title: "# 本章相关人物设定", text: renderProfiles(chars) || "（暂无）", tier: "protected", stability: 0.7, priority: 90 },
    {
      id: "recent",
      title: "# 最近章节摘要",
      text: mem.chapterSummaries.map(summaryLine).join("\n") || "（无，这是第一章）",
      tier: "compressible",
      stability: 0.5,
      priority: 80,
      fallback: mem.chapterSummaries.slice(-5).map(summaryLine).join("\n"),
    },
    {
      id: "states",
      title: `# 人物当前状态（第 ${index} 章开始时，务必遵守）`,
      text: renderStates(n, chars, world) || "（暂无）",
      tier: "protected",
      stability: 0.35,
      priority: 95,
    },
    { id: "hooks", title: "# 未回收的伏笔（本章可视情况推进，不必强行回收）", text: renderHooks(n, index), tier: "protected", stability: 0.3, priority: 85 },
    {
      id: "prev",
      title: "# 上一章正文（请自然衔接）",
      text: prevText,
      tier: "compressible",
      stability: 0.2,
      priority: 75,
      fallback: prevText ? "……" + prevText.slice(-PREV_TAIL) : "",
    },
    {
      id: "chapter",
      title: `# 本章大纲：第 ${index} 章《${chapter.title}》`,
      text: `${chapter.outline}${chapter.characters.length ? `\n出场人物：${chapter.characters.join("、")}` : ""}`,
      tier: "protected",
      stability: 0.05,
      priority: 100,
    },
  ];
  if (next)
    blocks.push({
      id: "next",
      title: "# 下一章预告（仅供结尾铺垫，不要写到下一章的内容）",
      text: `第 ${next.index} 章《${next.title}》：${next.outline}`,
      tier: "optional",
      stability: 0.04,
      priority: 50,
    });
  return blocks;
}
