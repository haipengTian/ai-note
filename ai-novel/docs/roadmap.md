# AI 小说工坊 v1.0 设计与路线图

> 状态：设计稿（2026-09-25）已评审通过。**P0 已完成（v0.3，2026-09-26）**，下一步 P1。
> 待决问题结论：引入 Zod；存储继续用分文件 JSON；前端框架在 P1 前再评估（P0 先把人物/记忆/待办页拆成 `public/pages-*.js`）。

## 0. 目标与原则

### 产品决策

| 决策 | 内容 |
|---|---|
| 质量优先 | 模型预算不设限。凡是"多花调用换质量"的方案（场景级生成、多审校、复审循环、多候选）默认开启 |
| 多平台多题材 | 番茄 / 起点 / 晋江 / 通用……都要支持，**不在代码里写死任何平台规则**，全部走可插拔规则包 |
| 人机协作 | **人管方向，机器管执行，闸门管异常**。规划层人确认，章节生产自动化，出问题才叫人 |

### 设计原则

1. **结构化优先于文本**：所有"会变的事实"（状态、资源、伏笔、信息差）都是结构化数据，文本只是它的展示。
2. **事件溯源**：状态不被覆盖，而是由"初始值 + 按章的变化事件"推导。任何一章都能回答"写到这里时世界是什么样"，重写某章 = 撤销该章的事件再重新抽取。
3. **每层只做一件事**：规划、编排、写作、审校、回写分离，每一步的输入输出可见、可改、可重跑。
4. **可追溯**：每章实际注入的上下文、审校意见、状态变化都留档，出问题能定位到是哪一步错了。
5. **先写完，再写精**：先保证几百章不崩，再追求文笔。

---

## 1. 总体流程

```
【0 立项】    灵感 → 3 个方向候选 → 人选 → 作品定位卡 + 规则包组合 + 文风卡
【1 设定库】  世界观总述 + 设定条目(力量/势力/地点/物品/规则) + 人物卡(固定设定 + 初始状态)
【2 宏观规划】总纲 → 分卷(目标/高潮/卷末钩子) → 长线伏笔表
【3 弧规划】  当前剧情弧(10~30 章)：起承转合 + 爽点节拍 + 伏笔安排        ← 人确认
【4 细纲】    结构化章纲 → 场景卡
【5 写作】    上下文编排器 → 按场景写 →（关键章多候选挑选）
【6 质检】    本地规则 → 一致性审校 + 主编审校 + 文风审校 → 段落级修订 → 复审
             └─ 仍不达标 → 闸门暂停 / 记质量债
【7 回写】    抽取状态变化(带原文证据) → 校验 → 普通变化自动应用 / 关键变化生成提案 ← 人确认
【8 弧末复盘】冻结弧摘要 → 伏笔清点 → 爽点/套路分布 → 修正下一弧 → 回到 3     ← 人确认
```

### 人机分工与自主度

每个环节有独立的自主度开关（`auto` / `confirm`），作品级配置：

| 环节 | 默认 | 说明 |
|---|---|---|
| 立项方向选择 | confirm | 影响全书 |
| 设定 / 人物 / 总纲 / 分卷 | confirm | AI 起草，人确认后才进入下一步 |
| 弧规划 | confirm | **主人工检查点**，每 10~30 章一次 |
| 章纲 / 场景卡 | auto | 人可以随时抽查修改 |
| 正文 / 审校 / 修订 | auto | 用算力换人力 |
| 普通状态变化 | auto | 位置、普通伤势、关系微调 |
| 关键状态变化 | confirm | 境界突破、人物死亡、秘密揭晓、主线伏笔回收等（由规则包定义） |
| 弧末复盘 | confirm | 同弧规划一起确认 |

"待确认"事项统一进入作品的**收件箱**（Inbox），连续写作遇到 confirm 项会暂停并提示。

---

## 2. 数据模型 v2

### 2.1 存储布局

`novel.json` 单文件会随事件增长变大且每次全量重写，v2 拆分为多个文件，仍然是可手改的 JSON：

