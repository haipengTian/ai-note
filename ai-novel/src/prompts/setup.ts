/**
 * 设定层提示词：世界观、人物、总纲。
 */
import type { Msg } from "../llm.js";
import type { Character, Novel } from "../model/types.js";
import { clip } from "../util/text.js";
import { DEFAULT_STATE_KEYS, NOVELIST, novelHeader } from "./shared.js";

const extraBlock = (extra: string) => (extra ? `\n# 作者的额外要求\n${extra}\n` : "");

function castBlock(chars: Character[]) {
  if (!chars.length) return "（暂无）";
  return chars
    .map((c) => {
      const attrs = Object.entries(c.initial.attrs).map(([k, v]) => `${k}：${v}`).join("；");
      return `## ${c.name}（${c.role}）\n${c.profile}${attrs ? `\n初始状态：${attrs}` : ""}`;
    })
    .join("\n\n");
}

export function worldviewPrompt(n: Novel, extra: string): Msg[] {
  return [
    { role: "system", content: NOVELIST },
    {
      role: "user",
      content: `# 任务：设计世界观设定

# 作品信息
${novelHeader(n)}
${n.worldview ? `\n# 现有设定（在此基础上修改完善）\n${n.worldview}\n` : ""}${extraBlock(extra)}
请围绕核心灵感，设计一份能支撑 ${n.targetChapters} 章长篇连载的设定，要求新颖、有记忆点、利于持续产出爽点。用 Markdown 输出，包含以下小节：

## 一句话卖点
## 世界背景
## 力量体系 / 能力规则（等级划分、升级方式、限制与代价；现实题材可写职业/社会规则）
## 主要势力与地图
## 主角的金手指 / 核心优势（及其限制，避免无敌无聊）
## 核心矛盾与主线目标
## 基调与爽点设计（本书主打哪几类爽点）

直接输出设定正文，不要开场白。`,
    },
  ];
}

export function charactersPrompt(n: Novel, extra: string): Msg[] {
  return [
    { role: "system", content: NOVELIST },
    {
      role: "user",
      content: `# 任务：设计人物

# 作品信息
${novelHeader(n)}

# 世界观设定
${clip(n.worldview, 6000)}
${n.characters.length ? `\n# 已有人物（保留并完善，可补充新人物）\n${castBlock(n.characters)}\n` : ""}${extraBlock(extra)}
请设计 6~10 个核心人物：主角 1 名，以及女主/重要伙伴、导师、宿敌/反派、有记忆点的配角等。要求：
- 每个人物有清晰的欲望和动机、鲜明的性格标签和说话方式、与主角的关系张力；
- 主角要有成长空间和缺点；反派不能降智，有自己的逻辑；
- profile 用 150~300 字写清：身份、外貌特征、性格、说话方式、背景经历、目标、能力、与其他人物的关系；
- attrs 写故事开始时的状态，用键值对，常用键：${DEFAULT_STATE_KEYS.join("、")}（按题材取舍，可以增加）；
- aliases 写别称、称号、常被叫的称呼（没有就给空数组）。

只输出 JSON，格式：
{"characters":[{"name":"姓名","aliases":["别称"],"role":"主角|女主|伙伴|导师|反派|配角","profile":"……","attrs":{"境界/实力":"……","所在地":"……"}}]}`,
    },
  ];
}

export function outlinePrompt(n: Novel, extra: string): Msg[] {
  const volumes = Math.max(1, Math.round(n.targetChapters / 40));
  return [
    { role: "system", content: NOVELIST },
    {
      role: "user",
      content: `# 任务：设计全书总纲

# 作品信息
${novelHeader(n)}

# 世界观设定
${clip(n.worldview, 6000)}

# 人物
${castBlock(n.characters)}
${n.outline ? `\n# 现有总纲（在此基础上修改）\n${n.outline}\n` : ""}${extraBlock(extra)}
请把全书约 ${n.targetChapters} 章规划为约 ${volumes} 卷，用 Markdown 输出：

先写「## 主线概述」（200 字内：主角从哪里出发、最终要达成什么、核心悬念）。
然后每卷一个小节：
### 第X卷 卷名（第 a-b 章）
- 本卷目标：主角在这一卷要解决的问题
- 主要事件：按顺序 4~8 条关键剧情
- 高潮：本卷最大的爽点/对决
- 人物变化：新登场人物、关系变化、主角成长
- 结尾走向：如何引出下一卷

最后写「## 结局方向」和「## 长线伏笔」（贯穿全书、后期回收的 3~5 个伏笔）。
要求节奏张弛有度，每卷都有新地图/新目标/新对手，避免重复套路。直接输出，不要开场白。`,
    },
  ];
}
