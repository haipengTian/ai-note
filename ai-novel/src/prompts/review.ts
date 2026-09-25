/**
 * 审校与按审校意见修订的提示词。
 */
import type { Msg } from "../llm.js";
import type { Chapter, Novel, ReviewIssue } from "../model/types.js";
import { WRITER_SYSTEM } from "./write.js";

const REVIEWER_SYSTEM =
  "你是一位严格的网文主编，负责在章节发布前审稿。你只指出真实存在、影响阅读体验的问题，每个问题必须逐字引用原文作为证据，不吹毛求疵，也不为了凑数编造问题。";

export interface LocalCheck {
  hits: { phrase: string; count: number }[];
  summaryEnding: boolean;
  density: number;
}

export function reviewPrompt(contextText: string, c: Chapter, text: string, local: LocalCheck): Msg[] {
  return [
    { role: "system", content: REVIEWER_SYSTEM },
    {
      role: "user",
      content: `${contextText}

# 规则检测结果（供参考）
- 套话：${local.hits.length ? local.hits.map((h) => `${h.phrase}×${h.count}`).join("、") : "无"}（每千字 ${local.density} 处）
- 结尾疑似总结升华：${local.summaryEnding ? "是" : "否"}

# 待审正文：第 ${c.index} 章《${c.title}》
${text}

# 任务：章节审校
请对照上面的设定、人物当前状态（写作本章前）、最近剧情和本章大纲，从以下维度审稿：
1. 设定一致性：是否违反世界观、力量体系规则
2. 人物逻辑：言行是否符合人设和当前状态（实力、伤势、位置、持有物品、知道的秘密、关系、生死）
3. 大纲执行：大纲要点是否都写到；是否擅自写了后面章节的内容
4. 衔接：与上一章结尾、最近剧情是否连贯
5. 节奏爽点：是否拖沓、注水；冲突和爽点是否有铺垫和释放
6. 章末钩子：结尾是否有悬念/期待感
7. AI 腔：套话、空洞抒情、总结升华、说教
8. 对话：是否有区分度、是否推动剧情

评分标准：90+ 可直接发布；80~89 小瑕疵；60~79 有明显问题需要修改；60 以下需重写。
存在任何 high 级问题时 verdict 必须为 "revise"。

只输出 JSON：
{"score": 85, "verdict": "pass 或 revise", "issues": [{"dimension":"维度名","severity":"high|medium|low","quote":"逐字引用原文（20~60字）","problem":"问题是什么","suggestion":"具体怎么改"}], "strengths": ["本章做得好的地方，1~3 条"]}
问题按严重程度排序，最多 8 条。`,
    },
  ];
}

export function revisePrompt(
  contextText: string,
  n: Novel,
  c: Chapter,
  text: string,
  issues: ReviewIssue[],
  aiPhrases: { phrase: string; count: number }[],
): Msg[] {
  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content: `${contextText}

# 原文：第 ${c.index} 章《${c.title}》
${text}

# 主编审稿意见（逐条修改）
${issues.map((i, k) => `${k + 1}. [${i.severity}][${i.dimension}] 原文「${i.quote}」\n   问题：${i.problem}\n   建议：${i.suggestion}`).join("\n")}
${aiPhrases.length ? `\n# 需要替换或删除的套话\n${aiPhrases.map((h) => `「${h.phrase}」出现 ${h.count} 次`).join("、")}，改成具体的动作、神态或直接删掉。\n` : ""}
# 任务：按审稿意见修订章节
- 针对以上问题做修改，没有问题的段落尽量保留原文，不要整体重写风格；
- 不改变本章的核心情节和结局走向，篇幅保持约 ${n.wordsPerChapter} 字；
- 输出修订后的完整章节正文，不要任何说明。`,
    },
  ];
}