```
data/<id>/
  book.json          定位卡、规则包、文风卡、自主度、设置、schemaVersion
  bible.json         世界观总述、设定条目、人物卡(固定部分 + 初始状态)
  structure.json     分卷、剧情弧、章节元数据(章纲、场景卡、审校结果)
  memory.json        状态事件、伏笔、秘密、摘要(弧/卷/全书)
  inbox.json         待确认事项、质量债
  chapters/0001.txt  正文（不变）
  versions/0001/...  章节历史版本（不变）
  snapshots/...      记忆快照（保留，作为事件系统之外的安全网）
  runs/0001/         每章生产留档：context.json、reviews.json、deltas.json、candidates/
```

所有写操作仍经过 `withLock(novelId)` 串行化；跨文件的一次更新在锁内完成，逐个原子写。

### 2.2 核心类型（草案）

```ts
// ---------- book.json
interface Book {
  schemaVersion: 2;
  id: string; title: string; idea: string;
  profile: {                    // 作品定位卡
    sellingPoint: string;       // 一句话卖点
    targetReader: string;       // 目标读者与情绪价值
    comparables: string[];      // 对标作品（仅作风格参照）
    taboos: string[];           // 禁区（不写的内容）
  };
  rulePacks: string[];          // 如 ["platform/fanqie", "genre/urban", "genre/system"]
  styleCard: StyleCard;         // 见第 6 节
  targetChapters: number; wordsPerChapter: number;
  autonomy: Record<Stage, "auto" | "confirm">;
  quality: {
    reviewThreshold: number;    // 默认 85
    maxReviseRounds: number;    // 默认 2
    candidates: number;         // 关键章候选数，默认 3
    reviewModel?: string;       // 默认取 MODEL_REVIEW
  };
  createdAt: number; updatedAt: number;
}

// ---------- bible.json
interface LoreEntry {
  id: string;
  type: "power" | "faction" | "location" | "item" | "rule" | "concept";
  name: string; aliases: string[];
  content: string;              // 设定正文
  tags: string[];
  introducedIn?: number;        // 首次出现章节（未出现前不注入，防剧透）
}

interface Character {
  id: string; name: string; aliases: string[];
  role: string;                 // 主角/女主/伙伴/导师/反派/配角…
  profile: string;              // 固定设定：外貌、性格、背景、动机、说话方式
  voice: string;                // 说话风格/口头禅（对话区分度）
  initial: CharacterState;      // 故事开始时的状态
  firstAppearance?: number;
}

interface CharacterState {
  attrs: Record<string, string>;      // 由规则包定义常用键：境界/修为/身份/伤势/所在地…
  relations: Record<string, string>;  // 对方 characterId -> 关系描述
  knows: string[];                    // 掌握的秘密 id
  inventory: Record<string, number>;  // 物品/资源 -> 数量
  alive: boolean;
}

// ---------- memory.json
interface StateEvent {
  id: string;
  chapter: number;
  kind: "attr" | "relation" | "knowledge" | "inventory" | "life" | "lore" | "location";
  target: string;               // characterId 或 loreId
  key?: string;                 // attr 键 / 关系对象 / 物品名 / 秘密 id
  op: "set" | "add" | "remove";
  value?: string | number;
  evidence: string;             // 正文原句（校验时必须能在正文中找到）
  critical: boolean;            // 是否关键变化（规则包判定）
  status: "applied" | "proposed" | "rejected" | "reverted";
  createdAt: number;
}

interface Hook {                // 伏笔 / 悬念 / 承诺 / 冲突
  id: string;                   // 8 位，避免碰撞
  type: "foreshadow" | "mystery" | "promise" | "conflict";
  content: string;
  importance: "major" | "minor";
  status: "open" | "progressing" | "deferred" | "resolved" | "abandoned";
  plantedIn: number;
  lastAdvancedIn?: number;
  payoffWindow?: [number, number];  // 计划回收区间
  resolvedIn?: number;
  history: { chapter: number; op: "plant" | "advance" | "resolve"; note: string }[];
}

interface Secret { id: string; content: string; knownToReader: boolean }

interface Memory {
  events: StateEvent[];
  hooks: Hook[];
  secrets: Secret[];
  bookSynopsis: string;         // 全书梗概（由卷摘要生成）
}

// ---------- structure.json
interface Volume {
  id: string; index: number; title: string;
  range: [number, number];
  goal: string; climax: string; endHook: string;
  summary?: string;             // 卷结束后冻结
  status: "planned" | "writing" | "done";
}

interface Arc {
  id: string; volumeId: string; index: number; title: string;
  range: [number, number];
  premise: string;              // 本弧要解决的问题
  beats: { stage: "起" | "承" | "转" | "合"; content: string; chapters: [number, number] }[];
  payoffs: { chapter: number; type: string; content: string }[];  // 爽点节拍
  hookPlan: { hookId: string; op: "advance" | "resolve" }[];
  summary?: string;             // 弧结束后冻结，不再改写
  retrospective?: string;       // 弧末复盘
  status: "draft" | "approved" | "writing" | "done";
}

interface ChapterPlan {
  goal: string; conflict: string;
  payoffType: string;           // 取自规则包的爽点类型
  emotion: { from: string; to: string };
  hookType: string;             // 章末钩子类型
  hookOps: { hookId?: string; op: "plant" | "advance" | "resolve"; note: string }[];
  characters: string[];         // characterId
  location?: string; storyTime?: string;
}

interface Scene {
  id: string; pov: string; location: string; characters: string[];
  goal: string; beats: string[]; targetWords: number;
}

interface Chapter {
  index: number; arcId: string; title: string;
  outline: string;              // 文本版章纲（兼容 v1，也方便人改）
  plan?: ChapterPlan;
  scenes: Scene[];
  status: "planned" | "drafting" | "written" | "needs_attention";
  stale?: string;               // 上游改动导致可能不一致时的说明
  summary: string; words: number; updatedAt?: number;
  review?: ReviewResult;        // 见第 5 节
}

// ---------- inbox.json
interface InboxItem {
  id: string;
  kind: "confirm_stage" | "state_proposal" | "gate_failed" | "stale_chapter";
  chapter?: number; refId?: string;
  title: string; detail: string;
  status: "open" | "done" | "dismissed";
  createdAt: number;
}
interface QualityDebt { chapter: number; issue: ReviewIssue; createdAt: number; resolved?: boolean }
```

