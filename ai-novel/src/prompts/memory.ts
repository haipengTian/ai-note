/**
 * 记忆维护提示词：章后抽取（结构化状态变化）、弧摘要、全书梗概合并。
 */
import type { Msg } from "../llm.js";
import type { Arc, Chapter, Novel } from "../model/types.js";
import { stateAt } from "../state/events.js";
import { DEFAULT_STATE_KEYS } from "./shared.js";

const ARCHIVIST = "你是小说编辑助理，负责维护作品的设定一致性档案。只根据正文事实提取信息，不要臆测，不要遗漏。";

function characterLedger(n: Novel, index: number): string {
  const world = stateAt(n.characters, n.memory.events, index);
  const nameOf = (id: string) => n.characters.find((c) => c.id === id)?.name ?? id;
  return n.characters
    .filter((c) => c.firstAppearance === undefined || c.firstAppearance <= index)
    .map((c) => {
      const s = world[c.id];
      const parts = [
        s.alive ? "" : "已死亡",
        ...Object.entries(s.attrs).map(([k, v]) => `${k}：${v}`),
        Object.keys(s.inventory).length ? `持有：${Object.entries(s.inventory).map(([k, v]) => `${k}×${v}`).join("、")}` : "",
        Object.keys(s.relations).length ? `关系：${Object.entries(s.relations).map(([k, v]) => `${nameOf(k)}（${v}）`).join("、")}` : "",
        s.knows.length ? `知道的秘密：${s.knows.map((id) => `[${id}]`).join("")}` : "",
      ].filter(Boolean);
      const alias = c.aliases.length ? `；又称：${c.aliases.join("、")}` : "";
      return `- ${c.name}（${c.role}${alias}）：${parts.join("；") || "无记录"}`;
    })
    .join("\n");
}

export function digestPrompt(n: Novel, c: Chapter, text: string): Msg[] {
  const hooks = n.memory.hooks.filter((h) => h.status === "open" || h.status === "progressing" || h.status === "deferred");
  const secrets = n.memory.secrets;
  return [
    { role: "system", content: ARCHIVIST },
    {
      role: "user",
      content: `# 人物档案（第 ${c.index} 章开始时的状态）
${characterLedger(n, c.index) || "（暂无）"}

# 已知秘密
${secrets.length ? secrets.map((s) => `- [${s.id}] ${s.content}`).join("\n") : "（无）"}

# 未回收的伏笔
${hooks.length ? hooks.map((h) => `- [${h.id}]${h.importance === "major" ? "【主线】" : ""} ${h.content}`).join("\n") : "（无）"}

# 第 ${c.index} 章《${c.title}》正文
${text}

# 任务：章节记忆抽取
阅读本章正文，输出 JSON：
{
  "summary": "本章剧情摘要，150~250 字，写清关键事件、结果和结尾悬念",
  "events": [{"character":"人物姓名","kind":"attr|relation|knowledge|inventory|life","key":"……","op":"set|add|remove","value":"……","evidence":"逐字摘抄的正文原句"}],
  "newCharacters": [{"name":"姓名","aliases":[],"role":"配角/反派等","profile":"50~150字简介","attrs":{"所在地":"……"}}],
  "newSecrets": [{"ref":"S1","content":"秘密内容","knownToReader":true}],
  "hooks": [{"op":"plant","content":"新伏笔/悬念，一句话","type":"foreshadow|mystery|promise|conflict","importance":"major|minor","note":""}, {"op":"advance|resolve","id":"伏笔id","note":"本章如何推进/回收"}]
}

events 的 kind 说明：
- attr：人物属性变化。key 用属性名，**优先沿用档案里已有的属性名**（常用：${DEFAULT_STATE_KEYS.join("、")}）；op=set 设为新值，op=remove 表示该属性不再适用
- relation：关系变化。key 为对方姓名，value 为新的关系描述
- knowledge：人物得知了某个秘密。key 为已知秘密的 id，或 newSecrets 里的 ref
- inventory：物品/资源变化。key 为物品名；op=add 时 value 为数量变化（获得为正、消耗/失去为负），op=set 设为某数量，op=remove 为全部失去
- life：生死变化。value 为 dead 或 alive

规则：
- 只记录本章实际发生的变化，和档案一致的不要重复；
- evidence 必须逐字摘抄正文原句（15~60 字），不能改写或概括，否则该条会被丢弃；
- newCharacters 只放本章新登场、后续可能重要的人物，路人不要；已在档案中的人物不要重复添加；
- importance=major 只用于影响主线的伏笔；
- 没有的项输出空数组。只输出 JSON。`,
    },
  ];
}

export function arcSummaryPrompt(n: Novel, arc: Arc, chapters: Chapter[]): Msg[] {
  return [
    { role: "system", content: "你是小说编辑助理，擅长提炼长篇剧情脉络。" },
    {
      role: "user",
      content: `# 《${n.title}》第 ${arc.range[0]}~${arc.range[1]} 章的章节摘要
${chapters.map((c) => `- 第${c.index}章《${c.title}》：${c.summary}`).join("\n")}

# 任务：生成分段剧情摘要
把这一段剧情浓缩为 400~800 字的摘要，按时间顺序，写清：
- 主线推进了什么，关键事件和结果；
- 主角的实力/处境/重要得失；
- 人物关系的重要变化，新登场的重要人物；
- 本段结束时仍在进行的冲突和悬念。
这份摘要会在之后写作时代替这些章节的细节，请保留对后续剧情有影响的事实。直接输出正文，不要标题。`,
    },
  ];
}

export function synopsisPrompt(n: Novel, arcs: Arc[]): Msg[] {
  return [
    { role: "system", content: "你是小说编辑助理，擅长提炼长篇剧情脉络。" },
    {
      role: "user",
      content: `# 现有全书梗概（覆盖到第 ${n.memory.synopsisUpTo} 章）
${n.memory.bookSynopsis || "（无）"}

# 新增的分段剧情
${arcs.map((a) => `## 第 ${a.range[0]}~${a.range[1]} 章\n${a.summary}`).join("\n\n")}

# 任务：更新全书梗概
把新增的分段剧情融入全书梗概，输出一份新的、按时间顺序的完整梗概：
- 总长度控制在 2000 字以内，越早的剧情越概括；
- 保留对后续剧情有影响的关键事实：主角成长轨迹、重要得失、人物关系、仍在进行的冲突和目标；
- 直接输出正文，不要标题和说明。`,
    },
  ];
}
