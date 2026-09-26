/* global renderMarkdown, escapeHtml */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => escapeHtml(String(s ?? ""));
const app = $("#app");

const GENRES = ["玄幻", "仙侠", "都市", "科幻", "历史", "悬疑", "游戏", "末世", "言情", "奇幻", "武侠", "其他"];
const STYLES = [
  "热血爽文：节奏快、爽点密集、对话利落",
  "轻松幽默：吐槽感强、人物有梗、日常有趣",
  "细腻文艺：注重氛围和心理描写、文笔优美",
  "悬疑紧凑：信息控制、反转多、紧张感强",
  "正剧厚重：世界观宏大、群像刻画、逻辑严密",
];

const state = {
  info: null,
  novel: null,
  route: { page: "home" },
  job: null, // 当前任务快照
  es: null, // EventSource
  dirty: false,
  editing: false, // 章节正文编辑模式
};

// ================================================================ utils
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

let toastTimer;
function toast(msg, ms = 2400) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

function fmtWords(n) {
  return n >= 10000 ? (n / 10000).toFixed(1) + " 万字" : n + " 字";
}

function markDirty(root) {
  $$("input, textarea, select", root).forEach((el) => el.addEventListener("input", () => (state.dirty = true)));
}

const running = () => state.job?.status === "running";

/** 第一个还没写的章节（与后端一致，中间的空章不会被跳过） */
function firstUnwritten(n) {
  const written = new Set(n.chapters.filter((c) => c.status === "written").map((c) => c.index));
  let i = 1;
  while (written.has(i)) i++;
  return i;
}

// ================================================================ router
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "n" && parts[1]) {
    if (parts[2] === "ch" && parts[3]) return { page: "chapter", id: parts[1], index: Number(parts[3]) };
    return { page: "novel", id: parts[1], tab: parts[2] || "overview" };
  }
  if (parts[0] === "models") return { page: "models" };
  return { page: "home" };
}

let lastHash = location.hash;
let skipRoute = false;
async function route() {
  if (skipRoute) {
    skipRoute = false;
    return;
  }
  if (state.dirty && !confirm("有未保存的修改，确定离开吗？")) {
    skipRoute = true;
    location.hash = lastHash;
    return;
  }
  lastHash = location.hash;
  state.dirty = false;
  state.editing = false;
  state.route = parseRoute();
  try {
    if (state.route.page === "home") {
      detachJob(true);
      state.novel = null;
      await renderHome();
    } else if (state.route.page === "models") {
      detachJob(true);
      state.novel = null;
      await renderModels();
    } else {
      if (!state.novel || state.novel.id !== state.route.id) {
        detachJob(true);
        state.novel = await api("GET", `/api/novels/${state.route.id}`);
        if (state.novel.job) attachJob(state.novel.job);
      }
      renderWorkspace();
    }
  } catch (e) {
    app.innerHTML = `<div class="home"><div class="warn-box">加载失败：${esc(e.message)}</div><a class="btn" href="#/">返回首页</a></div>`;
  }
  window.scrollTo(0, 0);
}

async function reloadNovel() {
  if (!state.novel) return;
  state.novel = await api("GET", `/api/novels/${state.novel.id}`);
  if (state.dirty) {
    renderSide();
    toast("作品内容已更新；当前页有未保存修改，保存后会刷新");
    return;
  }
  renderWorkspace(true);
}