### 2.3 状态推导（事件溯源）

```ts
/** 第 chapter 章开写前的世界状态：初始状态 + 所有 applied 且 chapter < N 的事件，按章节、时间顺序折叠 */
function stateAt(bible: Bible, memory: Memory, chapter: number): WorldState;
/** 撤销某章产生的全部事件（重写/删除章节时） */
function revertChapter(memory: Memory, chapter: number): Memory;
```

- 纯函数，不修改入参，返回新对象（便于测试和回滚）。
- 重写第 N 章：`revertChapter(N)` → 写新正文 → 重新抽取。第 N+1 章起的已写章节标记 `stale`，进收件箱让人决定是否做一致性检查。
- v0.2 的"记忆快照"保留，作为兜底。

### 2.4 分层摘要

| 层 | 何时生成 | 是否可变 |
|---|---|---|
| 章摘要 | 每章回写时 | 章节重写时重新生成 |
| 弧摘要 | 弧结束（复盘时） | **冻结**，除非手动编辑 |
| 卷摘要 | 卷结束 | **冻结** |
| 全书梗概 | 卷摘要更新时 | 由冻结的卷摘要拼成，不是"摘要的摘要" |

写作时注入：全书梗概 + 当前卷已完成弧的弧摘要 + 本弧已写章节的章摘要 + 上一章全文。

### 2.5 v1 → v2 迁移

`store.get` 检测到 `schemaVersion` 缺失时自动迁移，迁移前把原文件备份为 `novel.v1.backup.json`：

| v1 | v2 |
|---|---|
| `worldview` | `bible.worldview`（总述，设定条目为空，可后续用"拆分设定"任务生成） |
| `characters[].state` 文本 | `initial.attrs = {}`；在最后一章已写章节上生成一条 `attr` 事件，`key="状态概述"`，值为原文本 |
| `outline` | 保留为总纲文本；生成 1 个"迁移卷" |
| `chapters` | 按每 10 章切成若干"迁移弧"，弧摘要由现有章摘要补生成（可选） |
| `memory.storySoFar` | 作为第一个迁移弧之前的 `bookSynopsis` 初值 |
| `memory.foreshadows` | `hooks`：`type=foreshadow`，`importance=minor`，按 `resolvedIn` 置状态，id 保留 |
| `settings` | `quality.reviewThreshold` / `autonomy` |

---

## 3. 规则包

### 3.1 目的

平台、题材、风格差异全部由规则包表达。流水线只认识"规则包字段"，不认识"番茄""玄幻"。新增平台或题材 = 新增一个 JSON 文件。

