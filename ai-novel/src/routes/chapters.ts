/**
 * 章节：读取、手动编辑、删除、历史版本、生产留档。
 */
import { z } from "zod";
import type { Novel } from "../model/types.js";
import { revertChapter } from "../state/events.js";
import { withSyncedArcs } from "../state/arcs.js";
import { markDownstreamStale, requestDigest } from "../state/stale.js";
import { store } from "../store/index.js";
import { countWords } from "../util/text.js";
import { HttpError, ensureIdle, getNovel, novelView, parseBody, type Route } from "./http.js";

const ChapterPatchSchema = z.object({
  title: z.string().optional(),
  outline: z.string().optional(),
  summary: z.string().optional(),
  characters: z.array(z.string()).optional(),
  text: z.string().optional(),
});

/** 正文被人工改变（编辑/恢复版本）后：更新章节信息，提示重新整理记忆和复查后续章节 */
function afterManualText(x: Novel, index: number, text: string, reason: string): Novel {
  const has = Boolean(text.trim());
  const chapters = x.chapters.map((c) =>
    c.index === index
      ? { ...c, words: countWords(text), status: has ? ("written" as const) : ("planned" as const), updatedAt: Date.now(), review: undefined, stale: undefined }
      : c,
  );
  // 清空正文 = 这一章不存在了，撤销它的记忆；否则提醒重新整理
  const base = has ? requestDigest({ ...x, chapters }, index, reason) : revertChapter({ ...x, chapters }, index);
  return markDownstreamStale(withSyncedArcs(base), index, reason);
}

export const chapterRoutes: Route[] = [
  [
    "GET",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)$/,
    async ({ params }) => {
      const n = await getNovel(params[0]);
      const index = Number(params[1]);
      const chapter = n.chapters.find((c) => c.index === index);
      if (!chapter) throw new HttpError(404, "章节不存在");
      return { chapter, text: await store.readChapter(n.id, index), total: n.chapters.length };
    },
  ],

  [
    "PUT",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)$/,
    async ({ req, params }) => {
      const [id, index] = [params[0], Number(params[1])];
      await getNovel(id);
      const b = await parseBody(req, ChapterPatchSchema);
      if (b.text !== undefined) ensureIdle(id);
      // 正文读写放在锁内，避免并发保存时丢失修改或历史版本错位
      const n = await store.update(id, async (x) => {
        const old = await store.readChapter(id, index);
        const textChanged = b.text !== undefined && b.text !== old;
        if (textChanged) await store.writeChapter(id, index, b.text!, "手动编辑");
        const exists = x.chapters.some((c) => c.index === index);
        const base = exists
          ? x.chapters
          : [...x.chapters, { index, title: "", outline: "", characters: [], status: "planned" as const, summary: "", words: 0 }].sort(
              (a, c) => a.index - c.index,
            );
        const chapters = base.map((c) =>
          c.index === index
            ? {
                ...c,
                title: b.title ?? c.title,
                outline: b.outline ?? c.outline,
                summary: b.summary ?? c.summary,
                characters: b.characters ?? c.characters,
              }
            : c,
        );
        const next = withSyncedArcs({ ...x, chapters });
        return textChanged ? afterManualText(next, index, b.text!, "手动编辑") : next;
      });
      return novelView(n);
    },
  ],

  [
    "DELETE",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)$/,
    async ({ params }) => {
      const [id, index] = [params[0], Number(params[1])];
      await getNovel(id);
      ensureIdle(id);
      await store.deleteChapterText(id, index);
      const n = await store.update(id, (x) => {
        const stale = markDownstreamStale(revertChapter(x, index), index, "被删除");
        return withSyncedArcs({ ...stale, chapters: stale.chapters.filter((c) => c.index !== index) });
      });
      return novelView(n);
    },
  ],

  // ---------------- 历史版本 ----------------
  [
    "GET",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)\/versions$/,
    async ({ params }) => {
      await getNovel(params[0]);
      return store.listVersions(params[0], Number(params[1]));
    },
  ],

  [
    "GET",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)\/versions\/([^/]+)$/,
    async ({ params }) => {
      await getNovel(params[0]);
      return { text: await store.readVersion(params[0], Number(params[1]), decodeURIComponent(params[2])) };
    },
  ],

  [
    "POST",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)\/versions\/([^/]+)\/restore$/,
    async ({ params }) => {
      const [id, index] = [params[0], Number(params[1])];
      await getNovel(id);
      ensureIdle(id);
      const text = await store.readVersion(id, index, decodeURIComponent(params[2]));
      const n = await store.update(id, async (x) => {
        await store.writeChapter(id, index, text, "恢复历史版本前");
        return afterManualText(x, index, text, "恢复历史版本");
      });
      return novelView(n);
    },
  ],

  // ---------------- 生产留档 ----------------
  [
    "GET",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)\/runs$/,
    async ({ params }) => {
      await getNovel(params[0]);
      return store.listRuns(params[0], Number(params[1]));
    },
  ],

  [
    "GET",
    /^\/api\/novels\/(\w+)\/chapters\/(\d+)\/runs\/([\w-]+)$/,
    async ({ params }) => {
      await getNovel(params[0]);
      const data = await store.readRun(params[0], Number(params[1]), params[2]);
      if (data === null) throw new HttpError(404, "没有这份留档");
      return data;
    },
  ],
];