// ================================================================ home
async function renderHome() {
  const list = await api("GET", "/api/novels");
  app.innerHTML = `
  <div class="home">
    <h1>开始一部新作品</h1>
    <p class="lead">一句灵感 → 世界观 → 人物 → 总纲 → 章节大纲 → 正文。每一步都可以修改，写完的章节会自动沉淀为记忆，保证长篇前后一致。</p>
    <form class="card create" id="createForm">
      <div class="grid-2">
        <label class="field"><span>书名</span><input type="text" name="title" placeholder="可以先随便起，之后再改" /></label>
        <label class="field"><span>类型</span>
          <select name="genre">${GENRES.map((g) => `<option>${g}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span>核心灵感 *</span>
        <textarea name="idea" rows="3" required placeholder="例：一个被逐出宗门的废柴，发现自己能看到每个人头顶的“寿命倒计时”，而全宗门的倒计时都只剩三十天……"></textarea></label>
      <label class="field"><span>文风</span>
        <input type="text" name="style" list="styles" placeholder="选择或输入，例如：热血爽文，节奏快" />
        <datalist id="styles">${STYLES.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>
      <div class="grid-3">
        <label class="field"><span>规划章数</span><input type="number" name="targetChapters" value="100" min="1" /></label>
        <label class="field"><span>每章字数</span><input type="number" name="wordsPerChapter" value="3000" min="500" step="500" /></label>
        <label class="field"><span>&nbsp;</span>
          <label class="row" style="gap:6px;color:var(--text);padding:7px 0"><input type="checkbox" name="bootstrap" checked /> 创建后自动生成设定、人物、总纲和前 10 章大纲</label></label>
      </div>
      <div class="row"><span class="grow"></span><button class="btn primary">创建作品</button></div>
    </form>

    <h2 style="font-family:var(--serif);margin:0 0 12px">我的作品 <span class="muted small">${list.length} 部</span></h2>
    <div class="novels">
      ${list.length ? "" : `<p class="muted">还没有作品。</p>`}
      ${list
        .map(
          (n) => `
        <div class="card novel-card" data-id="${n.id}">
          <div class="row" style="justify-content:space-between">
            <span class="t">${esc(n.title)}</span>
            <span><span class="tag">${esc(n.genre)}</span> ${n.running ? '<span class="tag run">生成中</span>' : ""}</span>
          </div>
          <div class="idea">${esc(n.idea)}</div>
          <div class="bar"><i style="width:${Math.min(100, (n.written / n.targetChapters) * 100)}%"></i></div>
          <div class="row small muted"><span>${n.written} / ${n.targetChapters} 章</span><span>${fmtWords(n.totalWords)}</span>
            <span class="grow"></span><span>${new Date(n.updatedAt).toLocaleString()}</span></div>
        </div>`,
        )
        .join("")}
    </div>
  </div>`;

  $$(".novel-card").forEach((el) => (el.onclick = () => (location.hash = `#/n/${el.dataset.id}`)));
  $("#createForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    body.bootstrap = f.get("bootstrap") === "on";
    if (!body.title) body.title = String(body.idea).slice(0, 12) || "未命名作品";
    const n = await api("POST", "/api/novels", body);
    location.hash = `#/n/${n.id}`;
  };
}

// ================================================================ workspace
const TABS = [
  ["overview", "概览"],
  ["worldview", "世界观"],
  ["characters", "人物"],
  ["outline", "总纲"],
  ["chapters", "章节"],
  ["memory", "记忆"],
  ["inbox", "待办"],
  ["export", "导出"],
];

function renderWorkspace(keepScroll) {
  const y = window.scrollY;
  if (!$(".ws")) app.innerHTML = `<div class="ws"><aside class="side" id="side"></aside><main class="main" id="main"></main></div>`;
  renderSide();
  const r = state.route;
  if (r.page === "chapter") renderChapter();
  else ({ overview, worldview, characters, outline, chapters, memory, inbox, export: exportTab }[r.tab] || overview)();
  if (keepScroll) window.scrollTo(0, y);
}

function renderSide() {
  const n = state.novel;
  const written = n.chapters.filter((c) => c.status === "written").length;
  const tab = state.route.page === "chapter" ? "chapters" : state.route.tab;
  const openHooks = n.memory.hooks.filter((h) => h.status === "open" || h.status === "progressing").length;
  const blocking = n.inbox.filter((i) => i.status === "open" && i.blocking).length;
  const badge = {
    characters: n.characters.length || "",
    chapters: `${written}/${n.targetChapters}`,
    memory: openHooks ? `${openHooks} 伏笔` : "",
    inbox: n.openInbox ? `<span class="${blocking ? "badge-alert" : ""}">${n.openInbox}</span>` : "",
  };
  $("#side").innerHTML = `
    <div class="book">${esc(n.title)}</div>
    <div class="stats">${esc(n.genre)} · ${written} 章 · ${fmtWords(n.totalWords)}</div>
    <nav class="nav">
      ${TABS.map(([k, v]) => `<a href="#/n/${n.id}/${k}" class="${tab === k ? "active" : ""}"><span>${v}</span><span class="badge">${badge[k] ?? ""}</span></a>`).join("")}
    </nav>`;
}

/** 通用：AI 生成条 */
function aiBar(kind, label, placeholder) {
  return `<div class="ai-bar">
    <input type="text" class="grow" id="aiExtra" placeholder="${esc(placeholder || "（可选）给 AI 的额外要求，例如：主角性格更腹黑一些")}" />
    <button class="btn primary" data-job="${kind}">${label}</button>
  </div>`;
}

function bindJobButtons(root = $("#main")) {
  $$("[data-job]", root).forEach(
    (b) =>
      (b.onclick = async () => {
        if (state.dirty && !confirm("有未保存的修改，AI 生成后可能被覆盖。继续吗？")) return;
        const payload = { kind: b.dataset.job, extra: $("#aiExtra")?.value || "" };
        if (b.dataset.index) payload.index = Number(b.dataset.index);
        if (b.dataset.from) payload.from = Number(b.dataset.from);
        if (b.dataset.count) payload.count = Number(b.dataset.count);
        if (b.dataset.countFrom) payload.count = Number($(b.dataset.countFrom).value);
        await startJob(payload);
      }),
  );
}

async function startJob(payload) {
  try {
    const snap = await api("POST", `/api/novels/${state.novel.id}/jobs`, payload);
    state.dirty = false;
    attachJob(snap);
  } catch (e) {
    toast(e.message, 4000);
  }
}

async function patchNovel(data, msg = "已保存") {
  state.novel = await api("PATCH", `/api/novels/${state.novel.id}`, data);
  state.dirty = false;
  toast(msg);
  renderWorkspace(true);
}

// ---------------------------------------------------------------- 概览
function overview() {
  const n = state.novel;
  const written = n.chapters.filter((c) => c.status === "written").length;
  const planned = n.chapters.length;
  const steps = [
    ["worldview", "世界观", Boolean(n.worldview), n.worldview ? `${n.worldview.length} 字` : "未生成"],
    ["characters", "人物", n.characters.length > 0, n.characters.length ? `${n.characters.length} 人` : "未生成"],
    ["outline", "总纲", Boolean(n.outline), n.outline ? `${n.outline.length} 字` : "未生成"],
    ["chapters", "章节大纲", planned > 0, `${planned} / ${n.targetChapters} 章`],
    ["chapters", "正文", written > 0, `${written} 章 · ${fmtWords(n.totalWords)}`],
  ];
  $("#main").innerHTML = `
    ${modelWarning()}
    <div class="head"><h2>创作流程</h2></div>
    <div class="steps">
      ${steps.map(([tab, name, done, val], i) => `<a class="step ${done ? "done" : ""}" href="#/n/${n.id}/${tab}"><div class="n">第 ${i + 1} 步</div><div class="name">${name}</div><div class="val">${val}</div></a>`).join("")}
    </div>
    <div class="card" style="margin-bottom:18px">
      <h3>一键操作</h3>
      <div class="row">
        <button class="btn" data-job="bootstrap">一键生成 设定+人物+总纲+前10章大纲</button>
        <span class="grow"></span>
        <span>从第 ${firstUnwritten(n)} 章起连续写</span>
        <input type="number" id="autoCount" value="5" min="1" max="200" style="width:80px" />
        <span>章</span>
        <button class="btn primary" data-job="auto" data-count-from="#autoCount">开始写作</button>
      </div>
      <p class="muted small" style="margin:10px 0 0">连续写作会自动：缺大纲时规划后续 10 章 → 写正文 → ${n.settings.autoReview ? `审校（低于 ${n.settings.reviewThreshold} 分自动修订） → ` : ""}抽取状态变化/伏笔（带原文出处） → 每 ${n.settings.arcSize} 章生成分段摘要。${n.settings.confirmCritical ? "遇到关键状态变化会暂停，等你在「待办」确认。" : ""}任务在服务端运行，关闭页面也不会中断。</p>
      ${n.openInbox ? `<div class="warn-box" style="margin:10px 0 0">有 ${n.openInbox} 项待办未处理，<a href="#/n/${n.id}/inbox">去处理</a></div>` : ""}
    </div>
    <form class="card" id="infoForm">
      <h3>作品信息</h3>
      <div class="grid-2" style="margin-bottom:12px">
        <label class="field"><span>书名</span><input type="text" name="title" value="${esc(n.title)}" /></label>
        <label class="field"><span>类型</span><select name="genre">${GENRES.map((g) => `<option ${g === n.genre ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      </div>
      <label class="field" style="margin-bottom:12px"><span>核心灵感</span><textarea name="idea" rows="3">${esc(n.idea)}</textarea></label>
      <label class="field" style="margin-bottom:12px"><span>文风</span><input type="text" name="style" list="styles2" value="${esc(n.style)}" />
        <datalist id="styles2">${STYLES.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>
      <div class="grid-3">
        <label class="field"><span>规划章数</span><input type="number" name="targetChapters" value="${n.targetChapters}" /></label>
        <label class="field"><span>每章字数</span><input type="number" name="wordsPerChapter" value="${n.wordsPerChapter}" step="500" /></label>
        <label class="field"><span>自动修订阈值（分）</span><input type="number" name="reviewThreshold" value="${n.settings.reviewThreshold}" min="0" max="100" /></label>
      </div>
      <label class="row" style="gap:6px;margin-top:12px"><input type="checkbox" name="autoReview" ${n.settings.autoReview ? "checked" : ""} />
        每章写完自动审校；低于阈值或有严重问题时自动修订一次（多消耗约 1~2 次模型调用）</label>
      <label class="row" style="gap:6px;margin-top:8px"><input type="checkbox" name="confirmCritical" ${n.settings.confirmCritical ? "checked" : ""} />
        关键状态变化（境界、身份、生死）需要我确认后才生效；未确认时连续写作暂停</label>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn danger" id="delNovel">删除作品</button>
        <span class="grow"></span><button class="btn primary">保存</button>
      </div>
    </form>`;
  markDirty($("#infoForm"));
  bindJobButtons();
  $("#infoForm").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = Object.fromEntries(f.entries());
    data.settings = {
      autoReview: f.get("autoReview") === "on",
      reviewThreshold: Number(f.get("reviewThreshold")),
      confirmCritical: f.get("confirmCritical") === "on",
    };
    delete data.autoReview;
    delete data.reviewThreshold;
    delete data.confirmCritical;
    patchNovel(data);
  };
  $("#delNovel").onclick = async () => {
    if (!confirm(`确定删除《${n.title}》？所有章节将被永久删除。`)) return;
    await api("DELETE", `/api/novels/${n.id}`);
    state.dirty = false;
    location.hash = "#/";
  };
}

// ---------------------------------------------------------------- 世界观 / 总纲（Markdown 文档）
function docTab(field, title, hint, kind, genLabel, placeholder) {
  const n = state.novel;
  const val = n[field];
  $("#main").innerHTML = `
    <div class="head"><h2>${title}</h2><span class="grow"></span>
      <button class="btn" id="toggleView">${val ? "编辑" : "预览"}</button>
      <button class="btn primary" id="saveDoc">保存</button></div>
    <p class="hint">${hint}</p>
    ${aiBar(kind, val ? "AI 修改/重写" : genLabel, placeholder)}
    <div id="docArea"></div>`;
  let editing = !val;
  const area = $("#docArea");
  const show = () => {
    const cur = $("#docText")?.value ?? state.novel[field];
    area.innerHTML = editing
      ? `<textarea class="editor" id="docText" placeholder="可以手写，也可以让 AI 生成（支持 Markdown）">${esc(cur)}</textarea>`
      : `<div class="md md-view">${cur ? renderMarkdown(cur) : '<p class="muted">暂无内容</p>'}</div><textarea id="docText" class="hidden">${esc(cur)}</textarea>`;
    $("#toggleView").textContent = editing ? "预览" : "编辑";
    if (editing) markDirty(area);
  };
  show();
  $("#toggleView").onclick = () => {
    editing = !editing;
    show();
  };
  $("#saveDoc").onclick = () => patchNovel({ [field]: $("#docText").value });
  bindJobButtons();
}

const worldview = () =>
  docTab("worldview", "世界观设定", "世界背景、力量体系、势力地图、金手指、核心冲突。写每一章时都会参考这里，务必保证设定清楚。", "worldview", "AI 生成设定", "（可选）额外要求，例如：力量体系参考九品制，不要系统流");
const outline = () =>
  docTab("outline", "全书总纲", "主线概述、分卷大纲、结局方向和长线伏笔。章节大纲会按这里的分卷逐步展开。", "outline", "AI 生成总纲", "（可选）额外要求，例如：前三卷在学院，第四卷开始出海");

// ---------------------------------------------------------------- 章节列表
function chapters() {
  const n = state.novel;
  const last = n.chapters.at(-1)?.index ?? 0;
  const nextWrite = firstUnwritten(n);
  $("#main").innerHTML = `
    <div class="head"><h2>章节</h2><span class="muted">${n.chapters.length} 章已规划 · ${n.chapters.filter((c) => c.status === "written").length} 章已写</span>
      <span class="grow"></span>
      <button class="btn" data-job="plan" data-from="${last + 1}" data-count="10" ${!n.outline ? "disabled title='请先生成总纲'" : ""}>规划第 ${last + 1}-${last + 10} 章大纲</button>
      <button class="btn" data-job="write" data-index="${nextWrite}">写第 ${nextWrite} 章</button>
      <input type="number" id="autoCount" value="5" min="1" max="200" style="width:70px" />
      <button class="btn primary" data-job="auto" data-count-from="#autoCount">连续写作</button>
    </div>
    ${
      n.chapters.length
        ? `<table class="list"><thead><tr><th style="width:56px">#</th><th style="width:170px">标题</th><th>大纲 / 摘要</th><th style="width:70px">状态</th><th style="width:70px">审校</th><th style="width:70px">字数</th></tr></thead><tbody>
      ${n.chapters
        .map(
          (c) => `<tr class="clickable" data-index="${c.index}">
          <td class="muted">${c.index}</td>
          <td class="ch-title">${esc(c.title)}</td>
          <td><div class="ch-outline">${esc(c.summary || c.outline)}</div></td>
          <td class="status ${c.status}">${c.status === "written" ? "已写" : "待写"}${c.stale ? `<br/><span class="tag warn" title="${esc(c.stale)}">待复查</span>` : ""}</td>
          <td>${c.review ? scoreBadge(c.review) : '<span class="muted small">-</span>'}</td>
          <td class="muted small">${c.words || "-"}</td></tr>`,
        )
        .join("")}
      </tbody></table>`
        : `<div class="card muted">还没有章节大纲。${n.outline ? "点击右上角「规划章节大纲」开始。" : "请先完成世界观、人物和总纲。"}</div>`
    }`;
  bindJobButtons();
  $$("tr[data-index]").forEach((tr) => (tr.onclick = () => (location.hash = `#/n/${n.id}/ch/${tr.dataset.index}`)));
}

// ---------------------------------------------------------------- 单章
async function renderChapter() {
  const n = state.novel;
  const index = state.route.index;
  const c = n.chapters.find((x) => x.index === index);
  if (!c) {
    $("#main").innerHTML = `<div class="card">第 ${index} 章不存在。<a class="btn" href="#/n/${n.id}/chapters">返回章节列表</a></div>`;
    return;
  }
  const { text } = await api("GET", `/api/novels/${n.id}/chapters/${index}`);
  const prev = n.chapters.find((x) => x.index === index - 1);
  const next = n.chapters.find((x) => x.index === index + 1);
  $("#main").innerHTML = `
    <div class="head">
      <a class="btn small" href="#/n/${n.id}/chapters">← 章节列表</a>
      ${prev ? `<a class="btn small" href="#/n/${n.id}/ch/${prev.index}">上一章</a>` : ""}
      ${next ? `<a class="btn small" href="#/n/${n.id}/ch/${next.index}">下一章</a>` : ""}
      <span class="grow"></span>
      <span class="muted small">${c.words ? c.words + " 字" : ""}</span>
      ${text ? `<button class="btn" id="editText">${state.editing ? "完成编辑" : "编辑正文"}</button>` : ""}
      ${state.editing ? `<button class="btn primary" id="saveText">保存正文</button>` : ""}
    </div>
    ${c.stale ? `<div class="warn-box">⚠ ${esc(c.stale)}，本章可能与前文不一致，建议「审校本章」检查。</div>` : ""}
    <div class="reader-wrap">
      <div>
        <div class="reader ${state.editing ? "editing" : ""}" id="reader">
          ${
            state.editing
              ? `<textarea id="textEdit">${esc(text)}</textarea>`
              : `<h1>第${c.index}章 ${esc(c.title)}</h1><div id="readerText">${text ? esc(text) : `<div class="empty">本章还没有正文<br/><br/><button class="btn primary" data-job="write" data-index="${index}">AI 写本章</button></div>`}</div>`
          }
        </div>
      </div>
      <div class="aside-card">
        <div class="card">
          <label class="field" style="margin-bottom:8px"><span>标题</span><input type="text" id="chTitle" value="${esc(c.title)}" /></label>
          <label class="field" style="margin-bottom:8px"><span>本章大纲</span><textarea id="chOutline" rows="8">${esc(c.outline)}</textarea></label>
          <label class="field" style="margin-bottom:8px"><span>出场人物（逗号分隔）</span><input type="text" id="chChars" value="${esc((c.characters || []).join("，"))}" /></label>
          <div class="row"><button class="btn small danger" id="delCh">删除本章</button><span class="grow"></span><button class="btn small primary" id="saveCh">保存大纲</button></div>
        </div>
        <div class="card">
          <label class="field" style="margin-bottom:8px"><span>${text ? "按要求修改本章" : "写作要求（可选）"}</span>
            <textarea id="aiExtra" rows="3" placeholder="${text ? "例：打斗写得更具体；结尾换成女主出场" : "例：本章多写主角内心挣扎"}"></textarea></label>
          <div class="row">
            ${text ? `<button class="btn small" id="rewrite">按要求修改</button><button class="btn small" data-job="write" data-index="${index}">整章重写</button>` : `<button class="btn small primary" data-job="write" data-index="${index}">AI 写本章</button>`}
          </div>
        </div>
        ${text ? reviewCard(c, index) : ""}
        ${text ? `<div class="card"><div class="row"><b>历史版本</b><span class="grow"></span><button class="btn small" id="loadVersions">查看</button></div><div id="versions"></div></div>` : ""}
        ${
          text
            ? `<div class="card"><div class="row" style="margin-bottom:6px"><b>本章记忆</b><span class="grow"></span>
                <button class="btn small" data-job="digest" data-index="${index}" title="撤销本章旧的状态变化，按当前正文重新抽取">重新整理</button></div>
                ${c.summary ? `<div class="small">${esc(c.summary)}</div>` : '<p class="muted small">还没有整理过记忆。</p>'}
                <div class="row" style="margin-top:8px"><button class="btn small" id="showDigest">状态变化</button><button class="btn small" id="showContext">写作上下文</button></div>
                <div id="runView"></div></div>`
            : ""
        }
      </div>
    </div>`;
  markDirty($("#main"));
  bindJobButtons();
  $("#saveCh").onclick = async () => {
    state.novel = await api("PUT", `/api/novels/${n.id}/chapters/${index}`, {
      title: $("#chTitle").value,
      outline: $("#chOutline").value,
      characters: $("#chChars").value.split(/[,，、\s]+/).filter(Boolean),
    });
    state.dirty = false;
    toast("大纲已保存");
    renderSide();
  };
  $("#delCh").onclick = async () => {
    if (!confirm(`删除第 ${index} 章（大纲和正文）？`)) return;
    state.novel = await api("DELETE", `/api/novels/${n.id}/chapters/${index}`);
    state.dirty = false;
    location.hash = `#/n/${n.id}/chapters`;
  };
  if ($("#editText"))
    $("#editText").onclick = () => {
      if (state.editing && state.dirty && !confirm("放弃未保存的正文修改？")) return;
      state.editing = !state.editing;
      state.dirty = false;
      renderChapter();
    };
  if ($("#saveText"))
    $("#saveText").onclick = async () => {
      state.novel = await api("PUT", `/api/novels/${n.id}/chapters/${index}`, { text: $("#textEdit").value });
      state.dirty = false;
      state.editing = false;
      toast("正文已保存");
      renderWorkspace(true);
    };
  if ($("#rewrite"))
    $("#rewrite").onclick = () => {
      const instruction = $("#aiExtra").value.trim();
      if (!instruction) return toast("请先填写修改要求");
      startJob({ kind: "rewrite", index, instruction });
    };
  if ($("#loadVersions")) $("#loadVersions").onclick = () => loadVersions(index);
  if ($("#showDigest")) $("#showDigest").onclick = () => showRun(index, "digest");
  if ($("#showContext")) $("#showContext").onclick = () => showRun(index, "context-write");
  // 如果正在生成本章，接上实时文字
  if (running() && state.job.current?.target === `chapter:${index}`) showLiveChapter(state.job.current.text);
}

const SEV = { high: "严重", medium: "一般", low: "轻微" };

function scoreBadge(r) {
  const cls = r.score >= 85 ? "good" : r.score >= 70 ? "mid" : "bad";
  return `<span class="score ${cls}" title="${r.revised ? "已按审校意见修订" : ""}">${r.score}${r.revised ? "✓" : ""}</span>`;
}

function reviewCard(c, index) {
  const r = c.review;
  if (!r)
    return `<div class="card"><div class="row"><b>审校</b><span class="grow"></span>
      <button class="btn small" data-job="review" data-index="${index}">审校本章</button></div>
      <p class="muted small" style="margin:6px 0 0">让 AI 主编从设定一致性、人物逻辑、大纲执行、节奏、钩子、AI 腔等维度审稿。</p></div>`;
  return `<div class="card review">
    <div class="row" style="margin-bottom:8px"><b>审校</b>${scoreBadge(r)}
      <span class="muted small">${r.revised ? "修订前评分 · 已修订" : r.verdict === "pass" ? "通过" : "建议修改"}</span>
      <span class="grow"></span>
      <button class="btn small" data-job="review" data-index="${index}" title="重新审校当前正文">重审</button>
      ${r.issues.length && !r.revised ? `<button class="btn small primary" data-job="revise" data-index="${index}">按意见修订</button>` : ""}</div>
    ${r.issues
      .map(
        (i) => `<div class="issue ${i.severity}">
        <div class="small"><span class="sev">${SEV[i.severity] || i.severity}</span> <b>${esc(i.dimension)}</b></div>
        ${i.quote ? `<div class="quote">「${esc(i.quote)}」</div>` : ""}
        <div class="small">${esc(i.problem)}</div>
        ${i.suggestion ? `<div class="small muted">→ ${esc(i.suggestion)}</div>` : ""}</div>`,
      )
      .join("")}
    ${r.aiPhrases.length ? `<div class="small" style="margin-top:8px"><span class="muted">套话：</span>${r.aiPhrases.map((h) => `<span class="tag">${esc(h.phrase)}×${h.count}</span>`).join(" ")}</div>` : ""}
    ${r.strengths.length ? `<div class="small muted" style="margin-top:8px">亮点：${r.strengths.map(esc).join("；")}</div>` : ""}
  </div>`;
}

async function loadVersions(index) {
  const n = state.novel;
  const list = await api("GET", `/api/novels/${n.id}/chapters/${index}/versions`);
  const box = $("#versions");
  box.innerHTML = list.length
    ? list
        .map(
          (v) => `<div class="ver"><span class="small">${new Date(v.at).toLocaleString()}</span>
          <span class="muted small">${v.words} 字 · 被「${esc(v.reason)}」覆盖</span>
          <span class="grow"></span>
          <button class="btn small" data-view="${esc(v.file)}">预览</button>
          <button class="btn small" data-restore="${esc(v.file)}">恢复</button></div>`,
        )
        .join("")
    : '<p class="muted small" style="margin:6px 0 0">还没有历史版本。重写、修订、手动编辑时会自动保存旧版本（每章保留最近 20 个）。</p>';
  $$("[data-view]", box).forEach(
    (b) =>
      (b.onclick = async () => {
        const { text } = await api("GET", `/api/novels/${n.id}/chapters/${index}/versions/${encodeURIComponent(b.dataset.view)}`);
        const el = $("#readerText");
        if (!el) return;
        el.innerHTML = `<div class="warn-box">正在预览历史版本（${esc(b.dataset.view.split("_")[1])} 字），<a href="javascript:void 0" id="backCur">返回当前版本</a></div>${esc(text)}`;
        $("#backCur").onclick = () => renderChapter();
        window.scrollTo(0, 0);
      }),
  );
  $$("[data-restore]", box).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("用这个历史版本替换当前正文？当前正文会先存为历史版本。")) return;
        try {
          state.novel = await api("POST", `/api/novels/${n.id}/chapters/${index}/versions/${encodeURIComponent(b.dataset.restore)}/restore`);
          toast("已恢复。摘要和记忆未自动更新，如有需要请点「重新整理」");
          renderWorkspace(true);
        } catch (e) {
          toast(e.message, 4000);
        }
      }),
  );
}

