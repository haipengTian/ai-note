/**
 * 本地“AI 腔”检测：不调用模型，按规则统计套话和总结式结尾。
 * 结果既给用户看，也作为审校模型的参考输入。可按自己的经验往 PHRASES 里加词。
 */

/** [展示名, 匹配规则] */
const PHRASES: [string, RegExp][] = [
  ["不禁", /不禁/g],
  ["不由得", /不由得/g],
  ["仿佛", /仿佛/g],
  ["宛如/犹如", /宛如|犹如/g],
  ["嘴角勾起/上扬", /嘴角(微微)?(勾起|上扬|扬起|一勾)/g],
  ["一抹XX", /一抹(弧度|笑意|冷笑|微笑|复杂|异样|担忧|不易察觉)/g],
  ["眼中闪过一丝", /(眼中|眼底|眸中|眼里)(闪过|掠过)一(丝|抹|道)/g],
  ["心中一凛/一震", /心(中|头|里)一(凛|震|紧|沉)/g],
  ["深吸一口气", /深吸(了)?一口气/g],
  ["倒吸一口凉气", /倒吸(了)?一口凉气/g],
  ["空气凝固", /空气(仿佛|似乎|都)?(凝固|凝滞)/g],
  ["难以言喻", /难以言喻|无法言喻|说不清道不明/g],
  ["意味深长", /意味深长/g],
  ["微微一笑", /微微一笑/g],
  ["冷哼一声", /冷哼一声/g],
  ["与此同时", /与此同时/g],
  ["值得一提的是", /值得一提的是|总而言之|综上所述/g],
  ["这一刻", /这一刻/g],
  ["一股莫名的", /一股(莫名|难以名状|说不出)的/g],
  ["仿佛在诉说", /(仿佛|似乎)在(诉说|述说|讲述)/g],
];

/** 结尾“总结升华/展望未来”的常见写法 */
const SUMMARY_ENDING = /(他|她|我)(知道|明白|清楚|相信)|这一切(才刚刚|只是)|新的(篇章|征程|旅程)|(故事|传奇)(才刚刚|正式)开始|命运的齿轮|未来的路/;

export interface AiPhraseHit {
  phrase: string;
  count: number;
}

export function detectAiPhrases(text: string): { hits: AiPhraseHit[]; summaryEnding: boolean; density: number } {
  const hits: AiPhraseHit[] = [];
  for (const [phrase, re] of PHRASES) {
    const count = (text.match(re) || []).length;
    if (count) hits.push({ phrase, count });
  }
  hits.sort((a, b) => b.count - a.count);
  const total = hits.reduce((s, h) => s + h.count, 0);
  const len = Math.max(1, text.replace(/\s/g, "").length);
  const lastPara = text.trim().split(/\n+/).slice(-2).join("");
  return {
    hits,
    summaryEnding: SUMMARY_ENDING.test(lastPara),
    /** 每千字套话数 */
    density: Math.round((total / len) * 1000 * 10) / 10,
  };
}
