// Phone app: what the entrance QR opens. One visitor, their own phone,
// a scrollable conversation with Maker. Sound is on by default (Maker talking
// is the point); every answer is also shown as text, and the speaker toggle
// switches to captions only.
//
// States (data-state on <body>): landing → empty → listening / thinking →
// answer → … ; limit when this phone has used its questions; agenda (from the
// limit screen) and offline show tonight's schedule.

import { agendaImage, tablesImage } from "./agenda-image.js";
import * as fx from "./fx.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
let presenter = document.querySelector("sv-presenter");

// localStorage can throw (private mode); nothing here may depend on it.
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// This tab's conversation, so it survives the browser reloading the page
// (e.g. after opening a LinkedIn card and coming back). Kept on this phone
// only, for 3 days at most: after the event people come back to find who
// Maker introduced (Maker stays online 48 h); then it's dropped.
const CHAT_DAYS = 3;
const chat = {
  load() {
    try {
      const v = JSON.parse(localStorage.getItem("maker-chat") || "null");
      if (v?.at && Date.now() - v.at < CHAT_DAYS * 864e5) return v;
      localStorage.removeItem("maker-chat");
    } catch {}
    return null;
  },
  save(v) { try { v ? localStorage.setItem("maker-chat", JSON.stringify({ ...v, at: Date.now() })) : localStorage.removeItem("maker-chat"); } catch {} },
};
let log = []; // [{ q, out }] for redrawing the thread

// Voice trial: ?tts=openai (&voice=ash|verse|cedar|…) speaks with OpenAI's
// TTS instead of Perxona's own voices. Remembered for this tab only.
const TRIAL = (() => {
  const q = new URLSearchParams(location.search);
  try {
    if (q.has("tts")) sessionStorage.setItem("maker-tts", JSON.stringify({ tts: q.get("tts"), voice: q.get("voice") || "", model: q.get("model") || "", tune: q.get("tune") || undefined, speed: q.get("speed") || undefined }));
    return JSON.parse(sessionStorage.getItem("maker-tts") || "null");
  } catch {
    return q.has("tts") ? { tts: q.get("tts"), voice: q.get("voice") || "" } : null;
  }
})();
// tts=openai or tts=eleven (ElevenLabs; voice = its voice id); tts=perxona
// forces the built-in voice. Without the URL, the server's default (cfg.tts).
const voiceMode = () => TRIAL ?? cfg?.tts ?? null;
// ?debug: show on screen what the voice did (phones have no console).
const DEBUG = new URLSearchParams(location.search).has("debug");
const outsideVoice = () => ["openai", "eleven"].includes(voiceMode()?.tts);

// Instagram / Facebook / Messenger / Threads / WeChat in-app browsers.
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|Messenger|Barcelona|MicroMessenger/i.test(navigator.userAgent);

const HTML_LANG = { zh: "zh-Hant", en: "en", ja: "ja" };
const SPEECH_LANG = { zh: "zh-TW", en: "en-US", ja: "ja-JP" };
const M = {
  zh: { match: "今晚，你該認識誰？", land: "跟我說說你最近在忙什麼，我幫你配對現場的人。議程、主題桌也能問我。", start: "報到", startSub: "CHECK IN", print1: "報到只會記錄你有來，其他都不會保存。", print2: "Check-in records that you came. Nothing else is stored.",
    ciName: "例：林小安", ciLabel: "你的全名（與報名時相同）", ciHint: "要先掃入口螢幕上的 QR 才能報到。還沒掃的話，回門口掃一下。", ciMissing: "請輸入你的名字。", ciNotFound: "名單上找不到這個名字。請輸入報名時用的全名，或找現場工作人員。", ciAmbiguous: "有幾位同名的參加者，請找現場工作人員幫你報到。", ciWhich: "是哪一位？點你自己：", ciNone: "都不是我", ciTooMany: "嘗試太多次了，請找現場工作人員幫你報到。", ciEnded: "今晚的活動已經結束囉。只有當晚有報到的人，才能回來找我。", closed: "Maker 去放假了！謝謝大家來，我們下次見！", notMe: "不是 {name}？換人", cont: "以 {name} 繼續", yes: "好啊！", no: "先不要", welcomeBack: "歡迎回來，{name}！",
    greet: "最近在忙什麼？想認識誰？", sub: "告訴我，我幫你從現場找人。議程、主題桌也能問。回答也會顯示成字幕，想靜音請按右上角。", opt: "想讓 {name} 介紹你？", optCta: "填表",
    tour: [["議程", "議程是什麼？"], ["Demo 有哪些？", "有哪些 demo？"], ["所有主題桌", "有哪些主題桌？"]], guide: "節目單", qbAgenda: "議程", programAgenda: "打開完整議程（含每位講者）", programTables: "打開所有主題桌", qbDemos: "Demo 講者", qbTables: "主題桌",
    chips: [["幫我配對", "我該認識誰？幫我配對。"], ["所有主題桌", "有哪些主題桌？"], ["議程", "議程是什麼？"]], ph: "問 {name}…", hold: "說話", listen: "正在聽…", release: "送出", cancel: "✕ 取消",
    inapp: "你在 App 裡面開啟的，聲音和麥克風可能不能用。請點右上角「⋯」→「用瀏覽器開啟」。", thinking: "想一下…", agendaCard: "今晚議程（點開看大圖）", tablesCard: "今晚主題桌（點開看大圖）", groupPeople: "推薦你認識", groupTables: "推薦主題桌", groupFeatured: "推薦你認識", openSite: "打開作品網站", openLinkedIn: "打開 LinkedIn", hostedBy: "桌長：", interestAsk: "我對第 {n} 桌最有興趣，跟我說說這桌，還有我該先認識誰？", interestQ: "點一桌告訴我：", interestUnsure: "還不確定", interestThanks: "收到！", save: "儲存圖片", saveHint: "也可以長按圖片儲存", close: "關閉", mute: "點我開聲音", on: "聲音開啟", soundHi: "聲音打開囉！", noSound: "沒聲音？檢查手機側邊的靜音鍵", limit: "今晚已經問了 {n} 個問題。最好的答案在現場的人身上。", agenda: "看今晚議程", back: "回到對話",
    busy: "我這邊有點忙，等幾秒再問我一次好嗎？", lost: "我現在連不上線，有問題請找現場工作人員。", noMic: "麥克風沒有開啟，請改用打字。", cached: "離線版本",
    programDemos: "打開所有 Demo 講者", loadingMaker: "正在載入 MAKER", aboutLink: "關於 Maker", questTitle: "今晚的任務", questDone: "任務完成！", qAgenda: "看完議程", qDemos: "認識 Demo 講者", qTables: "找到你的主題桌", aboutTitle: "關於 MAKER", ciDoor: "請用手機掃「門口螢幕」上的 QR 報到（QR 每幾分鐘會換一次，海報或照片上的不能用）。", noPerxona: "免費試用 Perxona，讓 Maker 動起來 →", demoPick: "這是示範活動。選一位虛構賓客，用他的身分試試看：", demoFine: "示範活動：活動和所有人都是虛構的，你問的內容不會被保存。", dayLimit: "今天的試玩名額用完了，明天再來找我玩！" },
  en: { match: "Who should you meet tonight?", land: "Tell me what you're working on and I'll match you with people in the room. Agenda and tables too.", start: "CHECK IN", startSub: "報到", print1: "Check-in records that you came. Nothing else is stored.", print2: "報到只會記錄你有出席，其他輸入的內容不會被保存。",
    ciName: "e.g. Alex Lin", ciLabel: "Your full name (as registered)", ciHint: "Check-in only works after scanning the QR on the entrance screen.", ciMissing: "Type your name first.", ciNotFound: "That name isn't on tonight's list. Try the full name you registered with, or find a staff member.", ciAmbiguous: "A few people share that name. Please check in with a staff member.", ciWhich: "Which one is you?", ciNone: "None of these", ciTooMany: "Too many tries. Please check in with a staff member.", ciEnded: "Tonight's event is over. Only people who checked in tonight can come back to me.", closed: "Maker is on holiday now! Thanks for coming, see you next time!", notMe: "Not {name}? Switch", cont: "Continue as {name}", yes: "Sure!", no: "Not now", welcomeBack: "Welcome back, {name}!",
    greet: "Who do you want to meet?", sub: "Tell me and I'll find people in the room. Agenda and tables too. Answers also show as text. Tap the speaker to mute.", opt: "Want {name} to introduce you?", optCta: "Form",
    tour: [["Agenda", "What's on the agenda?"], ["The demos", "What are the demos?"], ["All topic tables", "What topic tables are there?"]], guide: "Program", qbAgenda: "Agenda", programAgenda: "Open the full agenda (with every speaker)", programTables: "Open all topic tables", qbDemos: "Demo speakers", qbTables: "Topic tables",
    chips: [["Match me", "Who should I meet? Match me."], ["All topic tables", "What topic tables are there?"], ["Agenda", "What's on the agenda?"]], ph: "Ask {name}…", hold: "TALK", listen: "Listening…", release: "Send", cancel: "✕ Cancel",
    inapp: "You're inside an app's browser, so sound and the mic may not work. Tap ⋯ (top right) → Open in browser.", thinking: "Thinking…", agendaCard: "Tonight's agenda (tap to open)", tablesCard: "Topic tables (tap to open)", groupPeople: "PEOPLE TO MEET", groupTables: "TOPIC TABLE FOR YOU", groupFeatured: "PEOPLE TO MEET", openSite: "Open project site", openLinkedIn: "Open LinkedIn", hostedBy: "Topic Lead:", interestAsk: "I'm most curious about table {n}. Tell me about it, and who should I meet first?", interestQ: "Tap the one you like most:", interestUnsure: "Not sure yet", interestThanks: "Got it!", save: "Save image", saveHint: "Or press and hold the picture to save it", close: "Close", mute: "Tap for sound", on: "Sound on", soundHi: "Sound is on!", noSound: "No sound? Check your silent switch", limit: "That's {n} questions tonight. The best answers are in this room.", agenda: "Tonight's agenda", back: "Back to chat",
    busy: "I'm a bit busy — could you ask me again in a few seconds?", lost: "I've lost my connection — please ask one of the staff.", noMic: "The microphone isn't available — please type instead.", cached: "offline copy",
    programDemos: "Open all demo speakers", loadingMaker: "LOADING MAKER", aboutLink: "About Maker", questTitle: "TONIGHT'S QUEST", questDone: "QUEST COMPLETE!", qAgenda: "See the agenda", qDemos: "Meet the demo speakers", qTables: "Find your topic table", aboutTitle: "ABOUT MAKER", ciDoor: "Please scan the QR on the entrance screen to check in (it changes every few minutes, so one on a poster or photo won't work).", noPerxona: "Free Perxona trial: bring Maker to life →", demoPick: "This is a demo.\nPick a made-up guest and try me as them:", demoFine: "Demo event: the event and everyone in it are made up. Nothing you ask is saved.", dayLimit: "That's all the demo questions for today. Come back tomorrow!" },
  ja: { match: "今夜、誰に会うべき？", land: "何を作っているか教えてね。会場の人とマッチングするよ。プログラムやテーブルも聞いてね。", start: "チェックイン", startSub: "CHECK IN", print1: "チェックインは来場の記録だけ。それ以外は保存しません。", print2: "Check-in records that you came. Nothing else is stored.",
    ciName: "例：林小安", ciLabel: "フルネーム（登録時と同じ）", ciHint: "入口画面の QR を読み取ってからチェックインできます。", ciMissing: "名前を入力してね。", ciNotFound: "名簿にその名前がないよ。登録したフルネームで試すか、スタッフに声をかけてね。", ciAmbiguous: "同じ名前の人が何人かいるよ。スタッフに声をかけてね。", ciWhich: "どれがあなた？", ciNone: "どれでもない", ciTooMany: "試行回数が多すぎます。スタッフに声をかけてね。", ciEnded: "今夜のイベントは終わったよ。当日チェックインした人だけが戻ってこられるよ。", closed: "Maker はお休み中！来てくれてありがとう。また会おうね！", notMe: "{name} じゃない？切り替え", cont: "{name} で続ける", yes: "いいよ！", no: "今はやめておく", welcomeBack: "おかえり、{name}さん！",
    greet: "何を作ってる？誰に会いたい？", sub: "教えてくれたら会場の人を探すよ。プログラムやテーブルも聞いてね。回答は字幕でも表示。ミュートは右上から。", opt: "{name} に紹介してほしい？", optCta: "フォーム",
    tour: [["プログラム", "今夜のプログラムは？"], ["デモ一覧", "今夜のデモは？"], ["テーマ卓", "今夜のテーマ卓は？"]],
    chips: [["マッチして", "今夜誰に会うべき？マッチして。"], ["テーマ卓", "どのテーマ卓に行けばいい？"], ["プログラム", "今夜のプログラムは？"]], ph: "{name} に質問…", hold: "話す", listen: "聞いています…", release: "送信", cancel: "✕ 取消",
    inapp: "アプリ内ブラウザでは音声やマイクが使えないことがあります。右上の「⋯」→「ブラウザで開く」をタップしてね。", thinking: "考え中…", agendaCard: "今夜のプログラム（タップで拡大）", tablesCard: "テーマ卓（タップで拡大）", groupPeople: "会ってみてほしい人", groupTables: "おすすめのテーマ卓", groupFeatured: "会ってみてほしい人", openSite: "作品サイトを開く", openLinkedIn: "LinkedIn を開く", hostedBy: "卓リード：", interestAsk: "{n}番テーブルがいちばん気になる。どんな卓か教えて、それと最初に誰に会うべき？", interestQ: "一番気になる卓をタップ：", interestUnsure: "まだ決めてない", interestThanks: "了解！", save: "画像を保存", saveHint: "画像を長押しでも保存できます", close: "閉じる", mute: "タップで音声オン", on: "音声オン", soundHi: "音声オンにしたよ！", noSound: "音が出ない？マナースイッチを確認してね", limit: "今夜の質問は {n} 回に達しました。いちばんの答えは会場の人たちが持っています。", agenda: "今夜のプログラム", back: "チャットに戻る",
    busy: "少し混み合っています。数秒後にもう一度どうぞ。", lost: "接続が切れました。スタッフに聞いてください。", noMic: "マイクが使えません。文字で入力してください。", cached: "オフライン版",
    guide: "プログラム", qbAgenda: "プログラム", programAgenda: "プログラム全体を開く（登壇者つき）", programTables: "テーマ卓をすべて開く", qbDemos: "デモ登壇者", qbTables: "テーマ卓", programDemos: "デモ登壇者をすべて開く", loadingMaker: "MAKER 読み込み中", aboutLink: "Maker について", questTitle: "今夜のクエスト", questDone: "クエスト達成！", qAgenda: "プログラムを見る", qDemos: "デモ登壇者を知る", qTables: "テーマ卓を見つける", aboutTitle: "MAKER について",
    ciDoor: "入口の画面に出ている QR をスキャンしてチェックインしてね（QR は数分ごとに変わるので、ポスターや写真のものは使えません）。", noPerxona: "Perxona 無料体験で Maker を動かそう →",
    demoPick: "これはデモです。架空のゲストを選んで試してね：", demoFine: "デモイベント：イベントも登場人物もすべて架空です。質問内容は保存されません。", dayLimit: "今日のデモはここまで。また明日来てね！" },
};