### 3.2 格式

放在 `ai-novel/rulepacks/<kind>/<name>.json`，用户可自行新增：

```jsonc
{
  "id": "genre/xuanhuan",
  "name": "玄幻升级流",
  "kind": "genre",                 // base | platform | genre | style
  "extends": ["base"],
  "defaults": { "wordsPerChapter": 3000, "chaptersPerArc": 20 },
  "stateKeys": ["境界", "修为进度", "功法", "伤势", "所在地"],
  "criticalRules": [               // 哪些变化算关键，需要人确认
    { "kind": "attr", "key": "境界" },
    { "kind": "life" },
    { "kind": "knowledge", "secretImportance": "major" }
  ],
  "payoffTypes": ["打脸", "突破", "获得宝物", "揭露身份", "越级战胜", "收服", "逆转"],
  "hookTypes": ["危机悬念", "身份悬念", "奖励预告", "强敌登场", "反转"],
  "planningRules": ["每 3~5 章一个小高潮", "升级要有代价和积累，禁止无铺垫突破"],
  "openingRules": ["第 1 章 300 字内出现冲突", "第 3 章前展示金手指", "第 3 章末强钩子"],
  "writingRules": ["战斗描写用短句，每句一个动作", "境界差距要通过旁观者反应体现"],
  "reviewDimensions": [
    { "name": "力量体系一致性", "weight": 2, "rubric": "越级战斗是否有合理依据，境界描述是否与设定一致" }
  ],
  "bannedPhrases": [],
  "bannedPatterns": []             // 正则字符串
}
```

### 3.3 合并规则

合并顺序为 `base → platform → genre(可多个) → style → 作品文风卡 → 本章额外要求`：
- 标量字段：后者覆盖前者。
- 数组字段：合并去重。
- `reviewDimensions`：同名覆盖，其余追加。

合并结果每章写入 `runs/<n>/context.json`，便于排查"这章为什么这么写"。

### 3.4 首批规则包

| kind | 包 |
|---|---|
| base | `base`（通用网文规范 + 去 AI 腔，由现 `WRITING_RULES` 迁移） |
| platform | `fanqie`（快节奏、2000~2500 字、情绪直给）、`qidian`（3000+ 字、设定深度、长线）、`jjwxc`（情感细腻、关系主线）、`generic` |
| genre | `xuanhuan`、`xianxia`、`urban`、`system`、`romance`、`suspense`、`history`、`scifi` |

---

## 4. 上下文编排器

替代现在各提示词各自拼接、各自 `clip` 的做法。

### 4.1 模型

```ts
interface ContextBlock {
  id: string;                        // "rules" | "bible.world" | "char:<id>" | "lore:<id>" | "arc.summary" | ...
  tier: "protected" | "compressible" | "optional";
  stability: number;                 // 0~1，越稳定越靠前（命中前缀缓存）
  priority: number;                  // 预算不够时按优先级裁剪 optional/compressible
  text: string;
}
function compile(task: TaskKind, blocks: ContextBlock[], budgetTokens: number): { messages: Msg[]; trace: Trace };
```

- **protected**：规则包、本章章纲和场景卡、出场人物当前状态、本章相关伏笔、上一章结尾。永不裁剪。
- **compressible**：弧摘要、章摘要、上一章全文（超预算时退化为结尾 2000 字）。
- **optional**：检索命中的设定条目、旧章原文片段、未出场人物。
- **排序**：按 `stability` 从高到低排列（规则 → 设定 → 人物固定设定 → 摘要 → 当前状态 → 本章任务），让同一作品连续多章的请求共享最长前缀，命中服务端缓存。
- **留档**：`trace` 记录每块的来源、字数、是否被裁剪，写入 `runs/<n>/context.json`，前端可查看。
- **预算**：按字符估算 token（中文约 1 字 ≈ 1 token 保守估计），默认写作任务 64k，可配置。

### 4.2 取材规则（写第 N 章）

