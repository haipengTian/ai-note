/* global $, $$, esc, state, api, toast, startJob, renderWorkspace */
// ---------------------------------------------------------------- 待办（收件箱）

const INBOX_KIND = {
  state_proposal: ["待确认", "关键状态变化，确认后才生效"],
  needs_digest: ["需重新整理", "正文被人工改动过"],
  stale_chapter: ["待复查", "上游章节改动过"],
  gate_failed: ["质检未过", ""],
};

function inboxActions(i) {
  switch (i.kind) {
    case "state_proposal":
      return `<button class="btn small primary" data-inbox="${i.id}" data-act="approve">确认</button>
        <button class="btn small" data-inbox="${i.id}" data-act="reject">拒绝</button>`;
    case "needs_digest":
      return `<button class="btn small primary" data-digest="${i.chapter}">重新整理记忆</button>
        <button class="btn small" data-inbox="${i.id}" data-act="dismiss">忽略</button>`;
    case "stale_chapter":
      return `<a class="btn small" href="#/n/${state.novel.id}/ch/${i.chapter + 1}">去复查</a>
        <button class="btn small" data-inbox="${i.id}" data-act="dismiss">确认无影响</button>`;
    default:
      return `<button class="btn small" data-inbox="${i.id}" data-act="done">已处理</button>`;
  }
}

function inboxItem(i) {
  const [label] = INBOX_KIND[i.kind] || [i.kind];
  return `<div class="card inbox-item ${i.blocking && i.status === "open" ? "blocking" : ""}">
    <div class="row"><span class="tag ${i.kind === "state_proposal" ? "run" : ""}">${label}</span>
      ${i.blocking && i.status === "open" ? '<span class="tag warn" title="未处理时连续写作会暂停">阻塞</span>' : ""}
      <b class="grow">${esc(i.title)}</b>
      ${i.chapter ? `<a class="small" href="#/n/${state.novel.id}/ch/${i.chapter}">第 ${i.chapter} 章</a>` : ""}</div>
    ${i.detail ? `<div class="small muted" style="margin:6px 0">${esc(i.detail)}</div>` : ""}
    ${i.status === "open" ? `<div class="row">${inboxActions(i)}</div>` : `<div class="small muted">${i.status === "done" ? "已处理" : "已忽略"} · ${new Date(i.createdAt).toLocaleString()}</div>`}
  </div>`;
}

function inbox() {
  const n = state.novel;
  const open = n.inbox.filter((i) => i.status === "open").sort((a, b) => b.blocking - a.blocking || a.createdAt - b.createdAt);
  const closed = n.inbox.filter((i) => i.status !== "open").slice(-30).reverse();
  const proposals = open.filter((i) => i.kind === "state_proposal");
  $("#main").innerHTML = `
    <div class="head"><h2>待办</h2><span class="muted">${open.length} 项未处理</span><span class="grow"></span>
      ${proposals.length > 1 ? `<button class="btn" id="approveAll">全部确认（${proposals.length}）</button>` : ""}</div>
    <p class="hint">关键状态变化（境界、身份、生死等）需要你确认后才写入记忆；有<b>阻塞</b>项未处理时，连续写作会暂停。可在「概览」关闭关键变化确认。</p>
    ${open.length ? open.map(inboxItem).join("") : '<div class="card muted">没有待处理事项。</div>'}
    ${closed.length ? `<details style="margin-top:16px"><summary class="muted">最近处理过的 ${closed.length} 项</summary>${closed.map(inboxItem).join("")}</details>` : ""}`;

  $$("[data-inbox]").forEach((b) => (b.onclick = () => resolveItem(b.dataset.inbox, b.dataset.act)));
  $$("[data-digest]").forEach((b) => (b.onclick = () => startJob({ kind: "digest", index: Number(b.dataset.digest) })));
  if ($("#approveAll"))
    $("#approveAll").onclick = async () => {
      if (!confirm(`确认全部 ${proposals.length} 项关键变化？`)) return;
      for (const p of proposals) await resolveItem(p.id, "approve", true);
      toast("已全部确认");
      renderWorkspace(true);
    };
}

async function resolveItem(id, action, silent) {
  try {
    state.novel = await api("POST", `/api/novels/${state.novel.id}/inbox/${id}`, { action });
    if (!silent) {
      toast({ approve: "已确认，状态已生效", reject: "已拒绝", dismiss: "已忽略", done: "已处理" }[action]);
      renderWorkspace(true);
    }
  } catch (e) {
    toast(e.message, 4000);
  }
}