let cfg = null;
let lang = pickLang();
let state = "landing";
let turns = []; // what the model sees (last few)
let used = 0;
let limit = 20;
// Sound starts off: phones won't play it before a tap anyway, so Maker
// speaks silently (mouth and gestures still move: muted speech drives the
// lip-sync) until the visitor taps the sound button.
let soundOn = false;
let audioUnlocked = false;
let ready = false;
let asking = false;
let stateBeforeAgenda = "empty";

// Event texts (names, titles, the agenda…) are one string, or one per
// language { en, zh, ja } when the event writes them so. The reader's, else
// English, else Chinese, else Japanese (the server's i18n.mjs does the same).
const pickL = (o, l = lang) => {
  if (o == null) return "";
  if (typeof o !== "object") return String(o);
  for (const k of [l, "en", "zh", "ja"]) if (o[k] != null && String(o[k]).trim()) return String(o[k]);
  return "";
};
/** Is `name` one of this person's names, in any language? */
const nameIs = (o, name) => !!name && (o && typeof o === "object" ? Object.values(o) : [o]).some((n) => String(n ?? "").toLowerCase() === String(name).toLowerCase());
/** The visitor's first name in the current language (林小雨 is "Rain" in English). */
const myFirst = () => pickL(me?.firsts) || me?.first || "";

const t = (key, vars = {}) => {
  const v = M[lang]?.[key] ?? M.en[key];
  return typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? (k === "name" ? cfg?.persona.name ?? "Maker" : "")) : v;
};

// English first for everyone (an international crowd); a visitor's own
// choice is remembered. (The key changed when the default did, so earlier
// testers start from English too.)
// The phone's own language, unless the visitor picked one with the buttons
// (that choice is kept). Narrowed to the event's languages once they load.
const ALL_LANGS = ["zh", "en", "ja"];
function phoneLang(allowed = ["zh", "en", "ja"]) {
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = String(l).toLowerCase().slice(0, 2);
    if (allowed.includes(code)) return code;
  }
  return allowed.includes("en") ? "en" : allowed[0];
}
function pickLang(allowed = ["zh", "en", "ja"]) { // (runs before ALL_LANGS below exists)
  // A shared link in one language (?lang=ja) opens in it, and counts as chosen.
  const linked = new URLSearchParams(location.search).get("lang");
  if (allowed.includes(linked)) {
    storage.set("maker-lang-choice", linked);
    return linked;
  }
  const chosen = storage.get("maker-lang-choice");
  return allowed.includes(chosen) ? chosen : phoneLang(allowed);
}
const eventLangs = () => (cfg?.persona?.languages ?? ALL_LANGS).filter((l) => ALL_LANGS.includes(l));

// Anonymous per-phone id: only used to count questions ([07/20]).
const deviceId = storage.get("maker-device") || (() => {
  const id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, "");
  storage.set("maker-device", id);
  return id;
})();

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // attendee text is user-written: never innerHTML
  return e;
}

// ── Keyboard: only the sheet moves ───────────────────────────────────────
// iOS overlays the keyboard on the *visual* viewport and leaves the page
// alone. Maker stays exactly where it is; the sheet's bottom is lifted by the
// keyboard's height (--kb) and its height capped to what's visible (--vvh).
// Chrome on Android resizes the page instead (interactive-widget), so --kb
// stays 0 there and the same CSS works.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const showDebug = new URLSearchParams(location.search).has("debug");
  let raf = 0;
  let applied = 0; // the lift currently on the sheet
  const sync = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      let kbH = Math.max(0, innerHeight - vv.height - vv.offsetTop);
      // Belt and braces (newer iOS reports the keyboard inconsistently):
      // if the field being typed in would still sit under the visible area,
      // lift by exactly what's missing, so you always see what you type.
      const f = document.activeElement;
      let under = 0;
      if (f?.matches?.("input, textarea") && $("sheet").contains(f)) {
        const unlifted = f.getBoundingClientRect().bottom + applied;
        under = unlifted - (vv.offsetTop + vv.height) + 12;
        if (under > kbH) kbH = under;
      }
      applied = kbH;
      const root = document.documentElement.style;
      root.setProperty("--kb", `${kbH}px`);
      root.setProperty("--vvh", `${vv.height}px`);
      body.classList.toggle("kb", kbH > 120);
      if (vv.offsetTop) window.scrollTo(0, 0); // iOS sometimes nudges the page; put it back once
      if (showDebug) {
        let box = document.getElementById("kbdebug");
        if (!box) {
          box = Object.assign(document.createElement("pre"), { id: "kbdebug" });
          box.style.cssText = "position:fixed;left:4px;top:4px;z-index:99;margin:0;padding:4px 6px;background:#000c;color:#0f0;font:11px/1.3 monospace;pointer-events:none";
          document.body.append(box);
        }
        box.textContent = `inner ${innerHeight} vv ${Math.round(vv.height)} top ${Math.round(vv.offsetTop)}\nunder ${Math.round(under)} kb ${Math.round(kbH)} ${f?.id || "-"}`;
      }
    });
  };
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  // The keyboard animates in after focus; look again while it settles.
  const settle = () => [0, 120, 300, 600, 1000].forEach((ms) => setTimeout(sync, ms));
  addEventListener("focusin", settle);
  addEventListener("focusout", settle);
  sync();
}

// ── Sheet: drag the handle (or tap it) to expand / collapse ──────────────
{
  const sheet = $("sheet");
  const handle = $("handle");
  let startY = null, startH = 0, moved = false;
  const snap = (to) => {
    sheet.dataset.snap = to;
    sheet.style.removeProperty("height");
  };
  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    startH = sheet.getBoundingClientRect().height;
    moved = false;
    sheet.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) moved = true;
    if (moved) sheet.style.height = `${Math.max(140, startH + dy)}px`;
  });
  const end = (e) => {
    if (startY == null) return;
    const dy = startY - e.clientY;
    sheet.classList.remove("dragging");
    startY = null;
    // Three heights: low (Maker's whole body), rest, full. Tap: low → rest → full → rest.
    const cur = sheet.dataset.snap || "rest";
    if (!moved) snap(cur === "rest" ? "full" : "rest");
    else if (dy > 40) snap(cur === "low" ? "rest" : "full");
    else if (dy < -40) snap(cur === "full" ? "rest" : "low");
    else snap(cur);
  };
  // The stage changes size with the sheet: let the 3D re-fit its canvas.
  new MutationObserver(() => setTimeout(() => dispatchEvent(new Event("resize")), 320)).observe(sheet, { attributes: true, attributeFilter: ["data-snap"] });
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ── Pixel icons ──────────────────────────────────────────────────────────
// A speech bubble: a question to ask Maker (the suggested ones under the chat).
const BUBBLE = [
  ".XXXXXXXX.",
  "X........X",
  "X.XX.XX..X",
  "X........X",
  ".XXXXXXXX.",
  "..XX......",
  "..X.......",
];
// A tick for a finished quest line.
const CHECK = [
  "......XX",
  ".....XX.",
  "XX..XX..",
  ".XXXX...",
  "..XX....",
];
// The pixel invader after "About Maker" (the same one as on Alex's card).
const INVADER = [
  "..X.....X..",
  "...X...X...",
  "..XXXXXXX..",
  ".XX.XXX.XX.",
  "XXXXXXXXXXX",
  "X.XXXXXXX.X",
  "X.X.....X.X",
  "...XX.XX...",
];
const PIX = {
  mic: ["...XXX...", "..X...X..", "..X...X..", "..X...X..", "..X...X..", "X..XXX..X", "X.......X", ".X.....X.", "..XXXXX..", "....X....", "....X....", "..XXXXX.."],
  mute: ["...X.......", "..XX..X...X", "XXXX...X.X.", "XXXX....X..", "XXXX...X.X.", "..XX..X...X", "...X......."],
  on: ["...X....X..", "..XX..X..X.", "XXXX...X..X", "XXXX...X..X", "XXXX...X..X", "..XX..X..X.", "...X....X.."],
};
function drawIcon(svg, name) {
  const rows = PIX[name];
  let d = "";
  rows.forEach((r, y) => [...r].forEach((c, x) => c === "X" && (d += `M${x} ${y}h1v1h-1z`)));
  svg.setAttribute("viewBox", `0 0 ${rows[0].length} ${rows.length}`);
  svg.innerHTML = `<path d="${d}" fill="currentColor"/>`;
}
for (const svg of document.querySelectorAll("[data-icon]")) drawIcon(svg, svg.dataset.icon);