| 内容 | 来源 |
|---|---|
| 人物 | 章纲 `characters` + 主角 + 与出场人物有关系事件的人物；状态取 `stateAt(N)` |
| 设定条目 | P0：章纲/场景文本中出现的条目名与别名匹配；P4：BM25 检索 |
| 伏笔 | 本章 `hookOps` 涉及的 + 本弧 `hookPlan` 的 + 超过回收窗口的 major 伏笔（提醒） |
| 信息差 | 出场人物各自 `knows` 的秘密列表（防止"知道不该知道的事"） |
| 衔接 | 上一章全文、本章已写场景全文（按场景写时） |

---

## 5. 章节生产流水线

```
plan(章纲+场景卡) → compose(编排上下文) → draft(按场景写，关键章 N 候选)
  → check(本地规则) → review(3 个审校角色并行) → revise(段落级) → re-review(≤ maxReviseRounds)
  → gate(是否暂停) → digest(抽取状态变化) → validate(证据校验/关键变化判定) → apply / propose
```

### 5.1 写作

- **按场景写**：每个场景单独一次调用，输入为编排后的上下文 + 本章已写场景全文 + 当前场景卡；全部写完后做一次"衔接润色"（只改场景交界处）。
- **关键章多候选**：开篇 1~3 章、弧高潮章、卷末章，生成 `quality.candidates` 个版本，由评审模型按审校维度打分排序；`autonomy.draft = confirm` 时交给人挑。
- **字数控制**：场景有 `targetWords`；整章不足 70% 时对最短场景扩写，而不是在结尾续写。

### 5.2 审校（3 个角色，审校模型默认与写作模型不同）

| 角色 | 对照材料 | 关注点 |
|---|---|---|
| 一致性审校 | `stateAt(N)`、设定条目、信息差、上一章 | 境界/数值/物品/位置/时间/信息差/人物动机 |
| 主编 | 章纲、弧节拍、规则包审校维度 | 大纲执行、节奏、爽点铺垫与释放、章末钩子、对话 |
| 文风审校 | 文风卡、文风指纹、禁用词/句式 | AI 腔、句式重复、文风偏离 |

```ts
interface ReviewIssue {
  reviewer: "continuity" | "editor" | "style";
  dimension: string; severity: "high" | "medium" | "low";
  quote: string;                     // 必须能在正文中定位到
  paragraph?: number;                // 定位后的段落序号
  problem: string; suggestion: string;
}
interface ReviewResult {
  rounds: { score: number; issues: ReviewIssue[]; at: number }[];   // 每轮复审都保留
  finalScore: number;
  passed: boolean;
  aiPatterns: { name: string; count: number }[];
}
```

- 引用原文定位不到的问题视为幻觉，丢弃并记日志。
- 总分 = 各维度加权（权重来自规则包），任一 high 问题直接判定不通过。

### 5.3 段落级修订

1. 按 `paragraph` 把问题分组，只重写涉及的段落（带前后各 1 段作为上下文）。
2. 拼回原文，未涉及的段落逐字保留。
3. 涉及段落超过 50% 时改为整章修订。
4. 修订后复审，最多 `maxReviseRounds` 轮；每轮都存入 `versions/`。

### 5.4 闸门

以下任一条件触发时，章节标记为 `needs_attention`，写入收件箱，连续写作暂停：

- 复审到上限仍 `finalScore < reviewThreshold`
- 存在未解决的 high 级一致性问题
- 字数不足目标的 60%
- 产生 `critical` 状态提案且 `autonomy.criticalDelta = confirm`
- 弧的最后一章写完（进入弧末复盘确认）

没触发闸门但仍有 medium 问题的，记入**质量债**，可在弧末复盘时批量处理。

### 5.5 回写

- 抽取结果是 `StateEvent[]` + 伏笔操作 + 新人物/新设定条目 + 章摘要，每条都带 `evidence`。
- **证据校验**：`evidence` 在正文中做模糊匹配（去标点空白后子串匹配），匹配不到的事件丢弃。
- **关键变化判定**：按规则包 `criticalRules` 判定，关键变化 `status=proposed` 进收件箱，其余直接 `applied`。
- **结构校验**：解析失败或字段非法时重试一次，仍失败则章节标记 `needs_attention`，不写入脏数据。

### 5.6 弧末复盘

1. 由本弧章摘要生成弧摘要（冻结）。
2. 伏笔清点：本弧计划推进/回收的是否完成；超过回收窗口的 major 伏笔列出。
3. 爽点类型分布、情绪曲线、套路重复检查（与前几个弧比较）。
4. 汇总质量债。
5. 起草下一弧规划。
6. 以上打包成一条收件箱事项，人确认后进入下一弧。

