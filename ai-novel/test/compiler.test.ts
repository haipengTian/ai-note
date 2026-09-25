import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, type ContextBlock } from "../src/context/compiler.js";

const block = (id: string, over: Partial<ContextBlock> = {}): ContextBlock => ({
  id,
  title: `# ${id}`,
  text: "x".repeat(100),
  tier: "optional",
  stability: 0.5,
  priority: 50,
  ...over,
});

test("按稳定度从高到低排列，稳定度相同保持原顺序", () => {
  const r = compile([block("task", { stability: 0 }), block("rules", { stability: 1 }), block("a"), block("b")], 10_000);
  assert.deepEqual(
    r.trace.map((t) => t.id),
    ["rules", "a", "b", "task"],
  );
  assert.ok(r.text.startsWith("# rules\n"));
  assert.equal(r.overBudget, false);
});

test("跳过空内容的块", () => {
  const r = compile([block("a"), block("empty", { text: "  " })], 10_000);
  assert.deepEqual(
    r.trace.map((t) => t.id),
    ["a"],
  );
});

test("超预算时先用缩略版，再按优先级从低到高丢弃，protected 不动", () => {
  const blocks = [
    block("keep", { tier: "protected", priority: 0 }),
    block("prev", { tier: "compressible", priority: 60, fallback: "y".repeat(20) }),
    block("lore-low", { priority: 10 }),
    block("lore-high", { priority: 40 }),
  ];
  const full = compile(blocks, 10_000).chars;
  const r = compile(blocks, full - 90);
  const status = Object.fromEntries(r.trace.map((t) => [t.id, t.status]));
  assert.equal(status["lore-low"], "dropped");
  assert.equal(status["lore-high"], "full");
  assert.equal(status["keep"], "full");
  assert.ok(r.chars <= full - 90);
  assert.ok(!r.text.includes("# lore-low"));
});

test("compressible 块在丢弃前先退化为缩略版", () => {
  const blocks = [block("keep", { tier: "protected" }), block("prev", { tier: "compressible", priority: 5, fallback: "short" })];
  const r = compile(blocks, 150);
  const prev = r.trace.find((t) => t.id === "prev")!;
  assert.equal(prev.status, "fallback");
  assert.ok(r.text.includes("short"));
});

test("只剩 protected 仍超预算时标记 overBudget", () => {
  const r = compile([block("a", { tier: "protected", text: "z".repeat(500) })], 100);
  assert.equal(r.overBudget, true);
  assert.equal(r.trace[0].status, "full");
});