// ── Animations ───────────────────────────────────────────────────────────
let tick = 0;
let listenStart = 0;
const meterBars = Array.from({ length: 16 }, () => $("meter").appendChild(el("i")));
const bar = (n, f) => `[${"■".repeat(f)}${"□".repeat(n - f)}]`;
setInterval(() => {
  tick++;
  for (const b of document.querySelectorAll(".waitbar")) {
    const n = Number(b.dataset.bar);
    b.textContent = bar(n, Math.floor(tick / 2) % (n + 1));
  }
  if (state === "listening") {
    meterBars.forEach((m, i) => (m.style.height = `${Math.round(8 + Math.abs(Math.sin(tick * 0.7 + i * 1.3) * Math.cos(tick * 0.31 + i * 0.5)) * 38)}px`));
    $("timer").textContent = `● 00:${String(Math.min(59, Math.floor((Date.now() - listenStart) / 1000))).padStart(2, "0")}`;
  }
  if (!ready && state === "landing") $("stage-chip").textContent = `LOADING LIVE 3D ${bar(4, Math.floor(tick / 3) % 5)}`;
  // Loading: ten cells fill up and start over (the design's progress row;
  // the presenter reports no real percentage, so no number is invented).
  if (!ready) {
    const n = Math.floor(tick / 2) % 11;
    const cells = $("credit-bar");
    if (cells.childElementCount !== 10) cells.replaceChildren(...Array.from({ length: 10 }, () => el("i")));
    [...cells.children].forEach((c, i) => c.classList.toggle("on", i < n));
    $("credit-label").textContent = t("loadingMaker");
  }
}, 180);

// ── State & layout ───────────────────────────────────────────────────────

function setState(next) {
  state = next;
  body.dataset.state = next;
  layoutStage();
  renderChip();
  $("info-status").textContent =
    { thinking: "想一下… · matching", answer: soundOn ? "speaking" : "captions · 字幕", limit: "resting · 休息中", listening: "mic open" }[next] ?? "ready";
  $("hold").disabled = $("send").disabled = next === "thinking";
  if (next === "landing") requestAnimationFrame(measureLanding);
}

/** Maker is always on stage except for the agenda / offline lists. */
// While chatting, Maker's face fills the stage, resting on the chat box —
// expressions and the moving mouth up close. Dragging the
// chat box down brings his whole body back. ?face=0 turns it off for the tab.
const FACE = (() => {
  const q = new URLSearchParams(location.search).get("face");
  try {
    if (q !== null) sessionStorage.setItem("maker-face", q === "0" ? "off" : "on");
    return sessionStorage.getItem("maker-face") !== "off";
  } catch {
    return q !== "0";
  }
})();
if (FACE) body.classList.add("face");

function layoutStage() {
  body.dataset.stage = state === "agenda" || state === "offline" ? "none" : "full";
  // The 3D re-fits its canvas on a window resize: tell it the stage changed.
  if (FACE) setTimeout(() => dispatchEvent(new Event("resize")), 350);
  applyCamera();
}

// Full body — the presenter's default half-body framing cuts Maker off.
let cameraAngle = null;
function applyCamera() {
  if (!ready || typeof presenter.updateCameraAngle !== "function") return;
  const want = "fullbody";
  if (want === cameraAngle) return;
  cameraAngle = want;
  try { presenter.updateCameraAngle(want); } catch (err) { console.warn(`camera: ${err.message}`); }
}

let flashUntil = 0;
/** A short notice on the stage chip (e.g. why there's no sound). */
function flash(text, ms = 4_000) {
  const chip = $("stage-chip");
  chip.className = "stage-chip";
  chip.textContent = text;
  chip.hidden = false;
  flashUntil = Date.now() + ms;
  setTimeout(() => Date.now() >= flashUntil && renderChip(), ms + 50);
}

function renderChip() {
  if (Date.now() < flashUntil) return;
  const chip = $("stage-chip");
  chip.className = "stage-chip";
  if (state === "landing" && !ready) chip.hidden = false;
  else if (state === "listening") {
    chip.textContent = "● MIC OPEN";
    chip.classList.add("listen");
    chip.hidden = false;
  } else chip.hidden = true;
}

function renderQuota() {
  // .q-count / .q-limit, not .limit — that's also the limit pane's class.
  for (const c of document.querySelectorAll(".q-count")) c.textContent = String(used).padStart(2, "0");
  for (const c of document.querySelectorAll(".q-limit")) c.textContent = String(limit);
  const cells = 10;
  $("info-bar").textContent = `${bar(cells, Math.min(cells, Math.round((used / limit) * cells)))} ${String(used).padStart(2, "0")}/${limit}`;
}

function setLang(next, { chosen = false } = {}) {
  if (!eventLangs().includes(next)) return;
  lang = next;
  storage.set("maker-lang-v2", lang); // the program page reads it
  if (chosen) storage.set("maker-lang-choice", lang); // tapped a language: keep it
  // Only this event's languages get a button.
  for (const b of document.querySelectorAll("[data-lang]")) b.hidden = !eventLangs().includes(b.dataset.lang);
  document.documentElement.lang = HTML_LANG[lang];
  for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  $("match").textContent = t("match");
  $("land-text").textContent = t("land");
  $("start-label").textContent = t("start");
  $("start-sub").textContent = t("startSub");
  renderCheckin();
  $("print1").textContent = t("print1");
  $("print2").textContent = t("print2");
  if (cfg?.demo) renderDemoGuests(); // its own fine print
  // "About Maker": only when persona.md tells his story.
  const about = cfg?.persona?.about ?? {};
  $("about-link").hidden = !(about.sections?.length || about.hello);
  $("about-link").replaceChildren(t("aboutLink"), pixelIcon(INVADER)); // a pixel invader, not an arrow
  if (!$("about").hidden) renderAbout();
  if (cfg) document.title = `${cfg.persona.name} · ${pickL(cfg.event.name)}`;
  if (!$("no-perxona").hidden) $("no-perxona").textContent = t("noPerxona");
  $("greet").textContent = t("greet");
  $("inapp").textContent = t("inapp");
  $("inapp").hidden = !IN_APP;
  $("greet-sub").textContent = t("sub");
  for (const a of document.querySelectorAll(".optin")) {
    a.querySelector(".optin-q").textContent = t("opt");
    a.querySelector(".optin-cta").textContent = t("optCta");
  }
  $("q").placeholder = t("ph");
  $("hold-label").textContent = t("hold");
  $("listen-box").textContent = t("listen");
  $("release-label").textContent = t("release");
  $("cancel-label").textContent = t("cancel");
  $("limit-text").textContent = t("limit", { n: limit });
  $("agenda-label").textContent = t("agenda");
  $("back-label").textContent = t("back");
  $("agenda-note").textContent = state === "offline" ? t("cached") : "";
  renderChips();
  renderSound();
}

// ── Quick-ask row ────────────────────────────────────────────────────────
// One row of three under the chat. Before anything's been asked: the fixed
// three (Match me / Topic tables / Agenda). After an answer: Maker's two
// suggested next steps for *this* conversation, plus one general event
// question the visitor hasn't asked yet.
let suggested = []; // the newest answer's followups
let tourQs = {}; // button label → question, for the "not now" tour buttons
const asked = new Set(); // questions sent, so the general one doesn't repeat

/**
 * One row under the chat: yellow "Match me"
 * first, then Maker's suggested questions for this conversation (💬, they
 * ask him). Agenda, demo speakers and topic tables live in the ☰ menu by the
 * field: Maker answers with a line, the way into that part of the program,
 * and two topics to ask (jumping straight to the program made Maker look
 * like a website).
 */
function renderChips() {
  const [match] = t("chips");
  const ask1 = el("button", "main", match[0]);
  ask1.type = "button";
  ask1.addEventListener("click", () => { tap("match"); ask(match[1], { chip: true }); });
  const next = suggested.filter((q) => q && q !== match[1] && q !== match[0]).slice(0, 2).map((q) => {
    const b = el("button", "ask");
    b.append(pixelIcon(BUBBLE), q);
    b.type = "button";
    b.addEventListener("click", () => { tap("followup"); ask(q, { chip: true }); });
    return b;
  });
  $("chips").replaceChildren(ask1, ...next);
  $("chips").scrollLeft = 0;
  renderMenu();
}

function renderMenu() {
  const item = (label, hash, what) => {
    const b = el("button", "", label);
    b.type = "button";
    b.addEventListener("click", () => { toggleMenu(false); tap(what); nudge(what, { label, hash }); });
    return b;
  };
  $("menu-pop").replaceChildren(
    item(t("qbAgenda"), "s-agenda", "agenda"),
    item(t("qbDemos"), "s-demos", "demos"),
    item(t("qbTables"), "s-tables", "tables"),
  );
}
function toggleMenu(open = $("menu-pop").hidden) {
  $("menu-pop").hidden = !open;
  $("menu").setAttribute("aria-expanded", String(open));
}
$("menu").addEventListener("click", () => toggleMenu());
addEventListener("pointerdown", (e) => { if (!$("menu-pop").hidden && !e.target.closest?.("#menu, #menu-pop")) toggleMenu(false); });
for (const b of document.querySelectorAll("[data-lang]")) b.addEventListener("click", () => {
  setLang(b.dataset.lang, { chosen: true });
});

// ── Sound ────────────────────────────────────────────────────────────────

function renderSound() {
  const b = $("sound");
  b.setAttribute("aria-pressed", String(soundOn));
  $("sound-label").textContent = soundOn ? t("on") : t("mute");
  drawIcon(b.querySelector("svg"), soundOn ? "on" : "mute");
}
$("sound").addEventListener("click", async () => {
  soundOn = !soundOn;
  renderSound();
  if (soundOn) {
    await unlockAudio(); // this tap is the gesture iOS needs
    presenter.muteAudio?.(false);
    // He starts talking right away, so you know it worked: on About, the
    // part you're on; in the chat, his last answer; otherwise hello.
    if (body.classList.contains("about-open")) {
      aboutSaid.delete(aboutSec);
      aboutTalking = false;
      aboutVisit++;
      talkAbout(aboutSec);
      return;
    }
    const last = turns.filter((x) => x.role === "assistant").at(-1);
    const hello = String(cfg?.persona?.greeting?.[lang] ?? "").trim();
    speak(last?.text ?? (hello || t("soundHi")), { emotion: last ? "joy" : "excitement" });
  } else {
    presenter.muteAudio?.(true); // keeps talking (and moving his mouth), silently
  }
});

// Resume on every gesture, not just the first: a tap before the 3D was
// ready, or iOS suspending audio in the background, leaves it silent.
// Any tap anywhere counts (chips, follow-ups, the sheet), not only buttons
// that call this directly.
addEventListener("pointerdown", () => unlockAudio(), { capture: true, passive: true });
async function unlockAudio() {
  // iOS Safari 16.4+: play like a media app, so the silent switch doesn't mute Maker.
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {}
  try {
    await presenter.resumeAudioPlayback?.();
    audioUnlocked = true;
  } catch {}
}

// ── Body language ────────────────────────────────────────────────────────
// Maker always moves, sound or not. Captions mode is muted speech, so his
// mouth and gestures still play; mime() acts an answer out with motions only,
// for when speech fails. Motions need no audio unlock.

const BIG = new Set(["joy", "excitement", "admiration", "gratitude", "surprise", "realization"]);
const NO = new Set(["confusion", "embarrassment", "disappointment", "sadness", "annoyance"]);
let act = 0; // bumps to cancel a running performance
let lastActive = Date.now();