---

## 6. 文风系统

### 6.1 文风卡

```ts
interface StyleCard {
  pov: "第一人称" | "第三人称有限" | "第三人称全知" | "多视角";
  pace: "快" | "中" | "慢";
  sentence: { avgLen?: number; note: string };
  paragraphMaxLines: number;
  dialogueRatio?: number;            // 对话字数占比目标
  description: { environment: string; combat: string; psychology: string };  // 各类描写的密度要求
  emotion: "直给" | "克制";
  humor: "无" | "轻松" | "搞笑";
  diction: "口语" | "书面" | "古风" | "网络化";
  rules: string[];                   // 可执行的写作规则（手写或样章提炼）
  exemplars: string[];               // 2~3 段示例片段
  bannedPhrases: string[];
  bannedPatterns: string[];
  fingerprint?: StyleFingerprint;    // 样章统计指纹
}
```

### 6.2 样章学习

1. **本地统计指纹**（不调模型）：平均句长与方差、段落长度分布、对话占比、标点习惯（破折号/省略号/感叹号频率）、高频虚词。
2. **模型提炼**：从样章总结 8~12 条可执行规则，写入 `styleCard.rules`。
3. **示例片段**：由模型挑选 2~3 段代表性片段作为 few-shot。仅使用用户自己的或已获授权的样章，界面上提示版权。
4. **审校对照**：文风审校比对指纹，偏离超过阈值时提示。

### 6.3 AI 腔检测 v2（扩展 `src/review.ts`）

| 类别 | 例子 | 检测方式 |
|---|---|---|
| 套话词 | 不禁、仿佛、嘴角勾起一抹弧度 | 正则（现有） |
| 句式 | 不是 A，而是 B；与其说……不如说……；三连排比 | 正则 |
| 情绪标签化 | 他感到一阵愤怒、心中涌起一股…… | 正则 |
| 解释性独白 | 他知道，这意味着…… | 正则 |
| 对话后缀模板 | 淡淡道 / 冷冷道 / 沉声道 高频 | 计数，每千字超阈值 |
| 量词泛滥 | 一丝、几分、些许 | 计数 |
| 段落模板化 | 连续多段"动作 + 神态 + 台词"开头 | 段首模式统计 |
| 节奏单一 | 句长方差过低 | 统计 |
| 结尾升华 | 总结、展望、说教 | 正则（现有） |

同时把禁用词和禁用句式写进写作提示词，**源头预防**，而不是只靠事后修订。

### 6.4 反重复

- **文本重复**：本章与最近 10 章做 8-gram 重叠检测，超过阈值的片段交给文风审校。
- **套路重复**：统计本书各章 `payoffType` 和 `hookType` 的分布，规划章纲时注入"最近 N 章已用过的爽点类型"，并在弧末复盘中报告。

---

## 7. 代码结构调整

保持零构建前端和"单文件 200~400 行"的粒度，拆分现有 `pipeline.ts`（404 行）和 `prompts.ts`（394 行）：

```
src/
  config.ts
  llm.ts                     // 增加：按任务选模型、usage 按作品统计
  jobs.ts                    // 增加：paused 状态
  server.ts                  // 路由按资源拆到 routes/ 下
  model/
    types.ts                 // 第 2 节类型
    migrate.ts               // v1 → v2
    validate.ts              // LLM 输出与用户输入校验
  store/
    files.ts                 // 原子写、锁、分文件读写
    book.ts  bible.ts  structure.ts  memory.ts  inbox.ts  versions.ts
  state/
    events.ts                // stateAt / revertChapter / applyDelta（纯函数）
    hooks.ts                 // 伏笔状态机
    summaries.ts             // 分层摘要
  rulepacks/
    loader.ts                // 加载、继承、合并
  context/
    compiler.ts              // 编排、预算、排序、trace
    select.ts                // 取材规则
  pipeline/
    bootstrap.ts  plan.ts  arc.ts  write.ts  review.ts  revise.ts  digest.ts  gate.ts  auto.ts
  prompts/
    shared.ts  setup.ts  plan.ts  write.ts  review.ts  digest.ts  style.ts
  analysis/
    ai-patterns.ts           // 原 review.ts
    fingerprint.ts  repetition.ts
rulepacks/                   // JSON 规则包（项目根目录，便于用户增改）
test/                        // node:test
```

