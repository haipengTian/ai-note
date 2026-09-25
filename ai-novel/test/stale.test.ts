import { test } from "node:test";
import assert from "node:assert/strict";
import { markDownstreamStale } from "../src/state/stale.js";
import { emptyMemory, DEFAULT_SETTINGS, type Chapter, type Novel } from "../src/model/types.js";

const ch = (index: number, status: Chapter["status"] = "written"): Chapter => ({ index, title: "", outline: "", characters: [], status, summary: "", words: 0 });

function novel(chapters: Chapter[], inbox: Novel["inbox"] = []): Novel {
  return {
    schemaVersion: 2, id: "abcdefabcdef", title: "", genre: "", idea: "", style: "", targetChapters: 100, wordsPerChapter: 3000,
    worldview: "", outline: "", characters: [], arcs: [], chapters, memory: emptyMemory(), inbox, settings: DEFAULT_SETTINGS, createdAt: 0, updatedAt: 0,
  };
}

test("markDownstreamStale：标记后续已写章节并生成非阻塞待办", () => {
  const n = markDownstreamStale(novel([ch(1), ch(2), ch(3), ch(4, "planned")]), 1, "重写");
  assert.equal(n.chapters[0].stale, undefined);
  assert.match(n.chapters[1].stale!, /第 1 章重写/);
  assert.ok(n.chapters[2].stale);
  assert.equal(n.chapters[3].stale, undefined);
  assert.equal(n.inbox.length, 1);
  assert.equal(n.inbox[0].kind, "stale_chapter");
  assert.equal(n.inbox[0].blocking, false);
});

test("markDownstreamStale：没有后续章节时不变；同一章的旧提醒被替换", () => {
  const base = novel([ch(1), ch(2)]);
  assert.equal(markDownstreamStale(base, 2, "重写"), base);
  const once = markDownstreamStale(base, 1, "重写");
  const twice = markDownstreamStale(once, 1, "手动编辑");
  assert.equal(twice.inbox.filter((i) => i.status === "open").length, 1);
  assert.match(twice.inbox[0].title, /手动编辑/);
});

test("requestDigest：生成非阻塞的“重新整理记忆”待办，同一章只保留一条", async () => {
  const { requestDigest } = await import("../src/state/stale.js");
  const once = requestDigest(novel([ch(1)]), 1, "手动编辑");
  const twice = requestDigest(once, 1, "恢复历史版本");
  const open = twice.inbox.filter((i) => i.status === "open");
  assert.equal(open.length, 1);
  assert.equal(open[0].kind, "needs_digest");
  assert.equal(open[0].blocking, false);
  assert.match(open[0].title, /恢复历史版本/);
});