function moves(category) {
  return (cfg?.motions ?? []).filter((m) => m.category === category).map((m) => m.id);
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function move(id) {
  if (!ready || !id) return;
  lastActive = Date.now();
  presenter.playMotion?.(id).then((r) => r?.success === false && console.warn(`playMotion failed (${r.code})`));
}

/** A big moment: backflip if he has one, else any gesture. */
function flourish() {
  move(pick(moves("emotion")) ?? pick(moves("talking")));
}

function pose({ thinking = false, listening = false } = {}) {
  if (!ready) return;
  presenter.setThinking?.(thinking);
  presenter.setListening?.(listening);
  if (thinking || listening) lastActive = Date.now();
}

/** Act out an answer without sound: an opening beat, then gestures for as long as it'd take to say. */
async function mime(text, { emotion, fallback, people } = {}) {
  const me = ++act;
  const talk = moves("talking");
  if (fallback || NO.has(emotion)) move(pick(moves("error")));
  else if (people || BIG.has(emotion)) flourish();
  else move(pick(talk));
  let left = Math.min(10_000, Math.max(3_000, text.length * 90)) - 2_600;
  let i = 0;
  while (left > 0) {
    await wait(2_600);
    if (me !== act || state !== "answer") return;
    move(talk[i++ % talk.length]);
    left -= 2_600;
  }
}

// A line asked for before the 3D was ready is said as soon as it is (if
// that's within 30 s), instead of being lost.
let pendingLine = null;
function sayPending() {
  const p = pendingLine;
  pendingLine = null;
  if (p && Date.now() - p.at < 30_000) speak(p.text, p.opts);
}

async function speak(text, opts = {}) {
  if (DEBUG) flash(`SPEAK · ready=${ready} sound=${soundOn} audio=${audioUnlocked} voice=${voiceMode()?.tts ?? "perxona"} · ${String(text).slice(0, 14)}`, 4_000);
  if (!text) return;
  if (!ready) {
    pendingLine = { text, opts, at: Date.now() };
    return;
  }
  pose(); // answering beats thinking/listening
  act++;
  presenter.interruptPresentation?.();
  // Captions mode still speaks, just muted: that's what moves his mouth
  // (lip-sync comes from the speech). Only the sound is off.
  presenter.muteAudio?.(!soundOn);
  if (opts.people || BIG.has(opts.emotion)) flourish();
  const r = (outsideVoice() && (await presentOpenAI(text, opts))) || (await presenter.present(text, { emotion: opts.emotion, intensity: "high" })); // never throws; check success
  if (!r?.success && r?.code !== "303") {
    // 303 = interrupted by a newer answer, which is fine. Anything else: say so
    // and still act it out, rather than standing there silently.
    console.warn(`present() failed (${r?.code}): ${r?.message ?? ""}`);
    if (soundOn && audioUnlocked) flash(`${t("noSound")} · ${r?.code ?? "?"}`, 6_000);
    mime(text, opts);
  }
}

const voiceEvent = (ok, reason) =>
  fetch("/api/voice-event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok, reason }), keepalive: true }).catch(() => {});

const visitorToken = () => me?.token; // the checked-in visitor ("me", further down)

/** The trial voice: MP3 from our server, played (and lip-synced) by the presenter. Null = fall back. */
async function presentOpenAI(text, opts) {
  const line = act; // which line this is (a newer one interrupts)
  const t0 = Date.now();
  const mode = voiceMode();
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, voice: mode.voice, provider: mode.tts, emotion: opts.emotion, model: mode.model, tune: mode.tune, speed: mode.speed, me: visitorToken() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const audio = await res.arrayBuffer();
    const fetched = Date.now() - t0;
    if (line !== act) return { success: false, code: "303" }; // a newer answer took over
    const r = await presenter.presentWithAudio(audio, text, { emotion: opts.emotion, intensity: "high" });
    voiceEvent(!!r?.success, r?.success ? "" : `play ${r?.code}`);
    if (r?.success) watchPlayback(audio, text, opts, line);
    // Trial only: say on screen what happened, since a phone has no console.
    if (TRIAL || DEBUG) flash(`${mode.tts.toUpperCase()} ${fetched}ms · ${Math.round(audio.byteLength / 1024)}KB · ${r?.success ? "PLAY OK" : `✕ ${r?.code} ${r?.message ?? ""}`.slice(0, 80)}`, 8_000);
    return r?.success ? r : (console.warn(`presentWithAudio failed (${r?.code}): ${r?.message ?? ""}`), null);
  } catch (err) {
    console.warn(`openai voice: ${err.message}`);
    voiceEvent(false, err.name === "TimeoutError" ? "timeout" : err.message);
    if (TRIAL || DEBUG) flash(`${mode.tts.toUpperCase()} VOICE ✕ ${err.message}`, 6_000);
    return null;
  }
}

/**
 * "Success" from presentWithAudio only means queued. If the clip finishes
 * far sooner than its length (it never really played — seen on an iPhone),
 * say the line again with Perxona's own voice and record it.
 */
function watchPlayback(audio, text, opts, me) {
  const v = new DataView(audio);
  const isWav = audio.byteLength > 44 && v.getUint32(0) === 0x52494646; // "RIFF"
  if (!isWav) return;
  const seconds = (audio.byteLength - 44) / (v.getUint32(24, true) * 2);
  if (seconds < 2) return;
  const started = Date.now();
  const onEnd = () => {
    presenter.removeEventListener("ALL_PERFORMANCE_FINISHED", onEnd);
    const played = (Date.now() - started) / 1000;
    if (me !== act || played >= seconds * 0.5) return; // fine, or a newer answer interrupted it
    voiceEvent(false, `ended early ${played.toFixed(1)}/${seconds.toFixed(1)}s`);
    if (DEBUG || TRIAL) flash(`VOICE ✕ ended early ${played.toFixed(1)}s of ${seconds.toFixed(1)}s → Perxona voice`, 8_000);
    presenter.present(text, { emotion: opts.emotion, intensity: "high" });
  };
  presenter.addEventListener("ALL_PERFORMANCE_FINISHED", onEnd);
  setTimeout(() => presenter.removeEventListener("ALL_PERFORMANCE_FINISHED", onEnd), (seconds + 15) * 1000);
}

// Never stands still for long: a random fidget when nobody's talking to him.
setInterval(() => {
  if (!ready || document.visibilityState !== "visible") return;
  if (!["landing", "empty", "answer", "limit"].includes(state)) return;
  if (Date.now() - lastActive < 9_000 + Math.random() * 6_000) return;
  Math.random() < 0.3 ? flourish() : move(pick([...moves("talking"), ...moves("error"), ...moves("listening")]));
}, 3_000);

// ── Avatar (with a picture until it's ready, and if it never is) ─────────

function attachPresenter(node) {
  node.addEventListener("PRESENTER_STATUS", (e) => {
    if (node !== presenter) return;
    const was = ready;
    ready = e.detail?.status === "Ready";
    if (ready) logoHome();
    if (ready && !was) setTimeout(sayPending, 300);
    if (ready && !was && body.classList.contains("about-open")) setTimeout(() => talkAbout(aboutSec), 900); // About opened before he was on stage
    if (ready && !was) setTimeout(flourish, 800); // ta-da, he's here
    body.classList.toggle("avatar-ready", ready);
    // The 3D streams in in parts: at "Ready" his body can be there before his
    // head. The picture stays a moment longer, so nobody sees him headless.
    if (ready && !was && !body.classList.contains("avatar-shown")) setTimeout(() => body.classList.add("avatar-shown"), 2500);
    cameraAngle = null; // a (re)initialised presenter starts at its default framing
    applyCamera();
    renderChip();
  });
}
attachPresenter(presenter);

// ?avatar=<Perxona avatar id>: try another character on this phone (remembered for the tab).
const AVATAR_TRIAL = (() => {
  const q = new URLSearchParams(location.search).get("avatar") ?? "";
  try {
    if (/^[0-9A-Z]{26}$/.test(q)) sessionStorage.setItem("maker-avatar", q);
    return sessionStorage.getItem("maker-avatar") || "";
  } catch {
    return /^[0-9A-Z]{26}$/.test(q) ? q : "";
  }
})();

async function connectAvatar() {
  const { sceneId } = cfg.target;
  const avatarId = AVATAR_TRIAL || cfg.target.avatarId;
  // ?voice=<Perxona voice id> tries another Perxona voice on this phone only.
  // Only a real id (26-char ULID) counts: ?voice=ash belongs to the GPT trial.
  const asked = new URLSearchParams(location.search).get("voice") ?? "";
  const voiceId = /^[0-9A-Z]{26}$/.test(asked) ? asked : cfg.target.voiceId;
  if (!avatarId || !sceneId || !voiceId) return;
  await new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { type: "module", src: cfg.presenterUrl, onload: resolve, onerror: reject });
    document.head.append(s);
  });
  await customElements.whenDefined("sv-presenter");
  const { connect_key } = await api("/api/connect-key");
  await presenter.initializeWithConnectKey(connect_key, { avatarId, sceneId, voiceId });
}

// ── Conversation ─────────────────────────────────────────────────────────

