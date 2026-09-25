/* global renderMarkdown, escapeHtml */
const $ = (s) => document.querySelector(s);
const state = {
  sessionId: null,
  busy: false,
  turn: null, // 当前助手回合的渲染状态
  tools: new Map(), // callId -> card element
  usage: { prompt: 0, completion: 0 },
};

// ------------------------------------------------------------------ api
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

// ------------------------------------------------------------------ sessions
async function loadSessions() {
  const list = await api("GET", "/api/sessions");
  const ul = $("#sessions");
  ul.innerHTML = "";
  for (const s of list) {
    const li = document.createElement("li");
    li.className = s.id === state.sessionId ? "active" : "";
    li.innerHTML = `<span>${escapeHtml(s.title)}</span><button class="del" title="删除">✕</button>`;
    li.onclick = () => openSession(s.id);
    li.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      await api("DELETE", `/api/session?id=${s.id}`);
      if (s.id === state.sessionId) await newSession();
      else loadSessions();
    };
    ul.appendChild(li);
  }
}

async function newSession() {
  const s = await api("POST", "/api/sessions");
  state.sessionId = s.id;
  $("#autoApprove").checked = s.autoApprove;
  clearMessages();
  loadSessions();
}

async function openSession(id) {
  if (state.busy) return;
  const s = await api("GET", `/api/session?id=${id}`);
  state.sessionId = s.id;
  $("#autoApprove").checked = s.autoApprove;
  clearMessages();
  replay(s.messages);
  loadSessions();
  $("#sidebar").classList.remove("open");
}

function clearMessages() {
  $("#messages").innerHTML = "";
  $("#messages").appendChild(emptyEl);
  emptyEl.classList.remove("hidden");
  state.tools.clear();
  state.turn = null;
  state.usage = { prompt: 0, completion: 0 };
  setStatus("");
}

/** 从服务端的消息历史重建界面 */
function replay(messages) {
  const results = new Map();
  for (const m of messages) if (m.role === "tool") results.set(m.tool_call_id, m.content);
  for (const m of messages) {
    if (m.role === "user") {
      addUser(m.content);
      state.turn = null;
    } else if (m.role === "assistant") {
      const turn = ensureTurn();
      if (m.content) {
        const el = newTextBlock(turn);
        el.innerHTML = renderMarkdown(m.content);
        turn.text = null;
      }
      for (const c of m.tool_calls || []) {
        let args = {};
        try { args = JSON.parse(c.function.arguments); } catch { /* ignore */ }
        const card = addToolCard(turn, c.id, c.function.name, args);
        const out = results.get(c.id) || "";
        const ok = !/^(错误：|用户拒绝|用户中止|已中止)/.test(out);
        setToolResult(card, ok, out);
      }
    }
  }
  state.turn = null;
  scrollBottom(true);
}

// ------------------------------------------------------------------ rendering
const emptyEl = $("#empty");

function scrollBottom(force) {
  const box = $("#messages");
  if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
}

function addUser(text) {
  emptyEl.classList.add("hidden");
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `<div class="bubble"></div>`;
  div.firstChild.textContent = text;
  $("#messages").appendChild(div);
  scrollBottom(true);
}

function ensureTurn() {
  if (state.turn) return state.turn;
  const div = document.createElement("div");
  div.className = "msg assistant";
  $("#messages").appendChild(div);
  state.turn = { el: div, text: null, textBuf: "", reasoning: null, reasoningBuf: "" };
  return state.turn;
}

function newTextBlock(turn) {
  const el = document.createElement("div");
  el.className = "md";
  turn.el.appendChild(el);
  turn.text = el;
  turn.textBuf = "";
  return el;
}

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    const t = state.turn;
    if (t?.text) t.text.innerHTML = renderMarkdown(t.textBuf) + '<span class="cursor"></span>';
    if (t?.reasoning) t.reasoning.querySelector(".body").textContent = t.reasoningBuf;
    scrollBottom();
  });
}

function finishText(turn) {
  if (turn?.text) turn.text.innerHTML = renderMarkdown(turn.textBuf);
  if (turn) turn.text = null;
}

const TOOL_LABEL = {
  list_dir: "📁 查看目录",
  read_file: "📄 读取",
  find_files: "🔎 查找文件",
  grep: "🔍 搜索",
  edit_file: "✏️ 编辑",
  write_file: "📝 写入",
  run_command: "▶ 执行",
};

function summarize(name, args) {
  if (typeof args !== "object" || !args) return String(args).slice(0, 120);
  switch (name) {
    case "run_command": return args.command;
    case "grep": return `${args.pattern}${args.glob ? "  (" + args.glob + ")" : ""}`;
    case "find_files": return args.pattern;
    case "read_file": return args.path + (args.offset ? `:${args.offset}` : "");
    default: return args.path || "";
  }
}

