import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyConfig, parseModelsConfig, resolveRole, buildBody, publicView, upsertEnvLine, ROLES } from "../src/models.js";

test("legacyConfig：没有 models.json 时按 .env 推导，与旧版行为一致", () => {
  const cfg = legacyConfig({ OPENAI_BASE_URL: "https://api.x.com/v1/", MODEL: "big", MODEL_REVIEW: "rev", TEMPERATURE: "0.7", MAX_TOKENS: "4096" });
  assert.equal(cfg.providers.default.baseURL, "https://api.x.com/v1");
  assert.equal(cfg.providers.default.apiKeyEnv, "OPENAI_API_KEY");
  assert.equal(cfg.roles.writer.model, "big");
  assert.equal(cfg.roles.writer.temperature, 0.7);
  assert.equal(cfg.roles.writer.maxTokens, 4096);
  assert.equal(cfg.roles.review.model, "rev");
  assert.equal(cfg.roles.memory.model, "big", "未单独配置的角色回落到 MODEL");
  assert.equal(cfg.roles.summary.model, "big");
  assert.deepEqual(Object.keys(cfg.roles).sort(), [...ROLES].sort());
});

test("parseModelsConfig：角色引用了不存在的服务商时报错", () => {
  const base = legacyConfig({});
  assert.throws(
    () => parseModelsConfig({ ...base, roles: { ...base.roles, review: { ...base.roles.review, provider: "nope" } } }),
    /review.*nope/,
  );
});

test("parseModelsConfig：缺少角色时用第一个角色补齐，非法服务商 id / 环境变量名被拒绝", () => {
  const cfg = parseModelsConfig({
    providers: { ds: { baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DS_KEY" } },
    roles: { writer: { provider: "ds", model: "deepseek-chat" } },
  });
  assert.equal(cfg.roles.review.model, "deepseek-chat");
  assert.equal(cfg.roles.writer.temperature, 0.85, "角色默认温度");
  assert.equal(cfg.roles.memory.temperature, 0.2);
  assert.throws(() => parseModelsConfig({ providers: { "bad id": { baseURL: "https://a/v1", apiKeyEnv: "K" } }, roles: {} }));
  assert.throws(() => parseModelsConfig({ providers: { ok: { baseURL: "https://a/v1", apiKeyEnv: "lower-case" } }, roles: {} }));
});

test("resolveRole：按角色取服务商地址、密钥和参数", () => {
  const cfg = parseModelsConfig({
    providers: {
      ds: { baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DS_KEY" },
      qw: { baseURL: "https://qwen/v1", apiKeyEnv: "QW_KEY" },
    },
    roles: { writer: { provider: "ds", model: "deepseek-chat" }, review: { provider: "qw", model: "qwen-max", temperature: 0.1 } },
  });
  const r = resolveRole(cfg, "review", { QW_KEY: "sk-q" });
  assert.equal(r.baseURL, "https://qwen/v1");
  assert.equal(r.apiKey, "sk-q");
  assert.equal(r.model, "qwen-max");
  assert.equal(r.temperature, 0.1);
  assert.equal(resolveRole(cfg, "writer", {}).apiKey, "");
});

test("buildBody：合并额外参数，推理模型可不传 temperature", () => {
  const cfg = parseModelsConfig({
    providers: { p: { baseURL: "https://a/v1", apiKeyEnv: "K" } },
    roles: { writer: { provider: "p", model: "m", maxTokens: 100, params: { reasoning_effort: "high" } }, review: { provider: "p", model: "r", omitTemperature: true } },
  });
  const w = buildBody(resolveRole(cfg, "writer", {}), [{ role: "user", content: "hi" }]);
  assert.equal(w.model, "m");
  assert.equal(w.temperature, 0.85);
  assert.equal(w.max_tokens, 100);
  assert.equal(w.reasoning_effort, "high");
  assert.equal(w.stream, true);
  const r = buildBody(resolveRole(cfg, "review", {}), [{ role: "user", content: "hi" }]);
  assert.equal("temperature" in r, false);
});

test("publicView：不包含密钥，只标注是否已配置", () => {
  const cfg = legacyConfig({});
  const v = publicView(cfg, { OPENAI_API_KEY: "sk-secret" }, "legacy");
  assert.equal(v.providers.default.hasKey, true);
  assert.equal(JSON.stringify(v).includes("sk-secret"), false);
  assert.equal(v.source, "legacy");
});

test("upsertEnvLine：更新已有变量或追加新变量，保留其他内容", () => {
  const text = "# 注释\nOPENAI_API_KEY=old\nPORT=3000\n";
  assert.equal(upsertEnvLine(text, "OPENAI_API_KEY", "new"), "# 注释\nOPENAI_API_KEY=new\nPORT=3000\n");
  assert.equal(upsertEnvLine(text, "QW_KEY", "sk-1"), "# 注释\nOPENAI_API_KEY=old\nPORT=3000\nQW_KEY=sk-1\n");
  assert.equal(upsertEnvLine("", "A", "1"), "A=1\n");
  assert.throws(() => upsertEnvLine(text, "A", "有\n换行"), /换行/);
});

test("不需要密钥的服务商（如本地 Ollama）：apiKeyEnv 留空", () => {
  const cfg = parseModelsConfig({
    providers: { ollama: { baseURL: "http://localhost:11434/v1", apiKeyEnv: "" } },
    roles: { writer: { provider: "ollama", model: "qwen2.5:14b" } },
  });
  const r = resolveRole(cfg, "writer", {});
  assert.equal(r.needsKey, false);
  assert.equal(r.apiKey, "");
  assert.equal(publicView(cfg, {}, "file").providers.ollama.hasKey, true);
  assert.equal(resolveRole(legacyConfig({}), "writer", {}).needsKey, true);
});