async function api(url, payload) {
  const res = await fetch(url, {
    method: payload ? "POST" : "GET",
    // The check-in token rides in a header, never in the address (access logs).
    headers: { "X-Device": deviceId, ...(me?.token ? { "X-Token": me.token } : {}), ...(payload ? { "Content-Type": "application/json" } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { status: res.status, data });
  return data;
}

/** Scroll so `item` starts at the top of the thread (default: the very end). */
/**
 * Bring the start of `item` (an answer) to the top of the thread, or the
 * bottom when there's none. The sheet opening and pictures loading move
 * things for a moment, so it re-aims a few times — unless the visitor has
 * started scrolling themselves.
 */
let scrollGen = 0;
function scrollThread(item) {
  const th = $("thread");
  const gen = ++scrollGen;
  const target = () => (item ? th.scrollTop + item.getBoundingClientRect().top - th.getBoundingClientRect().top - 12 : th.scrollHeight);
  const aim = () => {
    if (gen !== scrollGen) return;
    const top = target();
    if (Math.abs(th.scrollTop - top) > 4) th.scrollTo({ top, behavior: "smooth" });
  };
  const stop = () => (scrollGen += gen === scrollGen ? 1 : 0);
  th.addEventListener("touchstart", stop, { once: true, passive: true });
  th.addEventListener("wheel", stop, { once: true, passive: true });
  requestAnimationFrame(aim);
  for (const ms of [400, 900, 1600]) setTimeout(aim, ms);
  for (const img of item?.parentElement?.querySelectorAll?.("img") ?? []) if (!img.complete) img.addEventListener("load", aim, { once: true });
}

function addQuestion(text) {
  $("thread").append(el("div", "q", text));
}

function thinkingItem() {
  const a = el("div", "a thinking");
  const box = el("span", "box", t("thinking"));
  box.lang = HTML_LANG[lang];
  const m = el("div", "mono");
  m.append(el("span", "waitbar", ""), el("br"), el("span", "dim", "> matching attendees"));
  m.querySelector(".waitbar").dataset.bar = "10";
  a.append(el("div", "who", `${(cfg?.persona.name ?? "MAKER").toUpperCase()} >`), box, m);
  return a;
}

function addAnswer(out) {
  for (const old of document.querySelectorAll(".thread .a:not(.thinking)")) old.classList.add("old");
  clearFollowups();
  const a = el("div", "a");
  a.append(el("div", "who", `${(cfg?.persona.name ?? "MAKER").toUpperCase()} >${soundOn && !out.fallback ? " ▶ SPEAKING" : ""}`));
  const p = el("p", "", out.reply);
  p.lang = HTML_LANG[out.lang] ?? HTML_LANG[lang];
  a.append(p);
  const items = [a];
  // Each group under its own label, so a person's card and a table's card
  // never read as one thing ("Sam leads table 3").
  if (out.people?.length) items.push(el("p", "group-label", `> ${t("groupPeople")}`));
  (out.people ?? []).forEach((person, i) => {
    const card = el("div", "card");
    const head = el("div", "card-head");
    // Already in the reply's language (the server picks); a page saved
    // before that may still hold { en, zh, ja }.
    const role = pickL(person.role, out.lang ?? lang);
    head.append(el("b", "", pickL(person.name, out.lang ?? lang)), el("span", "", `${String(i + 1).padStart(2, "0")}${role ? ` · ${role.toUpperCase().slice(0, 22)}` : ""}`));
    card.append(head, el("p", "", pickL(person.building, out.lang ?? lang)));
    if (person.url) {
      const link = el("a", "", person.qr === "linkedin" ? t("openLinkedIn") : t("openSite"));
      link.href = person.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.append(el("span", "mono", "↗"));
      card.append(link);
    }
    items.push(card);
  });
  if (out.link?.url && !out.link.url.startsWith("/m/guide.html")) {
    const box = el("div", "card link-card");
    const label = pickL(out.link.label, out.lang ?? lang) || out.link.url;
    if (out.link.url.startsWith("/m/guide.html")) {
      // Tonight's program opens over the chat, not in another tab.
      const b = linkButton(out.link.url, label);
      b.addEventListener("click", (e) => { e.preventDefault(); openGuide(""); });
      box.append(b);
    } else box.append(linkButton(out.link.url, label));
    items.push(box);
  }
  // The agenda, the demo speakers and all the tables are behind the fixed
  // quick buttons below, so answers don't add cards for them.
  // Maker's suggested next steps go in the quick-ask row (renderChips).
  suggested = out.fallback ? [] : out.followups ?? [];
  tourQs = {};
  renderChips();
  // One "people to meet" heading for attendees and featured people alike.
  if (out.featured?.length && !out.people?.length) items.push(el("p", "group-label", `> ${t("groupFeatured")}`));
  for (const f of out.featured ?? []) items.push(featuredCardEl(f, out.lang ?? lang));
  if (out.tables?.length) items.push(el("p", "group-label", `> ${t("groupTables")}`));
  for (const tb of out.tables ?? []) {
    const full = cfg?.event?.tables?.find((x) => String(x.table) === String(tb.table));
    const { head: title, detail } = topicParts(full ?? tb, out.lang ?? lang);
    const card = el("div", "card table-card");
    const head = el("div", "card-head");
    head.append(el("b", "", `TABLE ${tb.table}`), el("span", "", pickL(full?.language ?? tb.language, out.lang ?? lang)));
    card.append(head, el("p", "table-title", title));
    if (detail) card.append(el("p", "", detail));
    if (tb.host) {
      let hostName = pickL(tb.host, out.lang ?? lang).replace(/\s*\(.*\)$/, "");
      const f = cfg?.event?.featured?.find((x) => nameIs(x.name, hostName));
      if (f) hostName = pickL(f.name, out.lang ?? lang);
      const row = el("div", "table-host-row");
      if (f?.photo) {
        const img = el("img", "host-photo");
        img.src = f.photo;
        img.alt = "";
        row.append(img);
      }
      const who = el("p", "table-host", `${t("hostedBy")} ${hostName}`);
      if (f?.title) who.append(el("span", "table-host-title", pickL(f.title, out.lang ?? lang)));
      row.append(who);
      card.append(row);
      if (f?.linkedin) card.append(linkButton(f.linkedin, t("openLinkedIn")));
    }
    items.push(card);
  }
  // The part of the program a quick button is about, as tonight's quest:
  // three things to see, ticked off as they're opened.
  if (out.guide) {
    document.querySelectorAll(".thread .quest").forEach((q) => q.remove()); // only the newest
    items.push(questCard(out.guide));
  }
  // Two things to ask next are in the row under the chat (renderChips).
  $("thread").append(...items);
  return a;
}

// ── Tonight's quest ─────────────────────────────────────────────────────
// The agenda, the demo speakers and the topic tables as an RPG quest list:
// each line opens that part of the program and gets ticked off (this phone
// only). All three done: Maker celebrates.
const QUEST = [["s-agenda", "qAgenda"], ["s-demos", "qDemos"], ["s-tables", "qTables"]];
const questKey = () => `maker-quest:${pickL(cfg?.event?.name, "en")}:${cfg?.event?.date ?? ""}`; // per event
function questDone() {
  try {
    return new Set(JSON.parse(storage.get(questKey()) || "[]"));
  } catch {
    return new Set();
  }
}
function questCard(current) {
  const card = el("div", "quest");
  card.dataset.current = current;
  fillQuest(card);
  return card;
}
function fillQuest(card) {
  const done = questDone();
  const all = QUEST.every(([h]) => done.has(h));
  const head = el("div", "quest-head");
  head.append(el("span", "", `QUEST · ${all ? t("questDone") : t("questTitle")}`), el("span", "", `${QUEST.filter(([h]) => done.has(h)).length}/${QUEST.length}`));
  const rows = QUEST.map(([hash, key]) => {
    const b = el("button", "quest-row");
    b.type = "button";
    b.classList.toggle("done", done.has(hash));
    b.classList.toggle("now", hash === card.dataset.current && !done.has(hash));
    const box = el("span", "quest-box");
    if (done.has(hash)) box.append(pixelIcon(CHECK));
    b.append(box, el("span", "quest-text", t(key)), el("span", "quest-go", "▸"));
    b.addEventListener("click", () => {
      tap(`open-${hash}`);
      const before = questDone();
      if (!before.has(hash)) {
        before.add(hash);
        storage.set(questKey(), JSON.stringify([...before]));
        document.querySelectorAll(".quest").forEach(fillQuest);
        if (QUEST.every(([h]) => before.has(h))) flourish(); // quest complete
      }
      openGuide(hash);
    });
    return b;
  });
  card.replaceChildren(head, ...rows);
  card.classList.toggle("complete", all);
}

/** Only the newest answer's suggestions can be tapped. */
const clearFollowups = () => document.querySelectorAll(".thread .follow").forEach((r) => r.remove());

/**
 * Maker speaks up without an AI call: a quick button was tapped (kind =
 * agenda / demos / tables), or the visitor has gone quiet ("idle"). Costs
 * no question. Offline, a quick button still opens the program.
 */
let nudging = false;
async function nudge(kind, { label = "", hash = "" } = {}) {
  if (asking || nudging || !me) return hash && openGuide(hash);
  nudging = true;
  try {
    const out = await api(`/api/nudge?kind=${kind}&lang=${lang}`);
    if (label) {
      addQuestion(label);
      turns.push({ role: "user", text: label });
    }
    turns.push({ role: "assistant", text: out.reply });
    log.push({ q: label, out: { reply: out.reply, lang: out.lang, guide: out.guide, followups: out.followups } });
    chat.save({ turns: turns.slice(-6), log: log.slice(-20) });
    const a = addAnswer(out);
    if (state !== "offline") setState("answer");
    scrollThread(a);
    speak(out.reply, { emotion: kind === "idle" ? "curiosity" : "joy" });
    armIdle();
  } catch {
    if (hash) openGuide(hash);
  } finally {
    nudging = false;
  }
}

// Gone quiet after an answer: Maker offers something, at most twice a visit.
const IDLE_MS = (Number(new URLSearchParams(location.search).get("idle")) || 30) * 1000; // ?idle=5 to rehearse
let idleTimer = null;
let idleNudges = 0;
function armIdle() {
  clearTimeout(idleTimer);
  if (idleNudges >= 2) return;
  idleTimer = setTimeout(() => {
    if (state !== "answer" || asking || used >= limit || document.visibilityState !== "visible" || !$("guide-overlay").hidden) return armIdle();
    idleNudges++;
    nudge("idle");
  }, IDLE_MS);
}
for (const ev of ["pointerdown", "keydown", "scroll"]) addEventListener(ev, () => idleTimer && armIdle(), { passive: true, capture: true });

// ── Agenda picture ───────────────────────────────────────────────────────
// Asked about the agenda → a picture of it under the answer. Tap opens it
// big, to save (share sheet → Save Image) or press-and-hold like any photo.

// kind: "agenda" | "tables"
const pics = new Map(); // "kind:lang" → Promise<{ blob, url }>
const PIC = { agenda: { make: agendaImage, card: "agendaCard", file: "maker-agenda.png" }, tables: { make: tablesImage, card: "tablesCard", file: "maker-topic-tables.png" } };
function pic(kind, forLang) {
  const key = `${kind}:${forLang}`;
  if (!pics.has(key)) {
    pics.set(key, PIC[kind].make({ event: cfg.event, lang: forLang }).then((blob) => ({ blob, url: URL.createObjectURL(blob) })));
  }
  return pics.get(key);
}

function picCard(kind, forLang) {
  const card = el("button", "agenda-card");
  card.type = "button";
  const img = el("img");
  img.alt = t(PIC[kind].card);
  card.append(img, el("span", "", t(PIC[kind].card)));
  pic(kind, forLang).then(({ url }) => (img.src = url)).catch(() => card.remove());
  card.addEventListener("click", () => openPic(kind, forLang));
  return card;
}

async function openPic(kind, forLang) {
  const { blob, url } = await pic(kind, forLang);
  const box = $("lightbox");
  box.querySelector("img").src = url;
  $("lb-save").textContent = t("save");
  $("lb-hint").textContent = t("saveHint");
  $("lb-close").setAttribute("aria-label", t("close"));
  box.hidden = false;
  $("lb-save").onclick = async () => {
    const file = new File([blob], PIC[kind].file, { type: "image/png" });
    // Phones: the share sheet has "Save Image". Elsewhere: a plain download.
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch {}
    } else {
      const a = Object.assign(document.createElement("a"), { href: url, download: PIC[kind].file });
      a.click();
    }
  };
}
$("lb-close").addEventListener("click", () => ($("lightbox").hidden = true));
$("lightbox").addEventListener("click", (e) => e.target === $("lightbox") && ($("lightbox").hidden = true));

async function ask(text, { chip = false } = {}) {
  text = String(text ?? "").trim();
  if (!text || asking) return;
  if (!me) return signOut(); // Maker is only for tonight's checked-in attendees
  asked.add(text);
  if (used >= limit) return setState("limit");
  clearTimeout(idleTimer);
  clearFollowups();
  asking = true;
  $("q").value = "";
  $("q").blur();
  $("q").parentElement.classList.remove("has-text");
  addQuestion(text);
  const thinking = thinkingItem();
  $("thread").append(thinking);
  setState("thinking");
  scrollThread();
  presenter.interruptPresentation?.();
  act++;
  pose({ thinking: true });

  turns.push({ role: "user", text });
  let out;
  try {
    out = await api("/api/ask", { turns: turns.slice(-6), lang, me: me?.token });
    used = out.used ?? used + 1;
    limit = out.limit ?? limit;
    setOffline(false);
  } catch (err) {
    if (err.status === 410) {
      thinking.remove();
      asking = false;
      pose();
      return showClosed();
    }
    if (err.status === 401) {
      // Not (or no longer) checked in — e.g. staff undid it.
      thinking.remove();
      asking = false;
      pose();
      return signOut(t("ciNotFound"));
    }
    if (err.status === 429 && err.data?.limited === "device") {
      used = err.data.used ?? limit;
      limit = err.data.limit ?? limit;
      out = null;
    } else if (err.status === 429 && err.data?.limited === "day") {
      out = { reply: t("dayLimit"), lang, fallback: "busy" };
    } else if (err.status === 429) {
      out = { reply: t("busy"), lang, fallback: "busy" };
    } else {
      out = { reply: t("lost"), lang, fallback: "down" };
      if (!navigator.onLine || err.name === "TypeError" || err.name === "TimeoutError") setOffline(true);
    }
  }
  thinking.remove();
  asking = false;
  pose();
  renderQuota();
  if (!out) {
    turns.pop();
    $("limit-text").textContent = t("limit", { n: limit });
    return setState("limit");
  }
  if (out.fallback) turns.pop();
  else {
    turns.push({ role: "assistant", text: out.reply });
    log.push({ q: text, out: { reply: out.reply, lang: out.lang, people: out.people, tables: out.tables, agenda: out.agenda, tablesCard: out.tablesCard, featured: out.featured, link: out.link, followups: out.followups } });
    chat.save({ turns: turns.slice(-6), log: log.slice(-20) });
  }
  if (out.lang && out.lang !== lang) setLang(out.lang);
  // Show the question with the start of the answer, not the bottom of the cards.
  const answerEl = addAnswer(out);
  // People cards are tall: open the sheet so they're seen (Maker's head stays above).
  $("sheet").dataset.snap = out.people?.length || out.tables?.length || out.agenda ? "full" : "rest";
  $("sheet").style.removeProperty("height");
  if (state !== "offline") setState("answer");
  scrollThread(answerEl); // the start of Maker's answer, every time
  speak(out.reply, { emotion: out.emotion, fallback: !!out.fallback, people: !!out.people?.length });
  armIdle();
  // Maker just showed all the topic tables and asked which one: the tables
  // as buttons (once per phone — a tally for the organisers).
  if (me && out.tablesCard && !out.fallback && !storage.get("maker-interest") && cfg?.event?.tables?.length) askInterest();
}

/** Count a tap (anonymous: just which button). */
const tap = (what) => fetch("/api/tap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what }), keepalive: true }).catch(() => {});

function linkButton(url, label) {
  const link = el("a", "", label);
  link.addEventListener("click", () => tap(/linkedin\.com/.test(url) ? "linkedin" : /\/p\//.test(url) ? "photos" : "site"));
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(el("span", "mono", "↗"));
  return link;
}

/** Tonight's host, a special guest, a speaker or a Topic Lead: photo, title, their role tonight (reader's language), LinkedIn or site. */
function featuredCardEl(f, forLang = lang) {
  const card = el("div", "card featured-card");
  const top = el("div", "featured-top");
  if (f.photo) {
    const img = el("img", "host-photo big");
    img.src = f.photo;
    img.alt = "";
    top.append(img);
  }
  const who = el("div", "featured-who");
  who.append(el("b", "", pickL(f.name, forLang)), el("span", "", pickL(f.title, forLang)));
  top.append(who);
  card.append(top);
  const role = pickL(f.role, forLang);
  if (role) card.append(el("p", "featured-role", role));
  else if (pickL(f.tonight, forLang)) card.append(el("p", "", pickL(f.tonight, forLang)));
  if (f.linkedin) card.append(linkButton(f.linkedin, t("openLinkedIn")));
  else if (f.link) card.append(linkButton(f.link, t("openSite")));
  return card;
}

/** A table's title, and the line under it in the reader's language (detail / zh / ja). */
function topicParts(table, forLang) {
  const head = pickL(table?.topic, forLang);
  const line = pickL({ zh: table?.zh, ja: table?.ja }[forLang], forLang) || pickL(table?.detail, forLang);
  return { head, detail: line };
}

/** "Which topic table are you most curious about?" — a tally for the organisers, one per phone. */
function askInterest() {
  storage.set("maker-interest", "asked");
  const card = el("div", "interest");
  card.append(el("p", "", t("interestQ")));
  const pick = async (table, label) => {
    storage.set("maker-interest", table);
    suggested = [];
    renderChips();
    card.replaceChildren(el("p", "mono dim", `> ${label} · ${t("interestThanks")}`));
    fetch("/api/interest", { method: "POST", headers: { "Content-Type": "application/json", "X-Device": deviceId }, body: JSON.stringify({ table, me: me?.token }) }).catch(() => {});
    // Keep the conversation going: about that table, and who to meet.
    if (table !== "unsure") ask(t("interestAsk", { n: table }), { chip: true });
  };
  for (const tb of cfg.event.tables) {
    const short = pickL(tb.topic);
    const b = el("button", "", `T${tb.table} · ${short}`);
    b.type = "button";
    b.addEventListener("click", () => pick(String(tb.table), `T${tb.table}`));
    card.append(b);
  }
  const unsure = el("button", "ghost", t("interestUnsure"));
  unsure.type = "button";
  unsure.addEventListener("click", () => pick("unsure", t("interestUnsure")));
  card.append(unsure);
  $("thread").append(card);
}

$("inputbar").addEventListener("submit", (e) => {
  e.preventDefault();
  if (soundOn) unlockAudio();
  ask($("q").value);
});
$("q").addEventListener("input", () => $("q").parentElement.classList.toggle("has-text", !!$("q").value.trim()));

// ── Talk: tap to start, then tap send or cancel ──────────────────────────
// (Hold-and-slide felt wrong on phones; two plain taps are what people expect.)
{
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let heard = "";
  let outcome = null; // "send" | "cancel" | null (ended on its own)
  let before = "empty";

  const start = () => {
    if (rec || asking) return;
    if (!Recognition) return $("q").focus();
    unlockAudio();
    presenter.interruptPresentation?.();
    act++;
    pose({ listening: true });
    heard = "";
    outcome = null;
    before = state;
    $("transcript").textContent = "";
    listenStart = Date.now();
    rec = new Recognition();
    rec.lang = SPEECH_LANG[lang];
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      heard = Array.from(ev.results, (r) => r[0].transcript).join("");
      $("transcript").textContent = heard;
    };
    rec.onerror = (ev) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(ev.error)) {
        outcome = "cancel";
        alert(t("noMic"));
      }
    };
    rec.onend = () => {
      rec = null;
      pose();
      // Send on tap — or when the browser stops listening by itself after a
      // pause and we already have words. Cancel throws it away.
      if (state === "landing") return; // went home while listening
      if (outcome !== "cancel" && heard.trim()) ask(heard);
      else setState(before === "landing" ? "empty" : before);
    };
    try {
      rec.start();
      setState("listening");
    } catch {
      rec = null;
    }
  };

  $("hold").addEventListener("click", start);
  $("voice-send").addEventListener("click", () => {
    outcome = "send";
    rec ? rec.stop() : heard.trim() && ask(heard);
  });
  $("voice-cancel").addEventListener("click", () => {
    outcome = "cancel";
    rec ? rec.abort() : setState(before);
  });
}

// ── Landing, limit, agenda ───────────────────────────────────────────────

// ── Check-in ─────────────────────────────────────────────────────────────
// The landing is check-in: type your name, tap. Found on the roster (full
// name only) → checked in, then one question: may Maker introduce you?
// Not found → try again or find staff: only the organiser-approved roster
// gets in, and nothing else (chat, people, speakers) opens before check-in.
// The phone remembers who it checked in as (token from the server).

// Opened from a QR that says where it hangs (?src=door): count the scan once
// per phone, then tidy the address so a shared link doesn't count again.
// The entrance screen's QR also carries a door code (?k=), which check-in
// needs: proof the phone is at the venue. Kept for this visit only.
let doorCode = "";
try { doorCode = sessionStorage.getItem("maker-door") ?? ""; } catch {}
{
  const params = new URLSearchParams(location.search);
  const src = params.get("src");
  if (src && /^[a-z0-9-]{1,20}$/.test(src)) {
    fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json", "X-Device": deviceId }, body: JSON.stringify({ src }) }).catch(() => {});
    params.delete("src");
  }
  const k = params.get("k");
  if (k && /^[0-9a-f]{12}$/.test(k)) {
    doorCode = k;
    try { sessionStorage.setItem("maker-door", k); } catch {}
  }
  params.delete("k");
  if (params.toString() !== new URLSearchParams(location.search).toString()) {
    history.replaceState(history.state, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
}

// ?reset (or "Not you?") forgets this phone's check-in and conversation.
if (new URLSearchParams(location.search).has("reset")) {
  storage.set("maker-me", "null");
  chat.save(null);
}
let me = (() => {
  try { return JSON.parse(storage.get("maker-me") || "null"); } catch { return null; }
})();
const saveMe = () => storage.set("maker-me", JSON.stringify(me));

function renderCheckin() {
  body.classList.toggle("checked", !!me);
  renderChips(); // the program button comes and goes with the check-in
  $("ci-name").placeholder = t("ciName");
  $("ci-label").textContent = t("ciLabel");
  // A real event's check-in needs the entrance screen's QR: say so up front.
  $("ci-hint").hidden = !!me || !cfg?.doorCheckin;
  $("ci-hint").querySelector("span").textContent = t("ciHint");
  if (cfg?.demo) renderDemoGuests();
  if (me) $("notme").textContent = t("notMe", { name: myFirst() });
  if (me) {
    $("start-label").textContent = t("cont", { name: myFirst() });
    $("start-sub").textContent = "";
  }
}

/** Demo: one button per made-up guest; tapping one checks in as them. */
// Pixel icons for the guest cards:
// a space invader, a camera, Taipei 101.
const GUEST_ICONS = [
  ["..X.....X..", "...X...X...", "..XXXXXXX..", ".XX.XXX.XX.", "XXXXXXXXXXX", "X.XXXXXXX.X", "X.X.....X.X", "...XX.XX..."],
  ["...XXX......", "XXXXXXXXXXXX", "X..........X", "X...XXXX...X", "X..X....X..X", "X..X....X..X", "X..X....X..X", "X...XXXX...X", "X..........X", "XXXXXXXXXXXX"],
  ["..X..", ".XXX.", ".X.X.", "XXXXX", ".X.X.", "XXXXX", ".X.X.", "XXXXX", ".X.X.", "XXXXX", ".XXX."],
];
function pixelIcon(rows) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("g-icon");
  svg.style.width = `${(22 * rows[0].length) / rows.length}px`;
  let d = "";
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === "X") d += `M${x} ${y}h1v1h-1z`; });
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

function renderDemoGuests() {
  $("print1").textContent = t("demoFine");
  $("print2").textContent = "";
  if (me) {
    $("ci-choices").hidden = true;
    return ciMsg("");
  }
  ciMsg(t("demoPick"));
  $("ci-choices").replaceChildren(
    ...cfg.demo.guests.map((g, i) => {
      // A sticker card: pixel icon and arrow on top, role and name below.
      const loc = (o) => pickL(o);
      const b = el("button", "guest");
      b.setAttribute("aria-label", loc(g.label));
      const top = el("span", "g-top");
      top.append(pixelIcon(GUEST_ICONS[i % GUEST_ICONS.length]), el("span", "g-go", "→"));
      const bottom = el("span", "g-who");
      const name = loc(g.short) || loc(g.label);
      const nameEl = el("span", "g-name", name);
      if (/[\u3000-\u9fff]/.test(name)) nameEl.classList.add("cjk");
      bottom.append(el("span", "g-role", loc(g.role)), nameEl);
      b.append(top, bottom);
      b.type = "button";
      b.addEventListener("click", () => {
        unlockAudio(); // this tap is the gesture the browser needs for sound
        demoCheckIn(i);
      });
      return b;
    }),
  );
  $("ci-choices").hidden = false;
}

async function demoCheckIn(guest) {
  for (const b of $("ci-choices").querySelectorAll("button")) b.disabled = true;
  try {
    const out = await api("/api/demo-checkin", { guest, lang });
    me = { token: out.token, name: out.name, first: out.first, firsts: out.firsts, consent: true };
    saveMe();
    renderCheckin();
    enterChat();
    // No consent question: a made-up guest has already said yes. He welcomes
    // them and points at "Match me"; the visitor decides when to ask.
    const a = addAnswer({ reply: out.say, lang });
    setState("answer");
    scrollThread(a);
    speak(out.say, { emotion: "excitement" });
    armIdle();
  } catch {
    ciMsg(t("lost"));
  } finally {
    for (const b of $("ci-choices").querySelectorAll("button")) b.disabled = false;
  }
}

function ciMsg(text) {
  $("ci-msg").textContent = text;
  $("ci-msg").hidden = !text;
}

/** Open the chat. True if there was already a conversation. */
function enterChat() {
  if (TRIAL) flash(`VOICE TRIAL · ${TRIAL.tts.toUpperCase()}${TRIAL.voice ? ` · ${TRIAL.voice}` : ""}`, 5_000);
  const returning = turns.length > 0;
  setState(returning ? "answer" : "empty");
  if (returning) scrollThread();
  // One history entry for the chat, so the phone's Back button returns to
  // this home screen instead of leaving the site.
  history.pushState({ maker: "chat" }, "");
  if (!returning) fetch("/api/visit", { method: "POST" }).catch(() => {});
  return returning;
}

async function checkIn(pick) {
  const name = $("ci-name").value.trim();
  if (!pick && name.length < 2) return ciMsg(t("ciMissing"));
  $("start").disabled = true;
  $("ci-choices").hidden = true;
  try {
    const out = await api("/api/checkin", { name, lang, pick, door: doorCode });
    if (out.needDoor) return ciMsg(t("ciDoor")); // not scanned at the venue (or scanned too long ago)
    if (out.choices) {
      // Two people share the full name typed: pick yourself.
      ciMsg(t("ciWhich"));
      const none = el("button", "none", t("ciNone"));
      none.type = "button";
      none.addEventListener("click", () => {
        $("ci-choices").hidden = true;
        ciMsg(t("ciNotFound"));
      });
      $("ci-choices").replaceChildren(
        ...out.choices.map((c) => {
          const b = el("button", "", c.label);
          b.type = "button";
          b.addEventListener("click", () => checkIn(c.pick));
          return b;
        }),
        none,
      );
      $("ci-choices").hidden = false;
      return;
    }
    if (out.found === false) return ciMsg(t("ciNotFound"));
    if (out.ended) return ciMsg(t("ciEnded"));
    if (out.ambiguous) return ciMsg(t("ciAmbiguous"));
    me = { token: out.token, name: out.name, first: out.first, firsts: out.firsts, consent: out.consent };
    saveMe();
    ciMsg("");
    $("ci-choices").hidden = true;
    $("ci-name").blur();
    loadMe();
    renderCheckin();
    enterChat();
    if (out.late) {
      // After the event: just back in, no consent question (it was for the night).
      const a = addAnswer({ reply: out.say, lang });
      scrollThread(a);
      speak(out.say, { emotion: "joy" });
    } else askConsent(out.say);
  } catch (err) {
    if (err.status === 410) return showClosed();
    ciMsg(err.status === 429 ? t("ciTooMany") : t("lost"));
  } finally {
    $("start").disabled = false;
  }
}

/** "May I introduce you?" — the only way anyone becomes introducible. Then straight to matching. */
function askConsent(line) {
  const a = addAnswer({ reply: line, lang });
  const row = el("div", "consent");
  const yes = el("button", "cta");
  const no = el("button", "cta ghost");
  yes.type = no.type = "button";
  yes.append(el("b", "", t("yes")));
  no.append(el("b", "", t("no")));
  row.append(yes, no);
  $("thread").append(row);
  setState("answer");
  scrollThread(a); // the sheet stays low: Maker is the one asking
  speak(line, { emotion: "excitement" });
  const choose = async (ok) => {
    yes.disabled = no.disabled = true;
    try {
      const out = await api("/api/consent", { token: me.token, yes: ok, lang });
      me.consent = out.consent;
      saveMe();
      row.replaceChildren(el("p", "mono dim", `> ${ok ? t("yes") : t("no")}`));
      if (!ok) {
        // Not now: no matching. Maker offers the evening instead, as buttons.
        const a = addAnswer({ reply: out.say, lang });
        scrollThread(a);
        speak(out.say, { emotion: "joy" });
        suggested = t("tour").map(([label]) => label);
        tourQs = Object.fromEntries(t("tour"));
        renderChips();
        return;
      }
    } catch {
      row.remove();
      if (!ok) return;
    }
    ask(t("chips")[0][1]); // "Who should I meet tonight?" with their registration as context
  };
  yes.addEventListener("click", () => choose(true));
  no.addEventListener("click", () => choose(false));
}

$("checkin").addEventListener("submit", async (e) => {
  e.preventDefault();
  unlockAudio(); // this tap is the gesture the browser needs for sound
  if (!me) return cfg?.demo ? undefined : checkIn();
  if (enterChat()) flourish();
  else speak(t("welcomeBack", { name: myFirst() }), { emotion: "joy" });
});
$("notme").addEventListener("click", () => signOut());

/** Forget who checked in on this phone and what was said; back to check-in. */
function signOut(msg = "") {
  if (state !== "landing") goHome();
  me = null;
  storage.set("maker-me", "null");
  chat.save(null);
  turns = [];
  log = [];
  suggested = [];
  asked.clear();
  storage.set("maker-interest", "");
  $("thread").replaceChildren();
  $("ci-name").value = "";
  setLang(lang);
  ciMsg(msg);
}

/** 48 hours after the event: Maker is off. The home screen says so, nothing else. */
function showClosed() {
  if (state !== "landing") goHome();
  body.classList.add("closed");
  ciMsg(t("closed"));
}

/** Checks this phone's check-in with the server; brings tonight's featured people (host, guests, speakers, Topic Leads). */
async function loadMe() {
  if (!me) return;
  try {
    const r = await api("/api/me");
    if (!r.checkedIn) return signOut();
    if (cfg) cfg.event.featured = r.featured ?? [];
    if (r.firsts) {
      me.firsts = r.firsts;
      saveMe();
      renderCheckin();
    }
  } catch {}
}

/** Back to the home screen. The conversation is kept for when you tap Start again. */
function goHome() {
  if (state === "listening") $("voice-cancel").click();
  presenter.interruptPresentation?.();
  act++;
  pose();
  $("sheet").dataset.snap = "rest";
  $("sheet").style.removeProperty("height");
  document.activeElement?.blur?.();
  setState("landing");
}
$("home").addEventListener("click", () => (history.state?.maker === "chat" ? history.back() : goHome()));
// ── Welcome greeting ─────────────────────────────────────────────────────
// On arrival Maker only waves: no words, no sound (phones block sound
// before a tap, and silent text reads as broken). He first speaks when the
// visitor picks a guest (that line opens with a welcome) or opens About.

// ── Welcome layout ───────────────────────────────────────────────────────
// Maker gets the room above the welcome text, which overlaps him by 30px.
// The text's height depends on the language and the state (demo cards,
// name field, "continue as"), so it's measured, never guessed.
function measureLanding() {
  const pane = document.querySelector(".pane.landing");
  if (!pane || state !== "landing") return;
  const kids = [...pane.children].filter((c) => c.offsetParent && !c.classList.contains("fx-drift"));
  if (!kids.length) return;
  const top = kids[0].getBoundingClientRect().top;
  const bottom = kids.at(-1).getBoundingClientRect().bottom;
  const cs = getComputedStyle(pane);
  const h = Math.ceil(bottom - top + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
  if (h > 0) body.style.setProperty("--land-h", `${h}px`);
}
{
  const ro = new ResizeObserver(() => measureLanding());
  for (const id of ["hi", "match", "checkin"]) ro.observe($(id));
  addEventListener("resize", measureLanding);
}

// ── About Maker ──────────────────────────────────────────────────────────
// His story in his own words (persona.md `about`), laid out as in the
// The "About Maker" page: a page under the top bar, the
// live 3D Maker above it (he waves when it opens) shrinking to a strip once
// you scroll. ← in the top bar, or the phone's Back, closes it.
/** Text with **marked** words → nodes (the marked ones in yellow). */
function marked(text) {
  return String(text).split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? el("mark", "", part) : document.createTextNode(part)));
}
function renderAbout() {
  const a = cfg?.persona?.about ?? {};
  const title = $("about-title");
  title.innerHTML = "HI, I'M<br>MAKER."; // constant markup, no data
  delete title.dataset.fxDone;
  fx.slam(title);
  $("about-intro").replaceChildren(...marked(pickL(a.intro)));
  $("about-sections").replaceChildren(...(a.sections ?? []).map((sec, i) => {
    const box = el("section", "about-sec");
    box.dataset.sec = String(i + 1);
    const head = el("div", "about-num");
    head.append(el("b", "", String(i + 1).padStart(2, "0")), el("span", "", pickL(sec.label)));
    const p = el("p", "about-text");
    p.append(...marked(pickL(sec.text)));
    box.append(head, el("h3", "about-h", pickL(sec.title)), p);
    if (sec.chips?.length) {
      const row = el("div", "about-tags");
      row.append(...sec.chips.map((c) => el("span", "", `[${c}]`)));
      box.append(row);
    }
    return box;
  }));
  const au = a.author;
  $("about-author").hidden = !au?.name;
  if (au?.name) {
    // A signature card: her "Build by Angie" pixel logo (persona
    // about.author.logo) is the headline; her name and LinkedIn underneath.
    // Without a logo: the label, her name big, her role.
    const hasLogo = /^\/m\/[\w-]+\.svg$/.test(au.logo ?? "");
    $("about-author").classList.toggle("signed", hasLogo);
    const card = [];
    if (hasLogo) {
      const logo = el("img", "about-logo");
      logo.src = au.logo;
      logo.alt = "Build by Angie";
      card.push(logo, el("b", "about-sig", au.name.toUpperCase()));
    } else card.push(el("span", "about-kicker", `> ${pickL(au.label) || "BUILT_BY"}`), el("b", "display", au.name.toUpperCase()), el("span", "about-role", pickL(au.role)));
    if (/^https:\/\/([a-z]+\.)?linkedin\.com\//.test(au.linkedin ?? "")) {
      const link = el("a", "about-btn", "LinkedIn");
      link.href = au.linkedin;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.append(el("span", "mono", "↗"));
      link.addEventListener("click", () => tap("about-linkedin"));
      if (hasLogo) {
        const foot = el("div", "about-sig-row");
        foot.append(card.pop(), link);
        card.push(foot);
      } else card.push(link);
    }
    $("about-author").replaceChildren(...card);
  }
  const b = a.build;
  $("about-build").hidden = !b?.title;
  if (b?.title) {
    const parts = [el("span", "about-kicker", "> BUILD_YOUR_OWN"), el("b", "about-own", pickL(b.title)), el("p", "", pickL(b.text))];
    if (/^https:\/\//.test(b.link ?? "")) {
      const link = el("a", "about-btn yellow", "");
      link.href = b.link;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.append(el("b", "", pickL(b.button) || "GitHub"), el("span", "mono", "↗"));
      link.addEventListener("click", () => tap("about-build"));
      parts.push(link);
    }
    $("about-build").replaceChildren(...parts);
  }
  $("about").lang = HTML_LANG[lang];
}
// Maker floats over the page: top right at first; drag
// him anywhere and he settles on the nearer side; – makes him a small card
// at the edge (tap to bring him back). His bubble says what the part you're
// reading is about; while you scroll he fades so the text stays readable.
// The page lives in the app's own layer (.app is fixed, so it stacks its
// children by itself): only there can the floating stage sit above it and
// get the taps and drags.
$("app").append($("guide-l"), $("guide-r"), $("about"));
const FLOAT = { w: 132, h: 188, miniW: 60, miniH: 68 };
const float = { side: "right", y: null, mini: false, drag: null };
const stageEl = $("stage");
const topOfPage = () => $("about").getBoundingClientRect().top;
function placeFloat() {
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  if (float.y === null) float.y = topOfPage() + 4;
  float.y = Math.max(topOfPage() + 4, Math.min(vh - 200, float.y));
  let x = float.side === "left" ? 8 : vw - FLOAT.w - 8;
  let y = float.y;
  if (float.mini) x = float.side === "left" ? 0 : vw - FLOAT.miniW;
  if (float.drag) ({ x, y } = float.drag);
  stageEl.style.left = `${x}px`;
  stageEl.style.top = `${y}px`;
  body.classList.toggle("float-left", float.side === "left");
  body.classList.toggle("float-mini", float.mini);
  body.classList.toggle("float-dragging", !!float.drag);
  const nearLeft = float.drag ? float.drag.x + FLOAT.w / 2 < vw / 2 : float.side === "left";
  $("guide-l").classList.toggle("near", nearLeft);
  $("guide-r").classList.toggle("near", !nearLeft);
}
let aboutSec = "hero";
const aboutSaid = new Set();
// One part at a time: scrolling on doesn't cut him off mid-line; when he's
// done he talks about the part you're on *then*. A part counts as said once
// he's started it on stage (not while the 3D is still loading, nor when
// About was closed meanwhile).
let aboutTalking = false;
/** Resolves when he's done performing, or after `max` ms (a wave's own "done" doesn't count). */
function untilQuiet(max) {
  const started = Date.now();
  return new Promise((done) => {
    const finished = () => Date.now() - started > Math.min(max * 0.5, 2000) && end();
    const end = () => {
      presenter.removeEventListener("ALL_PERFORMANCE_FINISHED", finished);
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(end, max);
    presenter.addEventListener("ALL_PERFORMANCE_FINISHED", finished);
  });
}
let aboutVisit = 0; // bumps each time About opens, so an old visit's line can't hold up a new one
async function talkAbout(sec) {
  if (aboutSaid.has(sec) || aboutTalking || !body.classList.contains("about-open")) return;
  const line = String(cfg?.persona?.about?.speech?.[sec]?.[lang] ?? "").trim();
  if (!line) return;
  const visit = aboutVisit;
  aboutTalking = true;
  const est = Math.min(15_000, 1200 + [...line].length * (lang === "en" ? 65 : 190));
  try {
    if (!ready) return; // he'll talk once he's on stage and you stop on a part
    await speak(line, { emotion: sec === "own" || sec === "hero" ? "excitement" : "joy" });
    if (visit !== aboutVisit) return; // About was closed meanwhile
    aboutSaid.add(sec);
    await untilQuiet(est); // let him finish
  } finally {
    if (visit === aboutVisit) aboutTalking = false;
  }
  if (visit === aboutVisit && aboutSec !== sec) talkAbout(aboutSec); // you've moved on meanwhile
}
function caption() {
  const a = cfg?.persona?.about ?? {};
  const box = $("about");
  let sec = "hero";
  if (box.scrollTop > 40) {
    for (const n of box.querySelectorAll("[data-sec]")) if (n.offsetTop <= box.scrollTop + 160) sec = n.dataset.sec;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 40) sec = "own";
  }
  aboutSec = sec;
  const text = pickL(a.captions?.[sec]);
  $("float-bubble").textContent = text;
  $("float-bubble").hidden = !text;
}
let fadeTimer = null;
$("about").addEventListener("scroll", () => {
  caption();
  body.classList.add("float-fade");
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    body.classList.remove("float-fade");
    talkAbout(aboutSec); // stopped on a part: he talks about it
  }, 300);
}, { passive: true });
// Drag: the stage itself (the live 3D canvas inside lets the pointer through).
stageEl.addEventListener("pointerdown", (e) => {
  if (!body.classList.contains("about-open") || float.mini || e.button > 0 || e.target.closest("#float-min")) return;
  const r = stageEl.getBoundingClientRect();
  float.off = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  float.drag = { x: r.left, y: r.top };
  stageEl.setPointerCapture?.(e.pointerId);
  placeFloat();
});
stageEl.addEventListener("pointermove", (e) => {
  if (!float.drag) return;
  float.drag = { x: e.clientX - float.off.dx, y: e.clientY - float.off.dy };
  placeFloat();
});
const dropFloat = () => {
  if (!float.drag) return;
  const vw = document.documentElement.clientWidth;
  float.side = float.drag.x + FLOAT.w / 2 < vw / 2 ? "left" : "right";
  float.y = float.drag.y;
  float.drag = null;
  placeFloat();
};
stageEl.addEventListener("pointerup", dropFloat);
stageEl.addEventListener("pointercancel", dropFloat);
$("float-min").addEventListener("click", (e) => {
  e.stopPropagation();
  float.mini = true;
  placeFloat();
  tap("about-minimize");
});
// Minimized: a tap on the card brings him back.
stageEl.addEventListener("click", () => {
  if (!body.classList.contains("about-open") || !float.mini) return;
  float.mini = false;
  placeFloat();
});

