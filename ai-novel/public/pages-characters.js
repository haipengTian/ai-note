/* global $, $$, esc, state, aiBar, bindJobButtons, markDirty, patchNovel, renderStateHtml */
// ---------------------------------------------------------------- 人物
// 人物卡只编辑固定设定和初始状态；“当前状态”由记忆（状态事件）推导，只读，修正请到记忆页。

/** "键：值" 每行一条 → 对象 */
function parseAttrs(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const formatAttrs = (attrs) =>
  Object.entries(attrs || {})
    .map(([k, v]) => `${k}：${v}`)
    .join("\n");

function characters() {
  const n = state.novel;
  $("#main").innerHTML = `
    <div class="head"><h2>人物</h2><span class="muted">${n.characters.length} 人</span><span class="grow"></span>
      <button class="btn" id="addChar">＋ 添加人物</button>
      <button class="btn primary" id="saveChars">保存</button></div>
    <p class="hint">这里编辑人物的固定设定和<b>初始状态</b>。每章写完后 AI 会把状态变化（境界、位置、物品、关系、得知的秘密……）记为带原文出处的事件，「当前状态」由此自动推导；需要修正时到「记忆」页操作。</p>
    ${aiBar("characters", n.characters.length ? "AI 完善/补充人物" : "AI 生成人物", "（可选）额外要求，例如：女主是反派阵营的卧底")}
    <div class="chars" id="chars">${n.characters.map(charCard).join("") || '<p class="muted">暂无人物</p>'}</div>`;
  markDirty($("#chars"));
  bindJobButtons();
  $("#addChar").onclick = () => {
    $("#chars").querySelector("p.muted")?.remove();
    $("#chars").insertAdjacentHTML("afterbegin", charCard({ id: "", name: "", aliases: [], role: "配角", profile: "", initial: { attrs: {} } }));
    markDirty($("#chars"));
    bindCharDel();
    state.dirty = true;
  };
  $("#saveChars").onclick = () =>
    patchNovel({
      characters: $$(".char").map((el) => ({
        id: el.dataset.id || undefined,
        name: $(".c-name", el).value,
        aliases: $(".c-aliases", el).value.split(/[,，、\s]+/).filter(Boolean),
        role: $(".c-role", el).value,
        profile: $(".c-profile", el).value,
        initialAttrs: parseAttrs($(".c-initial", el).value),
      })),
    });
  bindCharDel();
}

function charCard(c) {
  const n = state.novel;
  const cur = c.id ? n.currentStates?.[c.id] : null;
  const badge = c.source === "ai" && c.firstAppearance ? `<span class="tag">第${c.firstAppearance}章登场</span>` : "";
  return `<div class="card char" data-id="${esc(c.id)}">
    <div class="row"><input type="text" class="c-name grow" value="${esc(c.name)}" placeholder="姓名" />
      <input type="text" class="c-role" value="${esc(c.role)}" placeholder="角色" style="width:90px" />
      <button class="icon-btn c-del" title="删除">✕</button></div>
    <div class="row small"><input type="text" class="c-aliases grow" value="${esc((c.aliases || []).join("，"))}" placeholder="别称（逗号分隔，用于识别正文里的称呼）" />${badge}</div>
    <textarea class="c-profile" placeholder="人物设定：身份、外貌、性格、说话方式、背景、目标、能力、关系">${esc(c.profile)}</textarea>
    <label class="field"><span>初始状态（每行一条「键：值」）</span><textarea class="c-initial state" placeholder="境界/实力：炼气三层&#10;所在地：青云宗">${esc(formatAttrs(c.initial?.attrs))}</textarea></label>
    ${cur ? `<div class="field"><span>当前状态（截至第 ${n.stateAt} 章开写前，只读）</span><div class="state-view small">${renderStateHtml(n, cur)}</div></div>` : ""}
  </div>`;
}

function bindCharDel() {
  $$(".c-del").forEach(
    (b) =>
      (b.onclick = () => {
        b.closest(".char").remove();
        state.dirty = true;
      }),
  );
}
