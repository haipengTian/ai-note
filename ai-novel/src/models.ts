/**
 * 模型配置：多个服务商 + 按任务角色路由（纯函数部分，读写文件见 models-store.ts）。
 *
 *   providers：服务商（接口地址 + 存放密钥的环境变量名，密钥本身只在 .env 里）
 *   roles：每个任务角色用哪个服务商的哪个模型、温度、最大输出、额外参数
 */
import { z } from "zod";

export const ROLES = ["writer", "planner", "review", "memory", "summary"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; desc: string; temperature: number }> = {
  writer: { label: "正文写作", desc: "写正文、续写、按要求修改、按审校意见修订。决定文笔，建议用最好的模型", temperature: 0.85 },
  planner: { label: "策划", desc: "世界观、人物、总纲、章节大纲", temperature: 0.8 },
  review: { label: "审校", desc: "章节审稿打分。建议用与正文不同家的模型，减少“自己审自己”的盲区", temperature: 0.3 },
  memory: { label: "记忆抽取", desc: "从正文抽取状态变化、伏笔。决定长篇一致性，不建议用太弱的模型", temperature: 0.2 },
  summary: { label: "摘要", desc: "分段摘要、全书梗概。可以用便宜的模型", temperature: 0.4 },
};

const DEFAULT_MAX_TOKENS = 8192;

const ProviderSchema = z.object({
  baseURL: z
    .string()
    .url("接口地址不是合法 URL")
    .transform((s) => s.replace(/\/+$/, "")),
  /** 存放密钥的环境变量名；留空表示该服务商不需要密钥（如本地 Ollama） */
  apiKeyEnv: z
    .string()
    .regex(/^([A-Z][A-Z0-9_]*)?$/, "环境变量名只能包含大写字母、数字和下划线")
    .default(""),
});

const RoleSchema = z.object({
  provider: z.string().min(1),
  model: z.string().trim().min(1, "模型名不能为空"),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  /** 推理类模型不接受 temperature 时勾选 */
  omitTemperature: z.boolean().optional(),
  /** 合并进请求体的额外参数；值为 null 表示从请求体中去掉该字段（如 "max_tokens": null） */
  params: z.record(z.unknown()).optional(),
});

const ConfigSchema = z.object({
  providers: z.record(z.string().regex(/^[\w-]+$/, "服务商 id 只能包含字母、数字、下划线和连字符"), ProviderSchema),
  roles: z.record(z.enum(ROLES), RoleSchema),
});

export type Provider = z.output<typeof ProviderSchema>;
export type RoleConfig = z.output<typeof RoleSchema> & { temperature: number; maxTokens: number };
export interface ModelsConfig {
  providers: Record<string, Provider>;
  roles: Record<Role, RoleConfig>;
}

export type Env = Record<string, string | undefined>;

/** 校验并补齐：缺少的角色复制第一个已配置角色的服务商和模型，温度用各角色默认值 */
export function parseModelsConfig(raw: unknown): ModelsConfig {
  const cfg = ConfigSchema.parse(raw);
  const given = ROLES.filter((r) => cfg.roles[r]);
  if (!given.length) throw new Error("至少要配置一个任务角色");
  const fallback = cfg.roles[given[0]]!;
  const roles = Object.fromEntries(
    ROLES.map((r) => {
      const rc = cfg.roles[r] ?? { provider: fallback.provider, model: fallback.model, omitTemperature: fallback.omitTemperature, params: fallback.params };
      if (!cfg.providers[rc.provider]) throw new Error(`角色 ${r} 引用的服务商 ${rc.provider} 不存在`);
      return [r, { ...rc, temperature: rc.temperature ?? ROLE_INFO[r].temperature, maxTokens: rc.maxTokens ?? DEFAULT_MAX_TOKENS }];
    }),
  ) as Record<Role, RoleConfig>;
  return { providers: cfg.providers, roles };
}

/** 没有 models.json 时，按旧版 .env 配置推导（行为与 v0.3 之前一致） */
export function legacyConfig(env: Env): ModelsConfig {
  const model = env.MODEL || "gpt-4.1";
  const num = (v: string | undefined, def: number) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : def);
  const maxTokens = num(env.MAX_TOKENS, DEFAULT_MAX_TOKENS);
  const pick: Record<Role, string> = {
    writer: model,
    planner: model,
    review: env.MODEL_REVIEW || model,
    memory: env.MODEL_MEMORY || model,
    summary: env.MODEL_FAST || model,
  };
  return parseModelsConfig({
    providers: { default: { baseURL: env.OPENAI_BASE_URL || "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" } },
    roles: Object.fromEntries(
      ROLES.map((r) => [
        r,
        {
          provider: "default",
          model: pick[r],
          temperature: r === "writer" ? num(env.TEMPERATURE, ROLE_INFO.writer.temperature) : ROLE_INFO[r].temperature,
          maxTokens,
        },
      ]),
    ),
  });
}

export interface ResolvedModel extends RoleConfig {
  role: Role;
  baseURL: string;
  apiKey: string;
  /** 服务商是否需要密钥 */
  needsKey: boolean;
}

export function resolveRole(cfg: ModelsConfig, role: Role, env: Env): ResolvedModel {
  const rc = cfg.roles[role];
  const p = cfg.providers[rc.provider];
  return { ...rc, role, baseURL: p.baseURL, apiKey: p.apiKeyEnv ? env[p.apiKeyEnv] ?? "" : "", needsKey: Boolean(p.apiKeyEnv) };
}

/** 构造 Chat Completions 请求体 */
export function buildBody(r: ResolvedModel, messages: { role: string; content: string }[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: r.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: r.maxTokens,
    ...(r.omitTemperature ? {} : { temperature: r.temperature }),
    ...(r.params ?? {}),
  };
  for (const [k, v] of Object.entries(body)) if (v === null) delete body[k];
  return body;
}

/** 给前端看的配置：不含密钥，只标注是否已配置 */
export function publicView(cfg: ModelsConfig, env: Env, source: "file" | "legacy") {
  return {
    source,
    providers: Object.fromEntries(Object.entries(cfg.providers).map(([id, p]) => [id, { ...p, hasKey: !p.apiKeyEnv || Boolean(env[p.apiKeyEnv]) }])),
    roles: cfg.roles,
    roleInfo: ROLE_INFO,
  };
}

/** 在 .env 文本中设置一个变量（已存在则替换，否则追加），返回新文本 */
export function upsertEnvLine(text: string, name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("密钥中不能包含换行");
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  if (re.test(text)) return text.replace(re, () => line);
  const base = text && !text.endsWith("\n") ? text + "\n" : text;
  return `${base}${line}\n`;
}
