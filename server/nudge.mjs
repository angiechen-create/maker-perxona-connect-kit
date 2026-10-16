// What Maker says when a quick button is tapped (agenda, demo speakers,
// topic tables) or when the visitor has gone quiet: one line from the event
// data plus 2 topics to tap. No AI call, so it costs no question; the
// topics are questions, which do.
//
// Without these the buttons just opened the program page and Maker said
// nothing, so visitors took Maker for a website, not someone to talk to.

import { loc, langs, mapText } from "./i18n.mjs";

const L = (zh, en, ja) => ({ zh, en, ja });

/** [now, next] schedule rows by the event's clock; null when it isn't today. */
function nowNext(event, today) {
  const sched = (event.schedule ?? []).filter((s) => s?.time && !/TODO/.test(s.time + loc(s.what)));
  if (!sched.length || !today) return null;
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone || "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  let i = -1;
  sched.forEach((s, k) => { if (String(s.time) <= now) i = k; });
  return [sched[i] ?? null, sched[i + 1] ?? null];
}
// A row's title in `lang`: its zh / ja key, or `what` (a string or { en, zh, ja }) up to " — ".
const label = (s, lang) => loc(langs(mapText(s.what, (x) => x.split(" — ")[0]), { zh: s.zh, ja: s.ja }), lang);

/**
 * @param kind  "agenda" | "demos" | "tables" | "idle"
 * @param today is it the event's day (the demo always is)
 * @returns { reply, followups: [string], guide: section id or "" }
 */
export function nudge(event, kind, lang, { today, tables }) {
  const pick = (o) => o[lang] ?? o.en;
  const nDemos = (event.demos?.lineup ?? []).filter((d) => d?.title && !/TODO/.test(loc(d.title))).length;
  if (kind === "agenda") {
    const nn = nowNext(event, today);
    let reply;
    if (nn?.[0] && nn[1]) reply = pick(L(`議程在這裡！現在是「${label(nn[0], "zh")}」，${nn[1].time} 接著「${label(nn[1], "zh")}」。`, `Here's the agenda! Right now: ${label(nn[0], "en")}. At ${nn[1].time}: ${label(nn[1], "en")}.`, `プログラムはこちら！今は「${label(nn[0], "ja")}」、${nn[1].time}から「${label(nn[1], "ja")}」だよ。`));
    else if (nn && !nn[0] && nn[1]) reply = pick(L(`議程在這裡！${nn[1].time} 開始，第一段是「${label(nn[1], "zh")}」。`, `Here's the agenda! It starts at ${nn[1].time} with ${label(nn[1], "en")}.`, `プログラムはこちら！${nn[1].time}に「${label(nn[1], "ja")}」から始まるよ。`));
    else reply = pick(L("今晚的議程在這裡！", "Here's tonight's agenda!", "今夜のプログラムはこちら！"));
    return {
      reply,
      followups: event.food ? [pick(L("會後該找哪位講者聊？", "Which speaker should I talk to after?", "終わったら誰と話すといい？")), pick(L("有什麼吃的？", "What's there to eat?", "食べ物は何がある？"))]
        : [pick(L("會後該找哪位講者聊？", "Which speaker should I talk to after?", "終わったら誰と話すといい？")), pick(L("活動到幾點？", "When does it end?", "何時に終わる？"))],
      guide: "s-agenda",
    };
  }
  if (kind === "demos") {
    return {
      reply: pick(L(`${nDemos ? `今晚有 ${nDemos} 場 Demo，` : ""}講者介紹都在這裡。想知道會後該找誰聊嗎？`, `${nDemos ? `${nDemos} live demos tonight, ` : ""}every speaker's here. Want to know who to talk to afterwards?`, `${nDemos ? `今夜はライブデモが${nDemos}本、` : ""}登壇者はここにいるよ。終わったら誰と話すといいか知りたい？`)),
      followups: [pick(L("我該找哪位講者聊？", "Which speaker should I meet?", "どの登壇者と話すといい？")), pick(L("幫我想一個問講者的問題", "Give me a question to ask a speaker", "登壇者への質問を考えて"))],
      guide: "s-demos",
    };
  }
  if (kind === "tables") {
    return {
      reply: pick(L(`${tables ? `${tables} 張主題桌` : "主題桌"}都在這裡。跟我說你在做什麼，我幫你挑一桌！`, `${tables ? `All ${tables} topic tables` : "The topic tables"} are here. Tell me what you're building and I'll pick one for you!`, `${tables ? `テーマ卓${tables}つ` : "テーマ卓"}はここだよ。何を作っているか教えてくれたら、合う卓を選ぶね！`)),
      followups: [pick(L("哪一桌最適合我？", "Which table suits me?", "どの卓が合う？")), pick(L("主題桌怎麼進行？", "How do topic tables work?", "テーマ卓ってどう進むの？"))],
      guide: "s-tables",
    };
  }
  // Gone quiet: say Maker is still here, with two easy ways back in.
  return {
    reply: pick(L("還想知道什麼嗎？議程、講者、吃的，或再認識一個人，都可以問我喔！", "Anything else? Ask me about the agenda, the speakers, the food, or who else to meet!", "ほかに知りたいことある？プログラム、登壇者、食べ物、次に会うべき人、なんでも聞いてね！")),
    followups: [pick(L("再幫我配對一位", "Match me with one more", "もう一人紹介して")), pick(L("現在在進行什麼？", "What's happening now?", "今は何をしてる？"))],
    guide: "",
  };
}
