import { test } from "node:test";
import assert from "node:assert/strict";
import { arcRangeFor, syncArcs, arcOf, arcsAwaitingSummary } from "../src/state/arcs.js";
import type { Arc, Chapter } from "../src/model/types.js";

const ch = (index: number, status: Chapter["status"] = "written"): Chapter => ({
  index,
  title: `第${index}章`,
  outline: "",
  characters: [],
  status,
  summary: `摘要${index}`,
  words: 100,
});

test("arcRangeFor 按固定章数切分，并受总章数限制", () => {
  assert.deepEqual(arcRangeFor(1, 10, 100), [1, 10]);
  assert.deepEqual(arcRangeFor(10, 10, 100), [1, 10]);
  assert.deepEqual(arcRangeFor(11, 10, 100), [11, 20]);
  assert.deepEqual(arcRangeFor(93, 10, 95), [91, 95]);
});

test("syncArcs 为所有章节补齐弧并计算状态", () => {
  const chapters = [...Array.from({ length: 10 }, (_, i) => ch(i + 1)), ch(11), ch(12, "planned")];
  const arcs = syncArcs([], chapters, 10, 100);
  assert.equal(arcs.length, 2);
  assert.equal(arcs[0].status, "done");
  assert.equal(arcs[1].status, "writing");
  assert.deepEqual(arcs[1].range, [11, 20]);
});

test("syncArcs 保留已有弧的 id、标题和摘要", () => {
  const existing: Arc[] = [{ id: "x", index: 1, title: "序章", range: [1, 10], summary: "冻结摘要", status: "done" }];
  const arcs = syncArcs(existing, [ch(1)], 10, 100);
  assert.equal(arcs[0].id, "x");
  assert.equal(arcs[0].title, "序章");
  assert.equal(arcs[0].summary, "冻结摘要");
  assert.equal(arcs[0].status, "writing");
});

test("syncArcs 未写章节的弧为 planned，不修改入参", () => {
  const existing: Arc[] = [];
  const arcs = syncArcs(existing, [ch(1, "planned")], 10, 100);
  assert.equal(arcs[0].status, "planned");
  assert.equal(existing.length, 0);
});

test("arcOf 找到章节所在的弧", () => {
  const arcs = syncArcs([], [ch(1), ch(15)], 10, 100);
  assert.equal(arcOf(arcs, 15)?.index, 2);
  assert.equal(arcOf(arcs, 25), undefined);
});

test("arcsAwaitingSummary：已完成、未被梗概覆盖、还没有摘要的弧", () => {
  const chapters = Array.from({ length: 30 }, (_, i) => ch(i + 1));
  const arcs = syncArcs([], chapters, 10, 100).map((a) => (a.index === 2 ? { ...a, summary: "已有" } : a));
  const pending = arcsAwaitingSummary(arcs, 10);
  assert.deepEqual(
    pending.map((a) => a.index),
    [3],
  );
});

test("firstUnwritten：返回第一个未写的章节，中间有空章不会被跳过", async () => {
  const { firstUnwritten } = await import("../src/state/arcs.js");
  assert.equal(firstUnwritten([ch(1), ch(2, "planned"), ch(3)], 100), 2);
  assert.equal(firstUnwritten([ch(1), ch(3)], 100), 2);
  assert.equal(firstUnwritten([], 100), 1);
  assert.equal(firstUnwritten([ch(1), ch(2)], 2), 3);
});
