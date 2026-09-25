/**
 * 章节大纲规划提示词。
 */
import type { Msg } from "../llm.js";
import type { Novel } from "../model/types.js";
import { stateAt } from "../state/events.js";
import { memoryLayers, renderProfiles, renderStates } from "../context/select.js";
import { clip } from "../util/text.js";
import { NOVELIST, novelHeader } from "./shared.js";

const MAX_HOOKS = 40;

function hooksForPlanning(n: Novel, from: number): string {
  const open = n.memory.hooks
    .filter((h) => (h.status === "open" || h.status === "progressing") && h.plantedIn < from)
    .sort((a, b) => Number(b.importance === "major") - Number(a.importance === "major") || a.plantedIn - b.plantedIn)
    .slice(0, MAX_HOOKS);
  if (!open.length) return "（无）";
  return open
    .map((h) => {
      const idle = from - Math.max(h.plantedIn, h.lastAdvancedIn ?? 0);
      return `- [${h.id}]${h.importance === "major" ? "【主线】" : ""} ${h.content}（第${h.plantedIn}章埋下，已 ${idle} 章未推进）`;
    })
    .join("\n");
}

export function chapterPlanPrompt(n: Novel, from: number, count: number): Msg[] {
  const to = from + count - 1;
  const mem = memoryLayers(n, from);
  const appeared = n.characters.filter((c) => c.firstAppearance === undefined || c.firstAppearance < from);
  const world = stateAt(n.characters, n.memory.events, from);
  const recent = mem.chapterSummaries.slice(-10);
  const prevPlanned = n.chapters.filter((c) => c.index < from && c.status !== "written").slice(-5);

  return [
    { role: "system", content: NOVELIST },
    {
      role: "user",
      content: `# 作品信息
${novelHeader(n)}

# 全书总纲
${clip(n.outline, 8000)}

# 人物设定
${clip(renderProfiles(appeared), 8000)}

# 全书梗概（更早的剧情）
${mem.synopsis || "（无）"}
${mem.arcSummaries.length ? `\n# 分段剧情\n${mem.arcSummaries.map((a) => `## 第 ${a.range[0]}~${a.range[1]} 章\n${a.summary}`).join("\n\n")}\n` : ""}
# 最近章节
${recent.length ? recent.map((c) => `- 第${c.index}章《${c.title}》：${c.summary}`).join("\n") : "（无，这是开篇）"}
${prevPlanned.length ? `\n# 已规划但未写的前序章节\n${prevPlanned.map((c) => `- 第${c.index}章《${c.title}》：${c.outline}`).join("\n")}\n` : ""}
# 人物当前状态（第 ${from} 章开始时）
${clip(renderStates(n, appeared, world), 6000) || "（暂无）"}

# 未回收的伏笔
${hooksForPlanning(n, from)}

# 任务：规划第 ${from}~${to} 章的章节大纲
请根据总纲当前所处的卷，接着最近章节，规划第 ${from}~${to} 章。要求：
- 每章 outline 写 3~5 个具体情节要点（谁、在哪、做了什么、结果），明确本章的冲突/爽点和结尾钩子；
- 相邻章节因果连贯，节奏有张有弛，大约每 3~5 章一个小高潮；
- 人物行动必须符合当前状态（实力、所在地、持有物品、知道的秘密）；
- 合理安排伏笔：主线伏笔要持续推进；长期未推进的伏笔要安排推进或回收；需要推进/回收时在要点里写明伏笔 id；${from === 1 ? "\n- 第 1 章必须快速抓人：开篇即冲突，尽早展示主角处境与金手指的苗头；" : ""}
- characters 列出本章主要出场人物的姓名。

只输出 JSON：
{"chapters":[{"title":"章节标题（4~12字，有吸引力）","outline":"……","characters":["姓名"]}]}`,
    },
  ];
}