function openAbout() {
  const a = cfg?.persona?.about ?? {};
  if (!a.sections?.length && !a.hello) return;
  renderAbout();
  $("about").scrollTop = 0;
  $("about").hidden = false;
  $("about-back").hidden = false;
  for (const g of [$("guide-l"), $("guide-r"), $("float-min")]) g.hidden = false;
  body.classList.add("about-open");
  float.y = null;
  placeFloat();
  caption();
  dispatchEvent(new Event("resize")); // the 3D re-fits its canvas to the new box
  if (ready) flourish(); // Maker waves hello
  aboutSaid.clear();
  aboutVisit++;
  aboutTalking = false;
  setTimeout(() => talkAbout("hero"), 700); // after the 3D has re-fitted to its floating box
  tap("about");
  history.pushState({ maker: "about" }, "");
}
function closeAbout() {
  presenter.interruptPresentation?.(); // he stops talking about himself
  pendingLine = null; // nor says an About line later, on another screen
  act++;
  aboutVisit++;
  aboutTalking = false;
  $("about").hidden = true;
  $("about-back").hidden = true;
  for (const g of [$("guide-l"), $("guide-r"), $("float-min"), $("float-bubble")]) g.hidden = true;
  body.classList.add("float-closing"); // back to the stage without flying across the screen
  body.classList.remove("about-open", "float-left", "float-mini", "float-dragging", "float-fade");
  stageEl.style.left = stageEl.style.top = "";
  float.drag = null;
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove("float-closing")));
  dispatchEvent(new Event("resize"));
}
$("about-link").addEventListener("click", openAbout);
$("about-back").addEventListener("click", () => (history.state?.maker === "about" ? history.back() : closeAbout()));
addEventListener("popstate", () => { if (!$("about").hidden) closeAbout(); });

