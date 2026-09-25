import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAiPhrases } from "../src/analysis/ai-patterns.js";

test("detectAiPhrases 统计套话并按次数排序", () => {
  const r = detectAiPhrases("他不禁笑了。她不禁愣住。空气仿佛凝固了。");
  assert.deepEqual(r.hits[0], { phrase: "不禁", count: 2 });
  assert.ok(r.hits.some((h) => h.phrase === "空气凝固"));
  assert.ok(r.density > 0);
});

test("detectAiPhrases 识别总结式结尾", () => {
  assert.equal(detectAiPhrases("打完了。\n\n他知道，这一切才刚刚开始。").summaryEnding, true);
  assert.equal(detectAiPhrases("打完了。\n\n门外传来敲门声。").summaryEnding, false);
});

test("detectAiPhrases 干净文本无命中", () => {
  const r = detectAiPhrases("他推开门，走了进去。");
  assert.equal(r.hits.length, 0);
  assert.equal(r.density, 0);
});
