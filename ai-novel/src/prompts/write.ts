/**
 * 正文写作、续写、按要求修改的提示词。
 * contextText 由 context/compiler 编排好（稳定内容在前），任务说明放在最后，保证前缀缓存命中。
 */
import type { Msg } from "../llm.js";
import type { Chapter, Novel } from "../model/types.js";
import { countWords } from "../util/text.js";
import { NOVELIST, WRITING_RULES } from "./shared.js";

export const WRITER_SYSTEM = `${NOVELIST}\n\n${WRITING_RULES}`;

export function writeChapterPrompt(contextText: string, n: Novel, c: Chapter, extra = ""): Msg[] {
  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content: `${contextText}
${extra ? `\n# 作者对本章的额外要求\n${extra}\n` : ""}
# 任务：撰写第 ${c.index} 章《${c.title}》正文
请写出本章完整正文，约 ${n.wordsPerChapter} 字。只输出正文，不要章节标题、不要任何说明或总结。`,
    },
  ];
}

export function continueChapterPrompt(n: Novel, c: Chapter, written: string): Msg[] {
  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content: `第 ${c.index} 章《${c.title}》的大纲：
${c.outline}

目前已写约 ${countWords(written)} 字，目标约 ${n.wordsPerChapter} 字。已写部分的结尾：
……${written.slice(-1500)}

# 任务：续写未完成的章节
请紧接着上文继续写，把本章大纲里尚未写到的情节写完，并以钩子收尾。只输出续写的正文，不要重复已写内容。`,
    },
  ];
}

export function rewritePrompt(contextText: string, n: Novel, c: Chapter, text: string, instruction: string): Msg[] {
  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content: `${contextText}

# 原文
${text}

# 修改要求
${instruction}

# 任务：按要求修改第 ${c.index} 章
请输出修改后的完整章节正文（保持约 ${n.wordsPerChapter} 字，除非要求改变篇幅），仍需遵守人物当前状态和设定。只输出正文。`,
    },
  ];
}