const TRACE_STATUS = { full: "", fallback: "缩略", dropped: "丢弃" };

/** 查看本章生产留档：记忆抽取结果 / 实际注入的写作上下文 */
async function showRun(index, name) {
  const box = $("#runView");
  try {
    const d = await api("GET", `/api/novels/${state.novel.id}/chapters/${index}/runs/${name}`);
    if (name === "digest") {
      box.innerHTML = `<div class="small" style="margin-top:8px">
        <div><b>生效 ${d.applied}</b> · 待确认 ${d.proposed} · 丢弃 ${d.dropped.length}</div>
        ${d.changes.map((c) => `<div>· ${esc(c)}</div>`).join("")}
        ${d.dropped.length ? `<div class="muted" style="margin-top:6px">丢弃（找不到原文出处或无法识别）：</div>${d.dropped.map((x) => `<div class="muted">· ${esc(x)}</div>`).join("")}` : ""}
      </div>`;
    } else {
      box.innerHTML = `<div class="small" style="margin-top:8px">
        <div>共 <b>${d.chars}</b> 字 / 预算 ${d.budget}${d.overBudget ? ' <span class="tag warn">超预算</span>' : ""} · ${new Date(d.at).toLocaleString()}</div>
        <table class="list trace"><tbody>${d.trace
          .map((t) => `<tr><td>${esc(t.title.replace(/^#\s*/, ""))}</td><td class="muted">${t.chars}</td><td>${TRACE_STATUS[t.status] ? `<span class="tag warn">${TRACE_STATUS[t.status]}</span>` : ""}</td></tr>`)
          .join("")}</tbody></table>
        <details><summary class="muted">完整提示词</summary><pre class="prompt">${esc(d.messages.map((m) => `【${m.role}】\n${m.content}`).join("\n\n"))}</pre></details>
      </div>`;
    }
  } catch (e) {
    box.innerHTML = `<p class="muted small">${esc(e.message)}（旧版本写的章节没有留档）</p>`;
  }
}

function showLiveChapter(text) {
  const el = $("#readerText");
  if (!el || state.editing) return;
  el.innerHTML = `${esc(text)}<span class="cursor"></span>`;
}

// ---------------------------------------------------------------- 导出
function exportTab() {
  const n = state.novel;
  const written = n.chapters.filter((c) => c.status === "written");
  $("#main").innerHTML = `
    <div class="head"><h2>导出</h2></div>
    <div class="card">
      <p>已写 <b>${written.length}</b> 章，共 <b>${fmtWords(n.totalWords)}</b>。只导出已写正文的章节。</p>
      <div class="row">
        <a class="btn primary" href="/api/novels/${n.id}/export?format=txt">下载 TXT</a>
        <a class="btn" href="/api/novels/${n.id}/export?format=md">下载 Markdown</a>
      </div>
    </div>`;
}

// ================================================================ 任务面板
function detachJob(hide) {
  state.es?.close();
  state.es = null;
  if (hide) {
    state.job = null;
    $("#job").classList.add("hidden");
  }
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadNovel, 300);
}

function attachJob(snap) {
  detachJob(false);
  state.job = structuredClone(snap);
  renderJobPanel();
  setJobCollapsed(snap.status !== "running");
  if (snap.status !== "running") return;
  const es = new EventSource(`/api/jobs/${snap.id}/stream`);
  state.es = es;
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    const j = state.job;
    switch (e.type) {
      case "snapshot":
        state.job = e.job;
        renderJobPanel();
        if (e.job.status !== "running") {
          es.close();
          state.es = null;
          scheduleReload();
        }
        break;
      case "log":
        j.logs.push(e);
        appendLog(e);
        break;
      case "stream":
        j.current = { target: e.target, label: e.label, text: "" };
        $("#jobStreamLabel").textContent = "正在生成：" + e.label;
        $("#jobStream").textContent = "";
        break;
      case "delta":
        if (j.current) j.current.text += e.text;
        appendStream(e.text);
        break;
      case "progress":
        j.progress = { done: e.done, total: e.total };
        renderJobHead();
        break;
      case "updated":
        scheduleReload();
        break;
      case "end":
        j.status = e.status;
        j.error = e.error;
        renderJobHead();
        es.close();
        state.es = null;
        scheduleReload();
        refreshUsage();
        if (e.status === "done") toast("✓ " + j.label + " 完成");
        if (e.status === "paused") toast("⏸ 已暂停：" + (e.error || "") + " —— 请到「待办」处理", 6000);
        if (j.current) $("#jobStreamLabel").textContent = "最后生成：" + j.current.label;
        setJobCollapsed(true);
        break;
    }
  };
  es.onerror = () => {
    // 服务重启等情况：稍后刷新状态
    if (state.job?.status === "running") setTimeout(() => state.novel && reloadNovel().then(() => state.novel.job && attachJob(state.novel.job)), 3000);
    es.close();
  };
}

function renderJobHead() {
  const j = state.job;
  $("#jobDot").className = "dot " + j.status;
  const statusText = { running: "", done: "（完成）", error: "（出错）", stopped: "（已停止）", paused: "（已暂停，等待确认）" }[j.status];
  $("#jobTitle").textContent = j.label + statusText;
  $("#jobProgress").textContent = j.progress?.total ? `${j.progress.done}/${j.progress.total}` : "";
  $("#jobStop").classList.toggle("hidden", j.status !== "running");
  $("#jobClose").classList.toggle("hidden", j.status === "running");
}

function renderJobPanel() {
  const j = state.job;
  const panel = $("#job");
  panel.classList.remove("hidden");
  renderJobHead();
  $("#jobLogs").innerHTML = "";
  j.logs.forEach(appendLog);
  $("#jobStreamLabel").textContent = j.current ? (j.status === "running" ? "正在生成：" : "最后生成：") + j.current.label : "";
  $("#jobStream").textContent = j.current?.text || "";
  $("#jobStream").scrollTop = 1e9;
}

function appendLog(e) {
  const box = $("#jobLogs");
  const d = document.createElement("div");
  d.className = e.level;
  d.textContent = `${new Date(e.t).toLocaleTimeString()}  ${e.msg}`;
  box.appendChild(d);
  box.scrollTop = 1e9;
}

let streamBuf = "";
let streamRaf = 0;
function appendStream(text) {
  streamBuf += text;
  if (streamRaf) return;
  streamRaf = requestAnimationFrame(() => {
    streamRaf = 0;
    const el = $("#jobStream");
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    el.textContent += streamBuf;
    streamBuf = "";
    if (atBottom) el.scrollTop = 1e9;
    const cur = state.job?.current;
    if (state.route.page === "chapter" && cur?.target === `chapter:${state.route.index}`) showLiveChapter(cur.text);
  });
}

$("#jobStop").onclick = () => state.job && api("POST", `/api/jobs/${state.job.id}/stop`);
function setJobCollapsed(c) {
  $("#job").classList.toggle("collapsed", c);
  $("#jobToggle").textContent = c ? "▴" : "▾";
}
$("#jobToggle").onclick = () => setJobCollapsed(!$("#job").classList.contains("collapsed"));
$("#jobClose").onclick = () => $("#job").classList.add("hidden");

// ================================================================ init
/** 模型配置有误或缺少密钥时的提示 */
function modelWarning() {
  const i = state.info;
  if (!i) return "";
  if (i.modelsError) return `<div class="warn-box">⚠ ${esc(i.modelsError)}，<a href="#/models">去模型设置</a></div>`;
  if (!i.hasKey) return `<div class="warn-box">⚠ 以下任务使用的模型还没有配置密钥：${esc(i.missingKeys.join("、"))}，AI 生成会失败。<a href="#/models">去模型设置</a></div>`;
  return "";
}

async function refreshUsage() {
  state.info = await api("GET", "/api/info");
  $("#modelChip").textContent = state.info.model;
  const roles = state.info.roles ? Object.entries(state.info.roles).map(([k, v]) => `${k}: ${v}`) : [];
  $("#modelChip").title = [...roles, "", "点击打开模型设置"].join("\n");
  const u = state.info.usage;
  $("#usage").textContent = u.prompt || u.completion ? `本次运行 ${(u.prompt + u.completion).toLocaleString()} tokens` : "";
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});
refreshUsage().finally(route);
