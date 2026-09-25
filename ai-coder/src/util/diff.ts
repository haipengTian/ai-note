/**
 * 极简行级 unified diff（基于 LCS），用于在审批卡片里展示改动。
 * 文件太大时退化为“整段替换”展示。
 */
export function unifiedDiff(oldText: string, newText: string, file: string, context = 3): string {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");

  // 去掉公共前后缀，减小 LCS 规模
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  type Op = { t: " " | "-" | "+"; s: string };
  let ops: Op[];

  if (midA.length * midB.length > 4_000_000) {
    ops = [...midA.map((s) => ({ t: "-" as const, s })), ...midB.map((s) => ({ t: "+" as const, s }))];
  } else {
    const n = midA.length, m = midB.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ t: " ", s: midA[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: "-", s: midA[i++] });
      else ops.push({ t: "+", s: midB[j++] });
    }
    while (i < n) ops.push({ t: "-", s: midA[i++] });
    while (j < m) ops.push({ t: "+", s: midB[j++] });
  }

  const full: Op[] = [
    ...a.slice(0, start).map((s) => ({ t: " " as const, s })),
    ...ops,
    ...a.slice(endA).map((s) => ({ t: " " as const, s })),
  ];

  // 组装 hunks
  const lines: string[] = [`--- a/${file}`, `+++ b/${file}`];
  const changed = full.map((o, idx) => (o.t !== " " ? idx : -1)).filter((x) => x >= 0);
  if (changed.length === 0) return lines.concat("(无改动)").join("\n");

  let idx = 0;
  while (idx < changed.length) {
    let hs = Math.max(0, changed[idx] - context);
    let he = Math.min(full.length, changed[idx] + context + 1);
    while (idx + 1 < changed.length && changed[idx + 1] - context <= he) {
      idx++;
      he = Math.min(full.length, changed[idx] + context + 1);
    }
    // 计算行号
    let oldLine = 1, newLine = 1;
    for (let k = 0; k < hs; k++) {
      if (full[k].t !== "+") oldLine++;
      if (full[k].t !== "-") newLine++;
    }
    const seg = full.slice(hs, he);
    const oldCount = seg.filter((o) => o.t !== "+").length;
    const newCount = seg.filter((o) => o.t !== "-").length;
    lines.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const o of seg) lines.push(o.t + o.s);
    idx++;
  }
  return lines.join("\n");
}