// ── Tonight's program, over the chat ─────────────────────────────────────
// Back (the phone's, or the page's own "back to chat") closes it and leaves
// the conversation exactly where it was.
// A fresh iframe every time: changing an existing iframe's address adds
// browser-history entries, and Back then lands on a blank frame (a frozen
// blue screen). One history entry of our own, popped by Back.
function openGuide(hash) {
  const frame = document.createElement("iframe");
  frame.title = "Program";
  frame.src = `guide.html?embed=1${hash ? `#${hash}` : ""}`;
  $("guide-overlay").replaceChildren(frame);
  $("guide-overlay").hidden = false;
  history.pushState({ maker: "guide" }, "");
}
function closeGuide() {
  $("guide-overlay").hidden = true;
  $("guide-overlay").replaceChildren();
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data !== "maker-guide-close") return;
  if (history.state?.maker === "guide") history.back();
  // Whatever the history holds, the program closes.
  setTimeout(() => { if (!$("guide-overlay").hidden) closeGuide(); }, 300);
});

addEventListener("popstate", () => {
  if (!$("guide-overlay").hidden) return closeGuide();
  if (state === "landing") return;
  if (state === "agenda") {
    // Back from the agenda goes to the chat, not all the way home.
    $("back-btn").click();
    history.pushState({ maker: "chat" }, "");
    return;
  }
  goHome();
});

