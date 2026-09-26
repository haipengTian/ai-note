/**
 * 模型设置：读取 / 保存 models.json、设置密钥（写入 .env）、测试连接。
 * 密钥永远不会通过接口返回。
 */
import { z, ZodError } from "zod";
import { parseModelsConfig, resolveRole, ROLES } from "../models.js";
import { currentEnv, loadModels, modelsView, saveModels, setEnvKey } from "../models-store.js";
import { testModel } from "../llm.js";
import { HttpError, parseBody, body, type Route } from "./http.js";

function readable(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "配置"}：${i.message}`).join("；");
  return (e as Error).message;
}

/** 配置校验失败转成 400 */
function asConfig(raw: unknown) {
  try {
    return parseModelsConfig(raw);
  } catch (e) {
    throw new HttpError(400, `模型配置有误：${readable(e)}`);
  }
}

const KeySchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "环境变量名只能包含大写字母、数字和下划线"),
  value: z.string().trim().min(1, "密钥不能为空"),
});

const TestSchema = z.object({
  role: z.enum(ROLES),
  /** 未保存的配置（网页表单当前内容）；不传则用已保存的配置 */
  config: z.unknown().optional(),
});

export const modelRoutes: Route[] = [
  ["GET", /^\/api\/models$/, async () => modelsView()],

  [
    "PUT",
    /^\/api\/models$/,
    async ({ req }) => {
      await saveModels(asConfig(await body(req)));
      return modelsView();
    },
  ],

  [
    "POST",
    /^\/api\/models\/key$/,
    async ({ req }) => {
      const { name, value } = await parseBody(req, KeySchema);
      await setEnvKey(name, value);
      return modelsView();
    },
  ],

  [
    "POST",
    /^\/api\/models\/test$/,
    async ({ req }) => {
      const b = await parseBody(req, TestSchema);
      const cfg = b.config === undefined ? loadModels().cfg : asConfig(b.config);
      return testModel(resolveRole(cfg, b.role, currentEnv()));
    },
  ],
];
