/**
 * 剧情弧。P0 阶段按固定章数切分（settings.arcSize），P1 起由弧规划决定范围。
 * 弧完成后生成摘要并冻结，作为分层记忆的中间层。
 */
import type { Arc, Chapter } from "../model/types.js";

export function arcRangeFor(index: number, arcSize: number, maxChapter: number): [number, number] {
  const k = Math.ceil(index / arcSize);
  const from = (k - 1) * arcSize + 1;
  return [from, Math.max(from, Math.min(k * arcSize, maxChapter))];
}

function statusOf(range: [number, number], chapters: Chapter[]): Arc["status"] {
  const inRange = chapters.filter((c) => c.index >= range[0] && c.index <= range[1]);
  const written = new Set(inRange.filter((c) => c.status === "written").map((c) => c.index));
  if (!written.size) return "planned";
  for (let i = range[0]; i <= range[1]; i++) if (!written.has(i)) return "writing";
  return "done";
}

/** 保证每个章节都属于某个弧，并按章节状态重新计算弧状态。返回新数组。 */
export function syncArcs(arcs: Arc[], chapters: Chapter[], arcSize: number, maxChapter: number): Arc[] {
  const byIndex = new Map(arcs.map((a) => [a.index, a]));
  for (const c of chapters) {
    const k = Math.ceil(c.index / arcSize);
    if (byIndex.has(k)) continue;
    const range = arcRangeFor(c.index, arcSize, Math.max(maxChapter, c.index));
    byIndex.set(k, { id: `a${k}`, index: k, title: `第 ${k} 段`, range, status: "planned" });
  }
  return [...byIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map((a) => ({ ...a, status: statusOf(a.range, chapters) }));
}

export function arcOf(arcs: Arc[], chapter: number): Arc | undefined {
  return arcs.find((a) => chapter >= a.range[0] && chapter <= a.range[1]);
}

/** 需要生成冻结摘要的弧：已完成、没有摘要、且不在全书梗概覆盖范围内 */
export function arcsAwaitingSummary(arcs: Arc[], synopsisUpTo: number): Arc[] {
  return arcs.filter((a) => a.status === "done" && !a.summary && a.range[1] > synopsisUpTo);
}

/** 第一个还没写的章节（1 起，中间的空章不会被跳过）；全部写完时返回 maxChapter + 1 */
export function firstUnwritten(chapters: Chapter[], maxChapter: number): number {
  const written = new Set(chapters.filter((c) => c.status === "written").map((c) => c.index));
  for (let i = 1; i <= maxChapter; i++) if (!written.has(i)) return i;
  return maxChapter + 1;
}

/** 按当前章节重新同步作品的剧情弧 */
export function withSyncedArcs<T extends { arcs: Arc[]; chapters: Chapter[]; targetChapters: number; settings: { arcSize: number } }>(n: T): T {
  return { ...n, arcs: syncArcs(n.arcs, n.chapters, n.settings.arcSize, n.targetChapters) };
}
