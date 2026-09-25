/**
 * 审校与按意见修订。
 */
import { config } from "../config.js";
import { chat, chatJSON } from "../llm.js";
import { ReviewSchema } from "../model/schemas.js";
import type { Review, ReviewIssue } from "../model/types.js";
import * as P from "../prompts/review.js";
import { detectAiPhrases } from "../analysis/ai-patterns.js";
import { store } from "../store/index.js";
import { cleanChapterText, countWords } from "../util/text.js";
import type { Job } from "../jobs.js";
import { chapterContext, saveContextRun } from "./context.js";

/** 修订稿字数低于原稿这个比例时判定为不完整，保留原稿 */
const MIN_REVISE_RATIO = 0.5;

export function needsRevision(r: Review, threshold: number) {
  return r.verdict === "revise" || r.score < threshold || r.issues.some((i) => i.severity === "high");
}

export async function reviewChapter(id: string, index: number, job: Job, autoRevise = false) {
  const n = await store.get(id);
  const c = n.chapters.find((x) => x.index === index);
  const text = await store.readChapter(id, index);
  if (!c || !text) throw new Error(`第 ${index} 章还没有正文`);
  const local = detectAiPhrases(text);
  const compiled = await chapterContext(n, index);
  const messages = P.reviewPrompt(compiled.text, c, text, local);
  await saveContextRun(n, index, "review", compiled, messages, job);

  job.log(`审校第 ${index} 章`);
  const raw = await chatJSON(messages, ReviewSchema, {
    model: config.modelReview,
    temperature: 0.3,
    onText: job.stream(`review:${index}`, `第 ${index} 章审校`),
    signal: job.signal,
  });
  if (job.signal.aborted) return;
  const issues: ReviewIssue[] = [...raw.issues];
  if (local.summaryEnding && !issues.some((i) => /结尾|升华|总结/.test(i.problem)))
    issues.push({
      dimension: "AI腔",
      severity: "low",
      quote: text.trim().split(/\n+/).at(-1)!.slice(0, 60),
      problem: "结尾疑似总结升华/展望未来",
      suggestion: "删掉总结句，用动作、对话或悬念收尾",
    });
  const review: Review = {
    score: Math.max(0, Math.min(100, Math.round(raw.score))),
    verdict: raw.verdict,
    issues,
    strengths: raw.strengths,
    aiPhrases: local.hits,
    revised: false,
    at: Date.now(),
  };
  await store.update(id, (x) => ({ ...x, chapters: x.chapters.map((ch) => (ch.index === index ? { ...ch, review } : ch)) }));
  await store.writeRun(id, index, "review", review);
  const high = issues.filter((i) => i.severity === "high").length;
  const bad = needsRevision(review, n.settings.reviewThreshold);
  job.log(`审校结果：${review.score} 分，${issues.length} 个问题${high ? `（${high} 个严重）` : ""}`, bad ? "warn" : "info");
  job.updated();

  if (autoRevise && bad && !job.signal.aborted) {
    job.log(`低于 ${n.settings.reviewThreshold} 分或有严重问题，自动修订一次`);
    await reviseChapter(id, index, job);
  }
}

export async function reviseChapter(id: string, index: number, job: Job) {
  const n = await store.get(id);
  const c = n.chapters.find((x) => x.index === index);
  const text = await store.readChapter(id, index);
  if (!c || !text) throw new Error(`第 ${index} 章还没有正文`);
  if (!c.review) throw new Error("请先审校本章");
  const review = c.review;
  const serious = review.issues.filter((i) => i.severity !== "low");
  const issues = serious.length ? serious : review.issues;
  const phrases = review.aiPhrases.filter((h) => h.count >= 2 || review.aiPhrases.length <= 3);
  if (!issues.length && !phrases.length) {
    job.log("审校没有发现需要修订的问题");
    return;
  }
  job.log(`按审校意见修订第 ${index} 章（${issues.length} 条意见）`);
  const compiled = await chapterContext(n, index);
  const messages = P.revisePrompt(compiled.text, n, c, text, issues, phrases);
  await saveContextRun(n, index, "revise", compiled, messages, job);
  const revised = cleanChapterText(
    await chat(messages, { onText: job.stream(`chapter:${index}`, `修订第 ${index} 章`), signal: job.signal }),
    c.title,
  );
  if (job.signal.aborted) return;
  if (countWords(revised) < countWords(text) * MIN_REVISE_RATIO) {
    job.log(`修订稿只有 ${countWords(revised)} 字，明显不完整，保留原稿`, "warn");
    return;
  }
  await store.writeChapter(id, index, revised, "审校修订");
  await store.update(id, (x) => ({
    ...x,
    chapters: x.chapters.map((ch) =>
      ch.index === index
        ? { ...ch, words: countWords(revised), updatedAt: Date.now(), review: ch.review ? { ...ch.review, revised: true } : undefined }
        : ch,
    ),
  }));
  job.log(`修订完成，${countWords(text)} → ${countWords(revised)} 字（原稿已存入历史版本）`);
  job.updated();
}
