/**
 * 模拟的 OpenAI 兼容模型服务（开发/端到端测试用，不消耗额度）。
 * 按提示词里的「# 任务：xxx」返回固定内容，流式输出。
 *
 *   npx tsx scripts/mock-llm.ts            # 默认端口 3999
 *   OPENAI_BASE_URL=http://127.0.0.1:3999/v1 OPENAI_API_KEY=mock npm start
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 3999);

function chapterText(n: number): string {
  const para = [
    `夜色压下来的时候，林凡还跪在后山的石台上。`,
    `他闭着眼，体内灵气一圈圈冲刷经脉，终于突破到了炼气${n + 3}层。`,
    `苏晴从石阶上走下来，把一个布袋丢给他：“宗门发的月例，${n * 10}块灵石，别又拿去换酒。”`,
    `林凡接过布袋，掂了掂，咧嘴一笑。`,
    `远处钟声响了三下，王长老的声音从云层里压下来：“林凡，明日辰时，到执法堂来。”`,
    `苏晴脸色一变。林凡把布袋塞进怀里，站起身，看着执法堂的方向没有说话。`,
  ];
  // 凑够篇幅，避免触发续写
  return Array.from({ length: 12 }, (_, i) => para.map((p) => (i ? p.replace("。", `（${i}）。`) : p)).join("\n\n")).join("\n\n");
}

function respond(task: string, prompt: string): string {
  const num = (re: RegExp) => Number(prompt.match(re)?.[1] ?? 1);
  if (task.includes("设计世界观")) return "## 一句话卖点\n废柴逆袭。\n\n## 力量体系\n炼气、筑基、金丹、元婴。";
  if (task.includes("设计人物"))
    return JSON.stringify({
      characters: [
        { name: "林凡", aliases: ["林师弟"], role: "主角", profile: "青云宗外门弟子，嘴硬心软。", attrs: { "境界/实力": "炼气三层", 所在地: "青云宗" } },
        { name: "苏晴", aliases: ["苏师姐"], role: "女主", profile: "内门师姐，外冷内热。", attrs: { "境界/实力": "筑基初期" } },
        { name: "王长老", aliases: [], role: "反派", profile: "执法堂长老，心机深沉。", attrs: { "境界/实力": "金丹" } },
      ],
    });
  if (task.includes("设计全书总纲")) return "## 主线概述\n林凡从外门弟子一路逆袭。\n\n### 第1卷 外门风云（第 1-40 章）\n- 本卷目标：进入内门";
  if (task.includes("规划第")) {
    const [, from, to] = task.match(/第 (\d+)~(\d+) 章/) ?? [0, 1, 10];
    const chapters = Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => ({
      title: `风起第${Number(from) + i}回`,
      outline: `林凡修炼突破，苏晴送来灵石，王长老传唤。`,
      characters: ["林凡", "苏晴", "王长老"],
    }));
    return "```json\n" + JSON.stringify({ chapters }) + "\n```";
  }
  if (task.includes("撰写第")) return chapterText(num(/撰写第 (\d+) 章/));
  if (task.includes("续写")) return "林凡深吸了一口气，推门而出。";
  if (task.includes("章节审校")) return JSON.stringify({ score: 86, verdict: "pass", issues: [{ dimension: "AI腔", severity: "low", quote: "咧嘴一笑", problem: "表情描写略模板化", suggestion: "换成动作" }], strengths: ["节奏紧凑"] });
  if (task.includes("按审稿意见修订") || task.includes("按要求修改")) return chapterText(num(/第 (\d+) 章/));
  if (task.includes("章节记忆抽取")) {
    const n = num(/# 第 (\d+) 章《/);
    return JSON.stringify({
      summary: `第${n}章：林凡突破炼气${n + 3}层，苏晴送来灵石，王长老传唤他去执法堂。`,
      events: [
        { character: "林凡", kind: "attr", key: "境界/实力", op: "set", value: `炼气${n + 3}层`, evidence: `终于突破到了炼气${n + 3}层` },
        { character: "林凡", kind: "inventory", key: "灵石", op: "add", value: n * 10, evidence: `${n * 10}块灵石，别又拿去换酒` },
        { character: "林凡", kind: "attr", key: "所在地", op: "set", value: "后山", evidence: "林凡还跪在后山的石台上" },
        { character: "林凡", kind: "attr", key: "伤势", op: "set", value: "重伤", evidence: "林凡被一剑刺穿了胸口" },
      ],
      newCharacters: n === 1 ? [{ name: "执法堂弟子", role: "配角", profile: "路人", attrs: {} }] : [],
      newSecrets: [],
      hooks: n === 1 ? [{ op: "plant", content: "王长老为何传唤林凡", type: "mystery", importance: "major" }] : [],
    });
  }
  if (task.includes("分段剧情摘要")) return "林凡连续突破，引起王长老注意。";
  if (task.includes("更新全书梗概")) return "林凡从外门弟子开始修炼。";
  return "（mock：未识别的任务）";
}

http
  .createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const prompt: string = body.messages.map((m: { content: string }) => m.content).join("\n");
    const task = prompt.match(/# 任务：([^\n]+)/g)?.at(-1) ?? "";
    const text = respond(task, prompt);
    console.log(`[mock] ${body.model} ${task.slice(0, 40)} → ${text.length} 字`);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (let i = 0; i < text.length; i += 200) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 200) } }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: prompt.length, completion_tokens: text.length } })}\n\n`);
    res.end("data: [DONE]\n\n");
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock LLM on http://127.0.0.1:${PORT}/v1`));
