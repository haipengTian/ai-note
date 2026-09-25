/** 文本工具：字数统计、截断、清理模型输出的章节正文 */

/** 中文字数：统计非空白字符 */
export function countWords(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 超长截断，标注省略 */
export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "……（略）" : s;
}

/** 去掉模型常加的代码块、标题行、“本章完”等 */
export function cleanChapterText(text: string, title: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\n?|```$/g, "").trim();
  const first = t.split("\n")[0];
  if (/^#*\s*第.{1,8}章/.test(first) || (title && first.replace(/[#\s《》]/g, "") === title.replace(/\s/g, ""))) {
    t = t.slice(first.length).trim();
  }
  return t.replace(/\n*[（(]?本章完[)）]?\s*$/, "").trim();
}

/** 按空行/换行切段（保留非空段） */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
