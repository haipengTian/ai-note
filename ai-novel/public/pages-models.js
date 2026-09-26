/* global $, $$, esc, api, toast, state, refreshUsage */
// ---------------------------------------------------------------- 模型设置
// 服务商（接口地址 + 密钥）和任务角色（用哪个模型）。保存后写入 models.json，也可以直接改该文件。

const PROVIDER_PRESETS = [
  ["deepseek", "DeepSeek", "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"],
  ["qwen", "通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", "DASHSCOPE_API_KEY"],
  ["kimi", "Kimi", "https://api.moonshot.cn/v1", "MOONSHOT_API_KEY"],
  ["openai", "OpenAI", "https://api.openai.com/v1", "OPENAI_API_KEY"],
  ["ollama", "本地 Ollama（无需密钥）", "http://localhost:11434/v1", ""],
];

let modelsState = null;

async function renderModels() {
  modelsState = await api("GET", "/api/models");
  const v = modelsState;
  app.innerHTML = `
  <div class="home models">
    <div class="head"><h2>模型设置</h2><span class="grow"></span>
      <a class="btn" href="javascript:history.back()">返回</a>
      <button class="btn primary" id="saveModels">保存</button></div>
    <p class="hint">${
      v.source === "file"
        ? `配置保存在 <code>${esc(v.file)}</code>，也可以直接编辑该文件（保存后自动生效，无需重启）。`
        : `当前按 <code>.env</code> 中的 OPENAI_BASE_URL / MODEL 等推导。点「保存」后会生成 <code>${esc(v.file)}</code>，之后以该文件为准。`
    } 密钥只保存在 <code>.env</code>，不会写进 models.json，也不会显示在页面上。</p>

    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:8px"><b>服务商</b><span class="muted small">任意 OpenAI 兼容接口</span><span class="grow"></span>
        <select id="presetSel"><option value="">＋ 添加服务商…</option>${PROVIDER_PRESETS.map((p, i) => `<option value="${i}">${esc(p[1])}</option>`).join("")}<option value="custom">自定义</option></select></div>
      <div id="providers">${Object.entries(v.providers).map(([id, p]) => providerRow(id, p)).join("")}</div>
    </div>

    <div class="card">
      <b>任务角色</b> <span class="muted small">每类任务可以用不同服务商的不同模型</span>
      <div id="roles">${Object.keys(v.roleInfo).map((r) => roleRow(r, v.roles[r])).join("")}</div>
    </div>
  </div>`;
  bindModels();
}

function providerRow(id, p) {
  const keyCell = p.apiKeyEnv
    ? `<span class="tag ${p.hasKey ? "" : "warn"}">${p.hasKey ? "密钥已配置" : "未配置密钥"}</span>
       <input type="password" class="p-key" placeholder="${p.hasKey ? "输入新密钥可替换" : "粘贴密钥"}" autocomplete="off" style="width:180px" />
       <button class="btn small p-savekey">保存密钥</button>`
    : `<span class="tag">无需密钥</span>`;
  return `<div class="provider" data-id="${esc(id)}">
    <div class="row">
      <input type="text" class="p-id" value="${esc(id)}" placeholder="id，如 deepseek" style="width:120px" ${p.saved === false ? "" : "readonly"} />
      <input type="text" class="p-url grow" value="${esc(p.baseURL)}" placeholder="接口地址，如 https://api.deepseek.com/v1" />
      <input type="text" class="p-env" value="${esc(p.apiKeyEnv)}" placeholder="密钥环境变量名（可空）" style="width:170px" />
      <button class="icon-btn p-del" title="删除">✕</button>
    </div>
    <div class="row small" style="margin-top:6px">${keyCell}</div>
  </div>`;
}

function roleRow(role, rc) {
  const info = modelsState.roleInfo[role];
  const providerIds = Object.keys(modelsState.providers);
  return `<div class="role" data-role="${role}">
    <div class="row"><b style="width:72px">${esc(info.label)}</b><span class="muted small grow">${esc(info.desc)}</span></div>
    <div class="row" style="margin-top:6px">
      <select class="r-provider">${providerIds.map((id) => `<option ${id === rc.provider ? "selected" : ""}>${esc(id)}</option>`).join("")}</select>
      <input type="text" class="r-model grow" value="${esc(rc.model)}" placeholder="模型名，如 deepseek-chat" />
      <label class="small">温度 <input type="number" class="r-temp" value="${rc.temperature}" min="0" max="2" step="0.05" style="width:64px" /></label>
      <label class="small">最大输出 <input type="number" class="r-max" value="${rc.maxTokens}" min="1" step="512" style="width:84px" /></label>
      <label class="small" title="部分推理模型不接受 temperature 参数"><input type="checkbox" class="r-notemp" ${rc.omitTemperature ? "checked" : ""} /> 不传温度</label>
      <button class="btn small r-test">测试</button>
    </div>
    <details class="small" style="margin-top:4px"><summary class="muted">额外参数（JSON，可选）</summary>
      <textarea class="r-params" rows="2" placeholder='例：{"reasoning_effort": "high"}；值为 null 表示不传该字段，如 {"max_tokens": null}'>${rc.params ? esc(JSON.stringify(rc.params)) : ""}</textarea></details>
    <div class="small r-result"></div>
  </div>`;
}