function addToolCard(turn, id, name, args) {
  const card = document.createElement("div");
  card.className = "tool collapsed";
  card.innerHTML = `
    <div class="tool-head">
      <span class="name">${escapeHtml(TOOL_LABEL[name] || name)}</span>
      <span class="summary"></span>
      <span class="state running">运行中…</span>
    </div>
    <div class="tool-body"><pre></pre></div>`;
  card.querySelector(".summary").textContent = summarize(name, args);
  card.querySelector(".tool-head").onclick = () => card.classList.toggle("collapsed");
  turn.el.appendChild(card);
  state.tools.set(id, card);
  scrollBottom();
  return card;
}

function renderDiff(text) {
  return text
    .split("\n")
    .map((l) => {
      const e = escapeHtml(l) || " ";
      if (l.startsWith("@@")) return `<span class="hunk">${e}</span>`;
      if (l.startsWith("+") && !l.startsWith("+++")) return `<span class="add">${e}</span>`;
      if (l.startsWith("-") && !l.startsWith("---")) return `<span class="del">${e}</span>`;
      return `<span class="ctx">${e}</span>`;
    })
    .join("");
}

function setToolBody(card, text) {
  const pre = card.querySelector(".tool-body pre");
  if (/^(---|已编辑)/m.test(text) && /^@@/m.test(text)) {
    pre.className = "diff";
    pre.innerHTML = renderDiff(text);
  } else {
    pre.className = "";
    pre.textContent = text;
  }
}

function setToolResult(card, ok, output) {
  const st = card.querySelector(".state");
  st.className = "state " + (ok ? "ok" : "err");
  st.textContent = ok ? "✓ 完成" : "✗ 失败";
  setToolBody(card, output);
  card.querySelector(".approval")?.remove();
}

function showApproval(card, id, name, preview) {
  card.classList.remove("collapsed");
  const st = card.querySelector(".state");
  st.className = "state wait";
  st.textContent = "等待确认";
  setToolBody(card, preview);
  const bar = document.createElement("div");
  bar.className = "approval";
  const q = name === "run_command" ? "允许执行这个命令吗？" : "允许进行这个修改吗？";
  bar.innerHTML = `<span class="q">${q}</span>
    <button class="btn small ok">允许 (Y)</button>
    <button class="btn small">拒绝 (N)</button>`;
  const [yes, no] = bar.querySelectorAll("button");
  const decide = async (approved) => {
    yes.disabled = no.disabled = true;
    pendingApproval = null;
    await api("POST", "/api/approve", { sessionId: state.sessionId, callId: id, approved });
  };
  yes.onclick = () => decide(true);
  no.onclick = () => decide(false);
  pendingApproval = decide;
  card.appendChild(bar);
  scrollBottom(true);
}
let pendingApproval = null;

function addError(message) {
  const turn = ensureTurn();
  finishText(turn);
  const div = document.createElement("div");
  div.className = "error-box";
  div.textContent = message;
  turn.el.appendChild(div);
  scrollBottom();
}

function setStatus(text) {
  $("#status").textContent = text;
}

function setBusy(b) {
  state.busy = b;
  $("#send").classList.toggle("hidden", b);
  $("#stop").classList.toggle("hidden", !b);
}

// ------------------------------------------------------------------ chat
function handleEvent(e) {
  const turn = ensureTurn();
  switch (e.type) {
    case "text":
      if (!turn.text) newTextBlock(turn);
      turn.textBuf += e.delta;
      scheduleRender();
      break;
    case "reasoning":
      if (!turn.reasoning) {
        const d = document.createElement("details");
        d.className = "reasoning";
        d.innerHTML = `<summary>💭 思考过程</summary><div class="body"></div>`;
        turn.el.appendChild(d);
        turn.reasoning = d;
        turn.reasoningBuf = "";
      }
      turn.reasoningBuf += e.delta;
      scheduleRender();
      break;
    case "tool_call":
      finishText(turn);
      turn.reasoning = null;
      addToolCard(turn, e.id, e.name, e.args);
      setStatus(`正在执行 ${e.name}…`);
      break;
    case "approval_request":
      showApproval(state.tools.get(e.id), e.id, e.name, e.preview);
      setStatus("等待你的确认…");
      break;
    case "approval_result": {
      const card = state.tools.get(e.id);
      card?.querySelector(".approval")?.remove();
      if (card && e.approved) {
        const st = card.querySelector(".state");
        st.className = "state running";
        st.textContent = "运行中…";
      }
      break;
    }
    case "tool_result": {
      const card = state.tools.get(e.id);
      if (card) setToolResult(card, e.ok, e.output);
      setStatus("思考中…");
      break;
    }
    case "usage":
      state.usage.prompt = e.prompt;
      state.usage.completion += e.completion;
      break;
    case "error":
      addError(e.message);
      break;
    case "done":
      finishText(turn);
      turn.reasoning = null;
      setStatus(
        (e.reason === "aborted" ? "已停止。" : "") +
          (state.usage.prompt ? `上下文 ${state.usage.prompt.toLocaleString()} tokens · 本会话输出 ${state.usage.completion.toLocaleString()} tokens` : ""),
      );
      break;
  }
}

