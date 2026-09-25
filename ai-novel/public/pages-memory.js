/* global $, $$, esc, state, api, toast, markDirty, bindJobButtons, patchNovel, renderWorkspace */
// ---------------------------------------------------------------- 记忆
// 人物状态（可回看任意章节）、状态时间线、伏笔看板、分段摘要、全书梗概、快照。

const lastWrittenIndex = (n) => n.chapters.filter((c) => c.status === "written").at(-1)?.index || 0;
const charName = (n, id) => n.characters.find((c) => c.id === id)?.name || id;
const secretText = (n, id) => n.memory.secrets.find((s) => s.id === id)?.content || id;

/** 人物状态 → HTML（人物页和记忆页共用） */
function renderStateHtml(n, s) {
  if (!s) return '<span class="muted">无记录</span>';
  const rows = [
    s.alive ? "" : `<div><b class="danger-text">已死亡</b></div>`,
    ...Object.entries(s.attrs).map(([k, v]) => `<div><span class="muted">${esc(k)}：</span>${esc(v)}</div>`),
    Object.keys(s.inventory).length
      ? `<div><span class="muted">持有：</span>${Object.entries(s.inventory).map(([k, v]) => `${esc(k)}×${v}`).join("、")}</div>`
      : "",
    Object.keys(s.relations).length
      ? `<div><span class="muted">关系：</span>${Object.entries(s.relations).map(([k, v]) => `${esc(charName(n, k))}（${esc(v)}）`).join("、")}</div>`
      : "",
    s.knows.length ? `<div><span class="muted">知道：</span>${s.knows.map((id) => esc(secretText(n, id))).join("；")}</div>` : "",
  ].filter(Boolean);
  return rows.join("") || '<span class="muted">无记录</span>';
}

function eventDesc(n, e) {
  switch (e.kind) {
    case "attr":
      return e.op === "remove" ? `移除「${esc(e.key)}」` : `${esc(e.key)} → ${esc(e.value)}`;
    case "relation":
      return `与 ${esc(charName(n, e.key))}：${e.op === "remove" ? "关系解除" : esc(e.value)}`;
    case "knowledge":
      return `${e.op === "remove" ? "遗忘" : "得知"}：${esc(secretText(n, e.key))}`;
    case "inventory": {
      const qty = Number(e.value);
      return `${esc(e.key)} ${e.op === "remove" ? "全部失去" : e.op === "set" ? `= ${esc(e.value)}` : qty >= 0 ? `+${esc(qty)}` : esc(e.value)}`;
    }
    case "life":
      return e.value === "dead" ? "死亡" : "存活";
  }
  return "";
}

const EVENT_STATUS = { proposed: "待确认", rejected: "已作废" };
const SOURCE = { ai: "AI", manual: "手动", migrated: "迁移" };

function timelineHtml(n, charId) {
  const events = n.memory.events.filter((e) => e.target === charId).sort((a, b) => a.chapter - b.chapter || a.createdAt - b.createdAt);
  if (!events.length) return '<p class="muted small">还没有状态变化记录。</p>';
  return events
    .map(
      (e) => `<div class="ev ${e.status}">
        <span class="tag">第${e.chapter}章</span>
        <span class="c">${eventDesc(n, e)}${EVENT_STATUS[e.status] ? ` <span class="tag warn">${EVENT_STATUS[e.status]}</span>` : ""}
          <div class="muted small">${SOURCE[e.source] || ""} · ${esc(e.evidence)}</div></span>
        <button class="icon-btn" data-ev-del="${e.id}" title="删除这条记录">✕</button></div>`,
    )
    .join("");
}