---

## 8. 分阶段实施

每个阶段结束时项目都可正常使用，旧作品可继续写。

### P0 记忆与上下文地基 ✅

> 完成于 v0.3。验收：79 个单元测试 + 模拟模型端到端冒烟（`npm run smoke`）全部通过。
> 与设计稿的差异：
> - `book.json` 暂时保留 `genre` / `style` 字符串，`rulePacks` / `styleCard` / `profile` 留到 P1 / P3 加入。
> - 剧情弧在 P0 按固定章数切分（`settings.arcSize`，默认 10），P1 改为由弧规划决定范围。
> - 证据校验：去空白标点后子串匹配，或 3-gram 覆盖率 ≥ 60%（容忍模型轻微改写）。
> - 关键变化判定暂用内置规则（境界/等级/修为/实力/身份/职位/血脉/体质、生死），P1 改为读规则包 `criticalRules`；主线伏笔回收暂不需要确认。
> - 新增 `MODEL_MEMORY`（记忆抽取模型，默认同写作模型）和 `CONTEXT_BUDGET`（默认 60000 字）。
> - `Chapter.status = "needs_attention"` 已在类型中预留，P2 闸门使用。
> - Node 20 的 `--test` 不支持 glob，用 `scripts/test.mjs` 收集测试文件。

| # | 任务 | 验收标准 |
|---|---|---|
| P0-1 | 测试基建：`node --import tsx --test`；给现有纯函数补测试（`extractJSON`、`detectAiPhrases`、`cleanChapterText`、`buildContext`） | `npm test` 通过 |
| P0-2 | 数据模型 v2 类型 + 分文件存储 + v1 迁移（含备份） | 用 v0.2 生成的作品迁移后能打开、能继续写；备份文件存在 |
| P0-3 | 状态事件系统：`stateAt` / `revertChapter` / `applyDelta` | 单测覆盖：顺序折叠、撤销、重写某章后状态正确 |
| P0-4 | 伏笔 v2：状态机、回收窗口、推进记录；写作时按"本章相关 + 超期 major"注入，取代"最近 15 条" | 早期 major 伏笔在第 100 章后仍能被注入 |
| P0-5 | 回写 v2：结构化事件 + 证据校验 + 关键变化提案 + 收件箱（后端 + 最简 UI） | 编造的事件被丢弃；关键变化进收件箱，确认后才生效 |
| P0-6 | 分层摘要：P0 阶段弧 = 每次规划的 10 章批次；弧完成时冻结弧摘要；移除滚动重写的前情提要 | 早期剧情摘要不再被反复改写 |
| P0-7 | 上下文编排器 + 每章 `runs/<n>/context.json` 留档 + 前端查看 | 每章可查看实际注入的内容和裁剪情况 |
| P0-8 | 修复与收尾：`autoWrite` 从第一个未写章节开始；重写章节时撤销事件并标记下游 `stale` | 中间有空章时不会被跳过 |
| P0-9 | 记忆页 UI：人物状态时间线（可选"截至第 N 章"）、资源账本、伏笔看板 | 能查看任意章节时的人物状态 |

### P1 规划升级 + 规则包

| # | 任务 | 验收标准 |
|---|---|---|
| P1-1 | 规则包加载器 + `base` + 4 个平台包 + 2 个题材包（xuanhuan、urban） | 合并结果可在界面查看；新增 JSON 无需改代码 |
| P1-2 | 立项：一句灵感 → 3 个方向候选（卖点/主角/金手指/爽点/平台建议）→ 选择 → 定位卡 | 可对比候选并选择或修改 |
| P1-3 | 设定条目化：世界观总述 → 拆分为 `LoreEntry`；人物卡增加 `voice`、结构化初始状态 | 人物状态键来自题材包 |
| P1-4 | 分卷 + 剧情弧规划（起承转合、爽点节拍、伏笔安排）+ 弧确认闸门 | 弧未确认时不会自动写该弧章节 |
| P1-5 | 结构化章纲 + 场景卡 | 章纲包含爽点类型、情绪、钩子、伏笔操作 |
| P1-6 | 按场景写作 + 衔接润色 + 场景级字数控制 | 平均字数达到目标的 90% 以上，不再依赖结尾续写 |
| P1-7 | 黄金三章：开篇规则包字段 + 前 3 章专用提示词 | 前 3 章审校单独检查开篇规则 |
| P1-8 | 弧末复盘（弧摘要冻结、伏笔清点、下一弧起草）进收件箱 | 复盘确认后自动进入下一弧 |

