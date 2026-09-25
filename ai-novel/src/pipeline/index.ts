/**
 * 创作流水线：
 *   设定 → 人物 → 总纲 → 章节大纲 → 正文 → 审校修订 → 章后记忆（结构化状态变化 / 伏笔 / 分层摘要）
 *
 * 长篇一致性的关键：写每一章时不塞前文全文，而是由上下文编排器注入
 *   「设定 + 相关人物设定与当前状态 + 全书梗概 + 分段摘要 + 近期章摘要 + 相关伏笔 + 上一章正文 + 本章大纲」，
 * 人物状态由「初始状态 + 按章的状态事件」推导，任何一章都能还原当时的状态。
 */
export { genWorldview, genCharacters, genOutline, bootstrap } from "./setup.js";
export { planChapters, PLAN_BATCH } from "./plan.js";
export { writeChapter, rewriteChapter } from "./write.js";
export { reviewChapter, reviseChapter } from "./review.js";
export { digestChapter, summarizeArcs } from "./memory.js";
export { autoWrite, blockingItems } from "./auto.js";