function memory() {
  const n = state.novel;
  const latest = lastWrittenIndex(n) + 1;
  $("#main").innerHTML = `
    <div class="head"><h2>记忆</h2><span class="grow"></span></div>
    <p class="hint">每章写完后，AI 从正文中抽取状态变化（必须附原文出处，找不到出处的会被丢弃），写作下一章时注入。关键变化（境界、身份、生死）需要在「待办」确认后才生效。</p>

    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:8px"><b>人物状态</b>
        <span class="muted small">截至第</span><input type="number" id="stateAt" value="${latest}" min="1" style="width:70px" />
        <span class="muted small">章开写前</span><button class="btn small" id="loadState">查看</button>
        <span class="grow"></span></div>
      <div id="stateList"></div>
    </div>

    ${hooksCard(n)}

    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:8px"><b>全书梗概</b><span class="muted small">覆盖到第 ${n.memory.synopsisUpTo} 章；之后的剧情以分段摘要和章节摘要提供</span>
        <span class="grow"></span><button class="btn small" data-job="compress">生成分段摘要并更新梗概</button><button class="btn small primary" id="saveSynopsis">保存</button></div>
      <textarea id="synopsis" rows="6" placeholder="分段摘要攒够后自动生成">${esc(n.memory.bookSynopsis)}</textarea>
    </div>

    <div class="card" style="margin-bottom:16px">
      <b>分段摘要</b> <span class="muted small">每写完一段（${n.settings.arcSize} 章）自动生成并冻结，不会被反复改写</span>
      ${
        n.arcs.filter((a) => a.summary).length
          ? n.arcs
              .filter((a) => a.summary)
              .map((a) => `<details class="arc"><summary>第 ${a.range[0]}~${a.range[1]} 章${a.range[1] <= n.memory.synopsisUpTo ? ' <span class="muted small">（已并入梗概）</span>' : ""}</summary><div class="small">${esc(a.summary)}</div></details>`)
              .join("")
          : '<p class="muted small">暂无。</p>'
      }
    </div>

    <div class="card">
      <div class="row"><b>记忆快照</b><span class="muted small">每写一章前自动保存人物与记忆；出问题时可整体回滚</span>
        <span class="grow"></span><button class="btn small" id="loadSnaps">查看</button></div>
      <div id="snaps"></div>
    </div>`;
  markDirty($("#synopsis").parentElement);
  bindJobButtons();
  $("#saveSynopsis").onclick = () => patchNovel({ bookSynopsis: $("#synopsis").value });
  $("#loadState").onclick = () => loadStates(Number($("#stateAt").value) || latest);
  $("#loadSnaps").onclick = loadSnapshots;
  bindHooks();
  loadStates(latest);
}

async function loadStates(at) {
  const n = state.novel;
  const { states } = await api("GET", `/api/novels/${n.id}/state?at=${at}`);
  $("#stateList").innerHTML = n.characters
    .filter((c) => !c.firstAppearance || c.firstAppearance < at)
    .map(
      (c) => `<div class="state-row">
        <div class="row"><span class="tag">${esc(c.role)}</span><b>${esc(c.name)}</b><span class="grow"></span>
          <button class="btn small" data-fix="${c.id}">修正</button>
          <button class="btn small" data-tl="${c.id}">时间线</button></div>
        <div class="state-view small">${renderStateHtml(n, states[c.id])}</div>
        <div class="timeline hidden" id="tl-${c.id}">${timelineHtml(n, c.id)}</div>
      </div>`,
    )
    .join("");
  $$("[data-tl]").forEach((b) => (b.onclick = () => $(`#tl-${b.dataset.tl}`).classList.toggle("hidden")));
  $$("[data-fix]").forEach((b) => (b.onclick = () => fixState(b.dataset.fix, at)));
  $$("[data-ev-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("删除这条状态记录？之后的状态会随之改变。")) return;
        await mutate("DELETE", `/api/novels/${n.id}/events/${b.dataset.evDel}`, undefined, "已删除");
      }),
  );
}

/** 手动修正：在第 at-1 章之后生效（即影响第 at 章起的写作） */
async function fixState(charId, at) {
  const n = state.novel;
  const kind = prompt("修正什么？输入序号：1 属性（境界/位置/伤势…）  2 物品数量  3 生死", "1");
  if (!kind) return;
  let body;
  if (kind === "2") {
    const key = prompt("物品名：");
    const value = key && prompt(`「${key}」现在有多少？（0 表示没有）`);
    if (!key || value === null) return;
    body = { kind: "inventory", key, op: Number(value) > 0 ? "set" : "remove", value: Number(value) };
  } else if (kind === "3") {
    const dead = confirm(`${charName(n, charId)} 已死亡？（确定 = 死亡，取消 = 存活）`);
    body = { kind: "life", op: "set", value: dead ? "dead" : "alive" };
  } else {
    const key = prompt("属性名（例如 境界/实力、所在地、伤势/身体状况）：");
    const value = key && prompt(`「${key}」改为（留空表示移除该属性）：`);
    if (!key || value === null) return;
    body = value ? { kind: "attr", key, op: "set", value } : { kind: "attr", key, op: "remove" };
  }
  await mutate("POST", `/api/novels/${n.id}/events`, { ...body, target: charId, chapter: Math.max(0, at - 1), note: "（手动修正）" }, "已修正");
}

async function mutate(method, url, body, msg) {
  try {
    state.novel = await api(method, url, body);
    toast(msg);
    renderWorkspace(true);
  } catch (e) {
    toast(e.message, 4000);
  }
}

// ---------------------------------------------------------------- 伏笔看板
const HOOK_STATUS = { open: "未推进", progressing: "推进中", deferred: "搁置", resolved: "已回收", abandoned: "放弃" };
const HOOK_TYPE = { foreshadow: "伏笔", mystery: "悬念", promise: "承诺", conflict: "冲突" };