### P2 质量闭环

| # | 任务 | 验收标准 |
|---|---|---|
| P2-1 | 三角色并行审校 + 加权评分 + 引用定位与幻觉过滤 | 每条问题都能在正文中高亮定位 |
| P2-2 | 段落级修订 + 复审循环（≤ maxReviseRounds），每轮存版本 | 未涉及段落逐字不变；分数随轮次记录 |
| P2-3 | 闸门 + 连续写作暂停/恢复 + 质量债 | 不达标时暂停并在收件箱给出原因 |
| P2-4 | 关键章多候选 + 评审排序 + 人工挑选界面 | 开篇/高潮/卷末生成多个版本可对比 |
| P2-5 | 审校模型与写作模型分离的默认配置与提示 | 未配置时界面提示建议 |

### P3 文风系统

| # | 任务 | 验收标准 |
|---|---|---|
| P3-1 | 文风卡编辑器，替代单行"文风要求" | 文风卡字段全部进入写作与审校上下文 |
| P3-2 | 样章分析：本地指纹 + 规则提炼 + 示例片段 | 上传样章后生成可编辑的文风卡 |
| P3-3 | AI 腔检测 v2（句式、统计类） | 规则有单测；检测结果进入文风审校 |
| P3-4 | 反重复：n-gram 重叠 + 爽点/钩子类型分布 | 规划时注入近期已用类型；复盘时报告分布 |
| P3-5 | 补齐题材包：xianxia、system、romance、suspense、history、scifi | 每个包附 1 份示例作品配置 |

### P4 检索

| # | 任务 | 验收标准 |
|---|---|---|
| P4-1 | 设定条目 + 章节原文分块的 BM25 索引（中文 2-gram），增量更新 | 写作时能召回几十章前出现过的物品/地点细节 |
| P4-2 | 编排器接入检索结果（optional 层），trace 中显示命中原因 | 可查看每条召回的得分和来源 |
| P4-3 | （可选）向量检索，作为 BM25 的补充 | 与 BM25 召回结果对比评估后再决定是否启用 |

### P5 工作流与产品化

| # | 任务 |
|---|---|
| P5-1 | 导入已有小说：切章 → 重建设定/人物/事件/伏笔 → 续写 |
| P5-2 | 下游影响分析：改动某章后检查后续章节的冲突点 |
| P5-3 | 按作品/按任务的 token 与费用统计 |
| P5-4 | 导出增强：EPUB、按卷导出 |
| P5-5 | 任务状态持久化：服务重启后可恢复中断的连续写作 |

---

## 9. 质量评估

没有评估就无法判断改动是变好还是变坏。从 P0 开始建立：

- **固定评测集**：3~5 个不同平台/题材的作品配置（`test/fixtures/`），每次大改后各写 10~20 章。
- **自动指标**：
  - 一致性冲突数（一致性审校的 high/medium 数）
  - 平均审校分、首轮通过率
  - AI 腔密度（每千字）
  - 字数达标率
  - 伏笔回收率（到期 major 伏笔中已回收的比例）
  - 8-gram 重复率
- **人工抽检**：每个评测作品抽 3 章盲评，与上一版本对比。
- 结果写入 `docs/eval/<日期>.md`。

---

## 10. 待决问题

| 问题 | 建议 |
|---|---|
| 是否引入 Zod 做校验 | **建议引入**，作为唯一运行时依赖。LLM 输出校验是本项目的核心环节，手写校验容易漏；代价是打破"零依赖"的定位 |
| 是否换 SQLite | P0~P3 用分文件 JSON 足够；P4 检索如果内存索引性能不够，再评估 `node:sqlite`（需要提升 Node 版本要求） |
| 前端是否引入框架 | 页面会明显变多（收件箱、时间线、候选对比、文风卡）。建议 P1 前评估；若保持原生 JS，需要先把 `public/app.js`（872 行）按页面拆分 |
| 场景级生成的衔接质量 | P1-6 做 A/B：整章生成 vs 按场景生成 + 衔接润色，用第 9 节指标决定默认值 |
