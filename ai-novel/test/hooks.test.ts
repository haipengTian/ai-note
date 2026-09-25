import { test } from "node:test";
import assert from "node:assert/strict";
import { recomputeHook, relevantHooks, applyHookOp, newHookId } from "../src/state/hooks.js";
import type { Hook } from "../src/model/types.js";

const hook = (over: Partial<Hook>): Hook => ({
  id: "h",
  type: "foreshadow",
  content: "伏笔",
  importance: "minor",
  status: "open",
  plantedIn: 1,
  history: [{ chapter: over.plantedIn ?? 1, op: "plant", note: "" }],
  source: "ai",
  ...over,
});

test("recomputeHook 根据历史推导状态", () => {
  const h = recomputeHook(
    hook({
      history: [
        { chapter: 1, op: "plant", note: "" },
        { chapter: 5, op: "advance", note: "" },
        { chapter: 9, op: "advance", note: "" },
      ],
    }),
  );
  assert.equal(h.status, "progressing");
  assert.equal(h.lastAdvancedIn, 9);
  assert.equal(h.resolvedIn, undefined);
  const r = recomputeHook({ ...h, history: [...h.history, { chapter: 12, op: "resolve", note: "" }] });
  assert.equal(r.status, "resolved");
  assert.equal(r.resolvedIn, 12);
});

test("recomputeHook 保留人工设置的搁置/放弃状态，除非已回收", () => {
  assert.equal(recomputeHook(hook({ status: "deferred" })).status, "deferred");
  assert.equal(recomputeHook(hook({ status: "abandoned" })).status, "abandoned");
  const resolved = hook({ status: "deferred", history: [{ chapter: 1, op: "plant", note: "" }, { chapter: 3, op: "resolve", note: "" }] });
  assert.equal(recomputeHook(resolved).status, "resolved");
});

test("relevantHooks：major 永远注入，早期 minor 过期后不再注入", () => {
  const hooks = [
    hook({ id: "major-old", importance: "major", plantedIn: 1 }),
    hook({ id: "minor-old", plantedIn: 1 }),
    hook({ id: "minor-new", plantedIn: 90 }),
    hook({ id: "done", importance: "major", status: "resolved", plantedIn: 2 }),
    hook({ id: "later", importance: "major", plantedIn: 120 }),
  ];
  const ids = relevantHooks(hooks, 100).map((r) => r.hook.id);
  assert.deepEqual(ids.sort(), ["major-old", "minor-new"]);
});

test("relevantHooks：回收窗口内或已超期的 minor 也注入，并标记超期", () => {
  const hooks = [hook({ id: "due", plantedIn: 1, payoffWindow: [95, 105] }), hook({ id: "overdue", plantedIn: 1, payoffWindow: [20, 30] })];
  const r = relevantHooks(hooks, 100);
  assert.deepEqual(r.map((x) => x.hook.id).sort(), ["due", "overdue"]);
  assert.equal(r.find((x) => x.hook.id === "overdue")!.overdue, true);
  assert.equal(r.find((x) => x.hook.id === "due")!.overdue, false);
});

test("relevantHooks：minor 数量有上限，保留最近推进的", () => {
  const hooks = Array.from({ length: 20 }, (_, i) => hook({ id: `m${i}`, plantedIn: 80 + i }));
  const r = relevantHooks(hooks, 100, { maxMinor: 5 });
  assert.deepEqual(
    r.map((x) => x.hook.id),
    ["m19", "m18", "m17", "m16", "m15"],
  );
});

test("applyHookOp：埋设、推进、回收，不修改入参", () => {
  const planted = applyHookOp([], { op: "plant", content: "神秘玉佩", type: "mystery", importance: "major", note: "" }, 3, "ai");
  assert.equal(planted.length, 1);
  assert.equal(planted[0].plantedIn, 3);
  assert.equal(planted[0].importance, "major");
  const id = planted[0].id;
  const advanced = applyHookOp(planted, { op: "advance", id, note: "玉佩发光" }, 5, "ai");
  assert.equal(advanced[0].status, "progressing");
  assert.equal(planted[0].status, "open");
  const resolved = applyHookOp(advanced, { op: "resolve", id, note: "" }, 8, "ai");
  assert.equal(resolved[0].status, "resolved");
  assert.equal(resolved[0].resolvedIn, 8);
});

test("applyHookOp：id 不存在时忽略推进/回收", () => {
  const hooks = [hook({ id: "a" })];
  assert.deepEqual(applyHookOp(hooks, { op: "resolve", id: "zzz", note: "" }, 5, "ai"), hooks);
});

test("newHookId 生成 8 位且不与现有冲突", () => {
  const id = newHookId(new Set());
  assert.match(id, /^[a-f0-9]{8}$/);
});