function hooksCard(n) {
  const order = { progressing: 0, open: 1, deferred: 2, resolved: 3, abandoned: 4 };
  const hooks = [...n.memory.hooks].sort((a, b) => order[a.status] - order[b.status] || (b.importance === "major") - (a.importance === "major") || a.plantedIn - b.plantedIn);
  const open = hooks.filter((h) => h.status === "open" || h.status === "progressing").length;
  return `<div class="card" style="margin-bottom:16px">
    <div class="row" style="margin-bottom:6px"><b>伏笔 / 悬念</b><span class="muted small">${open} 个进行中 / ${hooks.length} 总计 · 主线伏笔每章都会注入，次要伏笔只注入近期的</span>
      <span class="grow"></span><button class="btn small" id="addHook">＋ 添加</button></div>
    ${
      hooks.length
        ? hooks
            .map(
              (h) => `<div class="fs-item ${h.status === "resolved" || h.status === "abandoned" ? "resolved" : ""}">
          <span class="tag">${esc(h.id)}</span>
          <span class="tag ${h.importance === "major" ? "run" : ""}" data-hook-imp="${h.id}" title="点击切换主线/次要">${h.importance === "major" ? "主线" : "次要"}</span>
          <span class="c">${esc(h.content)} <span class="muted small">${HOOK_TYPE[h.type] || ""}</span></span>
          <span class="muted small">${HOOK_STATUS[h.status]} · 第${h.plantedIn}章埋${h.lastAdvancedIn ? ` · 第${h.lastAdvancedIn}章推进` : ""}${h.resolvedIn ? ` · 第${h.resolvedIn}章收` : ""}</span>
          <button class="btn small" data-hook-resolve="${h.id}">${h.status === "resolved" ? "取消回收" : "标记回收"}</button>
          ${h.status !== "resolved" ? `<button class="btn small" data-hook-defer="${h.id}">${h.status === "deferred" ? "恢复" : "搁置"}</button>` : ""}
          <button class="icon-btn" data-hook-del="${h.id}">✕</button></div>`,
            )
            .join("")
        : '<p class="muted small">暂无。写作过程中会自动记录。</p>'
    }
  </div>`;
}

function bindHooks() {
  const n = state.novel;
  const save = (hooks) => patchNovel({ hooks }, "伏笔已更新");
  const edit = (id, fn) => save(n.memory.hooks.map((h) => (h.id === id ? fn(structuredClone(h)) : h)));
  $$("[data-hook-imp]").forEach((b) => (b.onclick = () => edit(b.dataset.hookImp, (h) => ({ ...h, importance: h.importance === "major" ? "minor" : "major" }))));
  $$("[data-hook-resolve]").forEach(
    (b) =>
      (b.onclick = () =>
        edit(b.dataset.hookResolve, (h) =>
          h.status === "resolved"
            ? { ...h, history: h.history.filter((r) => r.op !== "resolve") }
            : { ...h, history: [...h.history, { chapter: lastWrittenIndex(n) || h.plantedIn, op: "resolve", note: "手动标记", source: "manual" }] },
        )),
  );
  $$("[data-hook-defer]").forEach((b) => (b.onclick = () => edit(b.dataset.hookDefer, (h) => ({ ...h, status: h.status === "deferred" ? "open" : "deferred" }))));
  $$("[data-hook-del]").forEach((b) => (b.onclick = () => confirm("删除这个伏笔？") && save(n.memory.hooks.filter((h) => h.id !== b.dataset.hookDel))));
  $("#addHook").onclick = () => {
    const content = prompt("伏笔/悬念内容：");
    if (!content) return;
    const plantedIn = Number(prompt("在第几章埋下？", String(lastWrittenIndex(n) || 1))) || 1;
    const major = confirm("是主线伏笔吗？（确定 = 主线，每章都会提醒 AI）");
    const id = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
    save([
      ...n.memory.hooks,
      { id, type: "foreshadow", content, importance: major ? "major" : "minor", status: "open", plantedIn, history: [{ chapter: plantedIn, op: "plant", note: "手动添加", source: "manual" }], source: "manual" },
    ]);
  };
}

// ---------------------------------------------------------------- 快照
async function loadSnapshots() {
  const n = state.novel;
  const list = await api("GET", `/api/novels/${n.id}/snapshots`);
  const box = $("#snaps");
  box.innerHTML = list.length
    ? list
        .map(
          (v) => `<div class="ver"><span class="small">${new Date(v.at).toLocaleString()}</span>
          <span class="muted small">${esc(v.reason)} · 当时已写 ${v.written} 章</span><span class="grow"></span>
          <button class="btn small" data-snap="${esc(v.file)}">恢复到此</button></div>`,
        )
        .join("")
    : '<p class="muted small" style="margin:6px 0 0">暂无快照</p>';
  $$("[data-snap]", box).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("把人物、状态记录、伏笔和梗概恢复到这个快照？（章节正文不变；当前状态会先自动存一份快照）")) return;
        await mutate("POST", `/api/novels/${n.id}/snapshots/${encodeURIComponent(b.dataset.snap)}/restore`, undefined, "记忆已恢复");
      }),
  );
}