/** 从表单收集配置；参数 JSON 写错时抛错 */
function collectModels() {
  const providers = {};
  for (const el of $$(".provider")) {
    const id = $(".p-id", el).value.trim();
    if (!id) throw new Error("服务商 id 不能为空");
    providers[id] = { baseURL: $(".p-url", el).value.trim(), apiKeyEnv: $(".p-env", el).value.trim() };
  }
  const roles = {};
  for (const el of $$(".role")) {
    const raw = $(".r-params", el).value.trim();
    let params;
    if (raw) {
      try {
        params = JSON.parse(raw);
      } catch {
        throw new Error(`「${modelsState.roleInfo[el.dataset.role].label}」的额外参数不是合法 JSON`);
      }
    }
    roles[el.dataset.role] = {
      provider: $(".r-provider", el).value,
      model: $(".r-model", el).value.trim(),
      temperature: Number($(".r-temp", el).value),
      maxTokens: Number($(".r-max", el).value),
      omitTemperature: $(".r-notemp", el).checked || undefined,
      params,
    };
  }
  return { providers, roles };
}

function bindModels() {
  $("#saveModels").onclick = async () => {
    try {
      modelsState = await api("PUT", "/api/models", collectModels());
      toast("模型配置已保存");
      refreshUsage();
      renderModels();
    } catch (e) {
      toast(e.message, 5000);
    }
  };

  $("#presetSel").onchange = (e) => {
    const val = e.target.value;
    e.target.value = "";
    if (!val) return;
    const [id, , baseURL, apiKeyEnv] = val === "custom" ? ["", "", "", ""] : PROVIDER_PRESETS[Number(val)];
    if (id && $(`.provider[data-id="${id}"]`)) return toast(`已有服务商 ${id}`);
    $("#providers").insertAdjacentHTML("beforeend", providerRow(id, { baseURL, apiKeyEnv, hasKey: !apiKeyEnv, saved: false }));
    // 新服务商加入角色下拉框（保存后生效）
    const newId = id || "custom";
    if (!id) $("#providers .provider:last-child .p-id").value = newId;
    $$(".r-provider").forEach((s) => s.insertAdjacentHTML("beforeend", `<option>${esc(newId)}</option>`));
    bindProviderRows();
    toast("填好后点「保存」；密钥可以在保存服务商后填写");
  };

  $$(".r-test").forEach(
    (b) =>
      (b.onclick = async () => {
        const row = b.closest(".role");
        const out = $(".r-result", row);
        out.innerHTML = '<span class="muted">测试中…</span>';
        try {
          const r = await api("POST", "/api/models/test", { role: row.dataset.role, config: collectModels() });
          out.innerHTML = r.ok
            ? `<span class="ok-text">✓ 连接成功（${r.ms} ms）：${esc(r.reply)}</span>`
            : `<span class="danger-text">✗ ${esc(r.error)}</span>`;
        } catch (e) {
          out.innerHTML = `<span class="danger-text">✗ ${esc(e.message)}</span>`;
        }
      }),
  );
  bindProviderRows();
}

function bindProviderRows() {
  $$(".p-del").forEach(
    (b) =>
      (b.onclick = () => {
        const id = $(".p-id", b.closest(".provider")).value;
        const used = $$(".r-provider").some((s) => s.value === id);
        if (used) return toast(`还有任务角色在使用 ${id}，请先改掉`);
        b.closest(".provider").remove();
      }),
  );
  $$(".p-savekey").forEach(
    (b) =>
      (b.onclick = async () => {
        const row = b.closest(".provider");
        const name = $(".p-env", row).value.trim();
        const value = $(".p-key", row).value.trim();
        if (!name) return toast("请先填写密钥环境变量名");
        if (!value) return toast("请粘贴密钥");
        try {
          await api("POST", "/api/models/key", { name, value });
          // 只更新这一行的状态，不重新渲染，避免丢掉表单里未保存的修改
          const tag = $(".tag", row);
          tag.textContent = "密钥已配置";
          tag.classList.remove("warn");
          $(".p-key", row).value = "";
          toast(`已写入 .env 的 ${name}`);
          refreshUsage();
        } catch (e) {
          toast(e.message, 5000);
        }
      }),
  );
}