async function send(text) {
  text = text.trim();
  if (!text || state.busy) return;
  if (!state.sessionId) await newSession();
  $("#input").value = "";
  autoGrow();
  addUser(text);
  state.turn = null;
  setBusy(true);
  setStatus("思考中…");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.sessionId, message: text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || res.statusText);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try { handleEvent(JSON.parse(line.slice(6))); } catch (err) { console.error(err); }
          }
        }
      }
    }
  } catch (err) {
    addError("请求失败：" + err.message);
    setStatus("");
  } finally {
    setBusy(false);
    state.turn = null;
    pendingApproval = null;
    loadSessions();
    refreshTree();
  }
}

// ------------------------------------------------------------------ file tree
async function renderTree(container, path) {
  const items = await api("GET", `/api/tree?path=${encodeURIComponent(path)}`);
  container.innerHTML = "";
  for (const it of items) {
    const node = document.createElement("div");
    node.className = "node";
    node.textContent = (it.dir ? "▸ " : "  ") + it.name;
    container.appendChild(node);
    if (it.dir) {
      const children = document.createElement("div");
      children.className = "children hidden";
      container.appendChild(children);
      node.onclick = async () => {
        const open = children.classList.toggle("hidden") === false;
        node.textContent = (open ? "▾ " : "▸ ") + it.name;
        if (open) await renderTree(children, it.path);
      };
    } else {
      node.onclick = () => viewFile(it.path);
    }
  }
}

function refreshTree() {
  renderTree($("#tree"), ".").catch((e) => ($("#tree").textContent = e.message));
}

async function viewFile(path) {
  try {
    const f = await api("GET", `/api/file?path=${encodeURIComponent(path)}`);
    $("#modalTitle").textContent = f.path;
    $("#modalBody").innerHTML = f.content
      .split("\n")
      .map((l, i) => `<span class="ln">${i + 1}</span>${escapeHtml(l)}`)
      .join("\n");
  } catch (e) {
    $("#modalTitle").textContent = path;
    $("#modalBody").textContent = e.message;
  }
  $("#modal").classList.remove("hidden");
}

// ------------------------------------------------------------------ input
function autoGrow() {
  const t = $("#input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 240) + "px";
}

$("#input").addEventListener("input", autoGrow);
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send($("#input").value);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#modal").classList.add("hidden");
  if (pendingApproval && document.activeElement !== $("#input")) {
    if (e.key === "y" || e.key === "Y") pendingApproval(true);
    if (e.key === "n" || e.key === "N") pendingApproval(false);
  }
});
$("#send").onclick = () => send($("#input").value);
$("#stop").onclick = () => api("POST", "/api/stop", { sessionId: state.sessionId });
$("#newSession").onclick = () => !state.busy && newSession();
$("#refreshTree").onclick = refreshTree;
$("#modalClose").onclick = () => $("#modal").classList.add("hidden");
$("#modal").onclick = (e) => e.target.id === "modal" && $("#modal").classList.add("hidden");
$("#toggleSidebar").onclick = () => $("#sidebar").classList.toggle("open");
$("#autoApprove").onchange = async (e) => {
  if (!state.sessionId) await newSession();
  await api("POST", "/api/settings", { sessionId: state.sessionId, autoApprove: e.target.checked });
};
document.querySelectorAll(".suggestions button").forEach((b) => (b.onclick = () => send(b.textContent)));

// ------------------------------------------------------------------ init
(async function init() {
  const info = await api("GET", "/api/info");
  $("#modelChip").textContent = info.model;
  $("#workspace").textContent = info.workspace;
  $("#workspace").title = info.workspace;
  if (!info.hasKey) setStatus("⚠ 未配置 OPENAI_API_KEY：请复制 .env.example 为 .env 并填写后重启");
  const list = await api("GET", "/api/sessions");
  if (list.length) await openSession(list[0].id);
  else await newSession();
  refreshTree();
})();