$("agenda-btn").addEventListener("click", () => {
  stateBeforeAgenda = state;
  renderAgenda();
  setState("agenda");
});
$("back-btn").addEventListener("click", () => setState(stateBeforeAgenda === "agenda" ? "empty" : stateBeforeAgenda));

function renderAgenda() {
  const sched = cfg?.event.schedule ?? JSON.parse(storage.get("maker-schedule") || "[]");
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: cfg?.event.timezone || "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const today = String(cfg?.event.date ?? "").slice(0, 10) === new Intl.DateTimeFormat("en-CA", { timeZone: cfg?.event.timezone || "Asia/Taipei" }).format(new Date());
  let nowIdx = -1;
  if (today) sched.forEach((it, i) => { if (String(it.time) <= now) nowIdx = i; });
  $("schedule").replaceChildren(
    ...sched.map((it, i) => {
      const li = el("li", i === nowIdx ? "now" : "");
      const label = pickL(it.label) || ({ zh: it.zh, ja: it.ja }[lang]) || pickL(it.what).split(" — ")[0];
      li.append(el("time", "", it.time), el("span", "", label), el("em", "", i === nowIdx ? "◀ NOW" : ""));
      return li;
    }),
  );
  $("agenda-note").textContent = state === "offline" || !cfg ? t("cached") : "";
}

// ── Offline ──────────────────────────────────────────────────────────────

let stateBeforeOffline = "empty";
function setOffline(off) {
  if (off && state !== "offline") {
    stateBeforeOffline = state === "landing" ? "empty" : state;
    $("banner").hidden = false;
    renderAgenda();
    setState("offline");
  } else if (!off && state === "offline") {
    $("banner").hidden = true;
    setState(stateBeforeOffline);
  }
}
addEventListener("offline", () => setOffline(true));
addEventListener("online", () => setOffline(false));
setInterval(async () => {
  if (document.visibilityState !== "visible" || state !== "offline") return;
  try {
    await fetch("/api/ping", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    setOffline(false);
  } catch {}
}, 10_000);

// ── Boot ─────────────────────────────────────────────────────────────────

async function main() {
  cfg = await api("/api/kiosk-config");
  lang = pickLang(eventLangs()); // now we know which languages this event has
  storage.set("maker-schedule", JSON.stringify(cfg.event.schedule));
  body.dataset.theme = cfg.persona.theme || "blue";
  document.title = `${cfg.persona.name} · ${pickL(cfg.event.name)}`;
  $("hi").replaceChildren("HI, I'M", el("br"), `${cfg.persona.name.toUpperCase()}.`);
  $("info-name").textContent = cfg.persona.name.toUpperCase();
  // Sharp official render instead of the small design PNG, until the 3D is up.
  $("stage-event").textContent = pickL(cfg.event.kiosk?.label);
  if (AVATAR_TRIAL) {
    try {
      const info = await api(`/api/avatar-info?id=${AVATAR_TRIAL}`);
      cfg.avatarImage = info.image;
      cfg.motions = info.motions;
    } catch {}
  }
  document.querySelector(".avatar .placeholder").src = cfg.avatarImage || "maker.png";
  for (const a of document.querySelectorAll(".optin")) {
    if (cfg.optInUrl) a.href = cfg.optInUrl;
    else a.hidden = true;
  }
  limit = cfg.questionLimit ?? limit;
  body.classList.toggle("demo", !!cfg.demo);
  if (cfg.phase?.phase === "closed") showClosed();
  // A phone that checked in before the roster was replaced (e.g. practice →
  // real list), or whose check-in staff undid, starts over.
  loadMe();
  api("/api/quota").then((q) => {
    used = q.used;
    limit = q.limit;
    renderQuota();
  }).catch(() => {});
  setLang(lang);
  // Welcome-screen motion: the tagline in each of the event's languages, current first.
  fx.start({
    hi: $("hi"),
    match: $("match"),
    lines: () => [lang, ...eventLangs().filter((l) => l !== lang)].map((l) => [l, M[l].match]),
    stage: $("stage"),
  });
  renderQuota();
  // Redraw this tab's earlier conversation; Start picks it up.
  const saved = me ? chat.load() : null;
  if (saved?.log?.length) {
    turns = saved.turns ?? [];
    log = saved.log;
    for (const { q, out } of log) {
      if (q) addQuestion(q); // Maker speaking up on his own has no question
      addAnswer(out);
    }
  }
  if (cfg.perxonaReady === false) {
    // Running without a Perxona account: his picture, and where to get one.
    body.classList.add("slow-avatar", "no-perxona");
    $("no-perxona").textContent = t("noPerxona");
    $("no-perxona").hidden = false;
  } else connectAvatar().catch((err) => console.warn(`avatar: ${err.message}`)); // the picture stays if this fails
}

setLang(lang);
setState("landing");
// If the 3D is slow, show Maker's picture rather than an empty stage.
setTimeout(() => {
  if (ready) return;
  body.classList.add("slow-avatar");
  logoHome(false);
}, 8_000);

/** The intro logo flies from the middle of the stage to its corner, once. */
function logoHome(animate = true) {
  if (body.classList.contains("logo-home")) return;
  const from = document.querySelector(".credit img");
  const to = $("corner-logo");
  const a = from?.getBoundingClientRect();
  const b = to?.getBoundingClientRect();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduced || !a?.width || !b?.width || body.dataset.brand !== "label") {
    body.classList.add("logo-home");
    return;
  }
  const flyer = Object.assign(from.cloneNode(), { className: "logo-flight" });
  Object.assign(flyer.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.append(flyer);
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  const s = b.width / a.width;
  flyer
    .animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], { duration: 750, easing: "cubic-bezier(.6, 0, .2, 1)", fill: "forwards" })
    .finished.catch(() => {})
    .then(() => {
      body.classList.add("logo-home");
      flyer.remove();
    });
}
renderQuota();
main().catch((err) => {
  console.error(`boot: ${err.message}`);
  renderAgenda();
  setOffline(true);
});
