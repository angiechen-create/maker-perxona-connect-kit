// Kiosk page. One visitor at a time:
//   attract (tap to start) → idle → listening → thinking → answer → … → attract
// After a quiet minute it goes back to attract for the next person.
// The look is the "BLUE" design direction;
// each state is a data-state on <body> and style.css shows the right parts.

// A phone that lands on the kiosk page (typed URL, old bookmark) belongs in
// the phone app. ?kiosk forces the kiosk, e.g. on a small tablet.
if (Math.min(screen.width, screen.height) < 600 && !new URLSearchParams(location.search).has("kiosk")) {
  location.replace("/m/");
}

const $ = (id) => document.getElementById(id);
const body = document.body;
// Replaced on reconnect (see "Self-healing"), so always read it fresh.
let presenter = document.querySelector("sv-presenter");

const IDLE_RESET_MS = 60_000;
const SPEECH_LANG = { zh: "zh-TW", en: "en-US", ja: "ja-JP" };
const HTML_LANG = { zh: "zh-Hant", en: "en", ja: "ja" };
const UI = {
  greet: { zh: "有問題，問我就對了", en: "Ask me anything", ja: "なんでも聞いてね" },
  sub: {
    zh: "今晚的議程、主題桌、該認識誰都可以問。中文、English、日本語都行。",
    en: "Ask about tonight’s agenda, the topic tables, or who you should meet. 中文, English or 日本語.",
    ja: "今夜のプログラム、トピックテーブル、誰に会うべきか。日本語・中文・English OK。",
  },
  placeholder: { zh: "或打字問我…", en: "Or type a question…", ja: "文字でも質問できます…" },
  talk: { zh: ["按住說話", "HOLD TO TALK"], en: ["HOLD TO TALK", "按住說話"], ja: ["押して話す", "HOLD TO TALK"] },
  release: { zh: ["放開送出", "RELEASE TO SEND"], en: ["RELEASE TO SEND", "放開送出"], ja: ["離して送信", "RELEASE TO SEND"] },
  again: { zh: ["按住再問", "HOLD TO ASK AGAIN"], en: ["HOLD TO ASK", "按住再問"], ja: ["押してもう一度", "HOLD TO ASK AGAIN"] },
  listening: { zh: "正在聽…", en: "LISTENING…", ja: "聞いています…" },
  asked: { zh: "你問：", en: "You asked: ", ja: "質問：" },
  noMic: {
    zh: "麥克風沒有開啟，請用下面的輸入框打字問我。",
    en: "The microphone isn't available — please type your question below.",
    ja: "マイクが使えません。下の入力欄に入力してください。",
  },
  optIn: { zh: "想讓 {name} 介紹你？", en: "Want {name} to introduce you?", ja: "{name} に紹介してほしい？" },
  noAvatar: { zh: "↻ 主持人重新連線中", en: "↻ RECONNECTING", ja: "↻ 再接続中" },
  offline: "網路暫時斷線，有問題請找現場工作人員。",
  offlineSub: "We’re offline for a moment. Please ask a staff member.",
  lostConnection: {
    zh: "我現在連不上線，請問問現場工作人員喔。",
    en: "I've lost my connection — please ask one of the staff.",
    ja: "接続が切れました。スタッフに聞いてください。",
  },
};
const STATUS = {
  attract: "maker.idle — waiting for a human",
  idle: "ready · listening for a tap",
  listening: "mic open · 正在聽",
  thinking: "想一下… · matching attendees",
  answer: "answered · speaking",
  offline: "network down · local board",
};
const ORDER = { attract: "01", idle: "02", listening: "03", thinking: "04", answer: "05", offline: "06" };
const LAYOUT = { attract: "attract", idle: "talk", listening: "talk", thinking: "talk", answer: "answer", offline: "offline" };

let cfg = null;
let lang = "zh";
let state = "attract";
let turns = []; // [{ role: "user"|"assistant", text }]
let ready = false; // presenter reports Ready
let audioUnlocked = false;
let idleTimer = null;
let asking = false;

// Event texts are one string, or { en, zh, ja }: the language asked for,
// else English, else Chinese, else Japanese (same as the phone's pickL).
const pick = (o, l = lang) => {
  if (o == null) return "";
  if (typeof o !== "object") return String(o);
  for (const k of [l, "en", "zh", "ja"]) if (o[k] != null && String(o[k]).trim()) return String(o[k]);
  return "";
};
/** The board's second line: Chinese, or Japanese while the kiosk is in Japanese; empty when it's the same as the first. */
const second = (o, first) => {
  const x = pick(o, lang === "ja" ? "ja" : "zh");
  return x === first ? "" : x;
};

// {name} is the avatar's name from persona.md, so renaming it is one edit.
const named = (s) => s.replaceAll("{name}", cfg?.persona.name ?? "");
const t = (key) => {
  const v = UI[key];
  return typeof v === "string" ? v : Array.isArray(v[lang]) ? v[lang] : named(v[lang] ?? v.en);
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // textContent only: attendee text is user-written
  return e;
}

// ── Fit the fixed-size design to the real screen ─────────────────────

function fit() {
  const portrait = innerHeight > innerWidth;
  body.dataset.device = portrait ? "tablet" : "laptop";
  const [w, h] = portrait ? [768, 1024] : [1440, 900];
  $("screen").style.zoom = Math.min(innerWidth / w, innerHeight / h);
}
addEventListener("resize", fit);
fit();

// ── Pixel icons ──────────────────────────────────────────────────────

const PIX = {
  inv: ["..X.....X..", "...X...X...", "..XXXXXXX..", ".XX.XXX.XX.", "XXXXXXXXXXX", "X.XXXXXXX.X", "X.X.....X.X", "...XX.XX..."],
  boba: ["......XX...", ".....X.....", "XXXXXXXXXXX", "X.........X", ".X.......X.", ".X.......X.", ".X.......X.", ".X.X.X.X.X.", ".X.......X.", ".X.X.X.X.X.", "..X.....X..", "..XXXXXXX.."],
  mic: ["...XXX...", "..X...X..", "..X...X..", "..X...X..", "..X...X..", "X..XXX..X", "X.......X", ".X.....X.", "..XXXXX..", "....X....", "....X....", "..XXXXX.."],
};
for (const svg of document.querySelectorAll("[data-icon]")) {
  const rows = PIX[svg.dataset.icon];
  let d = "";
  rows.forEach((r, y) => [...r].forEach((c, x) => c === "X" && (d += `M${x} ${y}h1v1h-1z`)));
  svg.setAttribute("viewBox", `0 0 ${rows[0].length} ${rows.length}`);
  svg.innerHTML = `<path d="${d}" fill="currentColor"/>`;
}

// ── Little animations: progress bars, the listening meter ─────────────

let tick = 0;
let listenStart = 0;
const meterBars = Array.from({ length: 20 }, () => $("meter").appendChild(el("i")));
setInterval(() => {
  tick++;
  for (const b of document.querySelectorAll(".waitbar")) {
    const n = Number(b.dataset.bar);
    const f = Math.floor(tick / 2) % (n + 1);
    b.textContent = `[${"■".repeat(f)}${"□".repeat(n - f)}]`;
  }
  if (state === "listening") {
    meterBars.forEach((bar, i) => {
      bar.style.height = `${Math.round(10 + Math.abs(Math.sin(tick * 0.7 + i * 1.3) * Math.cos(tick * 0.31 + i * 0.5)) * 58)}px`;
    });
    $("talk-right").textContent = `● 00:${String(Math.min(59, Math.floor((Date.now() - listenStart) / 1000))).padStart(2, "0")}`;
  }
  if (state === "thinking") {
    const f = Math.floor(tick / 2) % 5;
    $("talk-right").textContent = `[${"■".repeat(f)}${"□".repeat(4 - f)}]`;
  }
}, 180);

// ── States ────────────────────────────────────────────────────────────

function setState(next) {
  state = next;
  body.dataset.state = next;
  body.dataset.layout = LAYOUT[next];
  $("counter").textContent = ORDER[next];
  $("status").textContent = STATUS[next];
  renderTalkButton();
  renderStageChip();
}

function renderTalkButton() {
  const [label, sub] =
    state === "listening" ? t("release") : state === "thinking" ? ["想一下…", "THINKING"] : state === "answer" ? t("again") : t("talk");
  $("talk-label").textContent = label;
  $("talk-sub").textContent = sub;
  if (state !== "listening" && state !== "thinking") $("talk-right").textContent = "HOLD ▮";
  $("ptt").disabled = state === "thinking";
  $("send").disabled = state === "thinking";
}

function renderStageChip() {
  const chip = $("stage-chip");
  chip.classList.remove("listen");
  if (!ready && cfg && state !== "attract") {
    chip.textContent = t("noAvatar");
  } else if (state === "listening") {
    chip.textContent = "● MIC OPEN";
    chip.classList.add("listen");
  } else if (state === "answer") {
    chip.textContent = `▶ SPEAKING · ${{ zh: "中文", en: "EN", ja: "日本語" }[lang]}`;
  } else {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
}

// ── Language ────────────────────────────────────────────────────────────

function setLang(next) {
  if (!SPEECH_LANG[next]) return;
  lang = next;
  document.documentElement.lang = HTML_LANG[lang];
  for (const b of document.querySelectorAll("[data-lang]")) {
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  }
  $("greet-box").textContent = t("greet");
  $("greet-box").lang = HTML_LANG[lang];
  $("greet-sub").textContent = t("sub");
  $("greet-sub").lang = HTML_LANG[lang];
  $("listen-box").textContent = t("listening");
  $("q").placeholder = t("placeholder");
  renderTalkButton();
  renderStageChip();
  renderOptIn();
  if (cfg) {
    renderCover();
    renderBoard();
  }
}

for (const b of document.querySelectorAll("[data-lang]")) {
  b.addEventListener("click", () => {
    setLang(b.dataset.lang);
    // Nothing asked yet: greet again in the language they just picked.
    if (!turns.length && cfg && !asking) speak(cfg.persona.greeting[lang] ?? "");
    bump();
  });
}

// ── Avatar ──────────────────────────────────────────────────────────────

// Ready only ever arrives as an event, so attach before initializing. The
// property is detail.status — reading anything else leaves `ready` false
// forever and the avatar silently never speaks.
function attachPresenter(node) {
  node.addEventListener("PRESENTER_STATUS", (e) => {
    if (node !== presenter) return; // a replaced element still firing
    onStatus(e.detail?.status);
  });
  node.addEventListener("CONNECT_KEY_REJECTED", () => {
    ready = false;
    renderStageChip();
    console.error("Perxona refused the publishable key (revoked, expired, or wrong domain).");
  });
}
attachPresenter(presenter);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { type: "module", src });
    s.onload = resolve;
    s.onerror = () => reject(new Error(`presenter engine failed to load: ${src}`));
    document.head.append(s);
  });
}

let engineLoaded = false;
async function connectAvatar() {
  const { avatarId, sceneId, voiceId } = cfg.target;
  if (!avatarId || !sceneId || !voiceId) throw new Error("avatar_id / scene_id / voice_id missing in persona.md");
  if (!engineLoaded) {
    await loadScript(cfg.presenterUrl);
    await customElements.whenDefined("sv-presenter");
    engineLoaded = true;
  }
  const { connect_key } = await api("/api/connect-key");
  await presenter.initializeWithConnectKey(connect_key, { avatarId, sceneId, voiceId });
}

/** Speak if we can. Text is always on screen either way, so a silent avatar never loses the answer. */
async function speak(text) {
  if (!ready || !audioUnlocked || !text) return;
  presenter.interruptPresentation?.();
  // present() never throws — it resolves { success:false, code, message }.
  const result = await presenter.present(text);
  if (result?.success) {
    presentFailures = 0;
  } else {
    console.error(`present() failed (${result?.code}): ${result?.message ?? ""}`);
    // One failure can be a hiccup; two in a row means the session is gone.
    if (++presentFailures >= 2) reconnect("present failed twice");
  }
}

// ── Self-healing ────────────────────────────────────────────────────────
// Nobody will be standing next to the laptop. Every failure here has to
// recover on its own, and while it can't, the screen must still be useful.

let everReady = false;
let notReadySince = Date.now();
let presentFailures = 0;
let reconnecting = false;
let llmDownStreak = 0;
let serverMisses = 0;
let stateBeforeOffline = "attract";
const downReasons = new Set(); // "llm" | "server"

function onStatus(status) {
  ready = status === "Ready";
  // Full body: the default half-body framing cuts Maker off at the knees.
  if (ready) try { presenter.updateCameraAngle?.("fullbody"); } catch {}
  if (ready) {
    everReady = true;
    notReadySince = null;
    presentFailures = 0;
  } else {
    notReadySince ??= Date.now();
  }
  renderStageChip();
}

/** Swap in a fresh <sv-presenter> and initialize it, backing off between tries. */
async function reconnect(why) {
  if (reconnecting) return;
  reconnecting = true;
  console.warn(`avatar: reconnecting (${why})`);
  for (const wait of [0, 5, 10, 20, 40, 60, 60, 60]) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    try {
      const fresh = document.createElement("sv-presenter");
      attachPresenter(fresh);
      presenter.replaceWith(fresh);
      presenter = fresh;
      ready = false;
      notReadySince = Date.now();
      renderStageChip();
      await connectAvatar();
      // The page already had its tap, so this succeeds without a new one.
      if (audioUnlocked) await presenter.resumeAudioPlayback?.().catch(() => {});
      if (await waitFor(() => ready, 30_000)) break;
    } catch (err) {
      console.warn(`avatar: reconnect failed: ${err.message}`);
    }
  }
  reconnecting = false;
}

function waitFor(cond, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => (cond() ? resolve(true) : Date.now() - t0 > ms ? resolve(false) : setTimeout(poll, 250));
    poll();
  });
}

// Watchdog: an avatar that was fine and quietly stopped being Ready.
setInterval(() => {
  if (!cfg || reconnecting || ready || notReadySince == null) return;
  const downFor = Date.now() - notReadySince;
  if (everReady && downFor > 15_000) reconnect("not ready for 15s");
  else if (!everReady && downFor > 60_000) reconnect("never became ready");
}, 5_000);

// Heartbeat to our own server: catches a dead server and live config edits.
setInterval(async () => {
  if (!cfg) return;
  try {
    const res = await fetch("/api/ping", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    const { version } = await res.json();
    serverMisses = 0;
    setDown("server", false);
    if (version !== cfg.version) refreshConfig();
  } catch {
    if (++serverMisses >= 2) setDown("server", true);
  }
}, 15_000);

addEventListener("offline", () => setDown("server", true));
addEventListener("online", () => { serverMisses = 0; setDown("server", false); });

function setDown(reason, isDown) {
  const wasDown = downReasons.size > 0;
  if (isDown) downReasons.add(reason);
  else downReasons.delete(reason);
  const nowDown = downReasons.size > 0;
  if (nowDown && !wasDown) {
    stateBeforeOffline = state;
    renderBoard();
    setState("offline");
  } else if (!nowDown && wasDown) {
    setState(stateBeforeOffline === "attract" || !turns.length ? "attract" : "idle");
  }
}

/** Pick up staff edits (greeting, schedule, links) without reloading the page. */
async function refreshConfig() {
  const next = await api("/api/kiosk-config").catch(() => null);
  if (!next) return;
  const avatarChanged = JSON.stringify(next.target) !== JSON.stringify(cfg.target);
  cfg = next;
  applyConfig();
  if (avatarChanged) reconnect("avatar settings changed");
}

// ── QR codes: fetched once at boot and kept as data URLs ──────────────
// so the offline board still works if the server itself goes away.

const qrCache = {};
// Which links get a tile on the offline board: event.yaml kiosk.board, or
// the first three links if it isn't set.
const boardLinks = () =>
  (cfg.event.kiosk?.board ?? cfg.event.links.slice(0, 3).map((link) => ({ link, en: link, zh: "" })))
    .map((b) => {
      const first = pick({ en: b.en ?? b.link }, "en");
      return [b.link, first, second({ zh: b.zh, ja: b.ja }, first)];
    });

async function cacheQrs() {
  for (const key of cfg.event.links) {
    if (qrCache[key]) continue;
    try {
      const svg = await (await fetch(`/api/qr-link/${encodeURIComponent(key)}`)).text();
      qrCache[key] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {}
  }
  renderOptIn();
  renderBoard();
}

function qrTile(src) {
  const box = el("div", "qr");
  box.append(Object.assign(document.createElement("img"), { src, alt: "" }));
  return box;
}

function renderOptIn() {
  const box = $("optin");
  const src = qrCache.opt_in_form;
  if (!src || !cfg) return void (box.hidden = true);
  const text = el("div", "optin-text");
  const title = el("div", "optin-title", t("optIn"));
  title.lang = HTML_LANG[lang];
  const hint = el("div", "mono-sm");
  hint.style.fontSize = "13px";
  hint.style.lineHeight = "1.5";
  hint.append("Scan to opt in →", el("br"), "get introduced tonight");
  text.append(title, hint);
  box.replaceChildren(qrTile(src), text);
  box.hidden = false;
}

function nowInEvent() {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: cfg.event.timezone || "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch {
    return { date: "", time: "" };
  }
}

function renderBoard() {
  if (!cfg) return;
  $("offline-box").textContent = UI.offline;
  $("offline-box").lang = "zh-Hant";
  $("offline-sub").textContent = UI.offlineSub;

  // Highlight what's on now — only on the day itself.
  const now = nowInEvent();
  const today = String(cfg.event.date ?? "").slice(0, 10) === now.date;
  const items = cfg.event.schedule;
  let nowIdx = -1;
  if (today) items.forEach((it, i) => { if (String(it.time) <= now.time) nowIdx = i; });

  $("schedule").replaceChildren(
    ...items.map((it, i) => {
      const li = el("li", i === nowIdx ? "now" : "");
      const what = el("span", "what");
      // "Doors open — check-in, food…" → "Doors open"
      const first = pick(it.label ?? String(it.what).split(" — ")[0], "en");
      what.append(el("b", "", first));
      const other = second(it.label ?? { zh: it.zh }, first);
      if (other) {
        const sub = el("span", "", other);
        sub.lang = HTML_LANG[lang === "ja" ? "ja" : "zh"];
        what.append(sub);
      }
      li.append(el("time", "", it.time), what, el("span", "now-tag", i === nowIdx ? "◀ NOW" : ""));
      return li;
    }),
  );

  $("board-qrs").replaceChildren(
    ...boardLinks().filter(([k]) => qrCache[k]).map(([k, en, zh]) => {
      const fig = el("figure");
      const cap = el("figcaption");
      cap.append(el("b", "", en), el("span", "", named(zh)));
      fig.append(qrTile(qrCache[k]), cap);
      return fig;
    }),
  );
}
setInterval(() => state === "offline" && renderBoard(), 60_000); // keep ◀ NOW current

// Keep the screen on. Released whenever the tab is hidden, so re-ask.
async function keepAwake() {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audioUnlocked) keepAwake();
});

// ── Recommendations ─────────────────────────────────────────────────────

function showRecommendations({ people = [], tables = [] } = {}) {
  $("people").replaceChildren(
    ...people.map((p, i) => {
      const card = el("article", "card");
      const meta = el("div", "card-meta");
      meta.append(el("span", "", `${String(i + 1).padStart(2, "0")} / MEET`), el("span", "", pick(p.role).toUpperCase().slice(0, 24)));
      card.append(meta, el("div", "card-name", pick(p.name)), el("div", "card-desc", pick(p.building)));
      if (p.qr) {
        const foot = el("div", "card-foot");
        const scan = el("div", "card-scan");
        // LinkedIn if they gave one, otherwise the project they applied with.
        if (p.qr === "linkedin") scan.append("LINKEDIN ↗", el("br"), "掃描認識");
        else scan.append("PROJECT ↗", el("br"), "看作品");
        foot.append(qrTile(`/api/qr/${encodeURIComponent(p.id)}`), scan);
        card.append(foot);
      }
      return card;
    }),
  );
  $("tables").replaceChildren(
    ...tables.map((tb) => {
      const bar = el("div", "table-bar");
      const topic = el("span", "", pick(tb.topic));
      if (tb.host) topic.append(el("small", "", `· ${pick(tb.host)}`));
      const go = el("em", "", "主題桌 →");
      go.lang = "zh-Hant";
      bar.append(el("b", "", `TABLE ${tb.table}`), topic, go);
      return bar;
    }),
  );
}

// ── Conversation ────────────────────────────────────────────────────────

async function api(url, payload) {
  const res = await fetch(url, payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status}`), { status: res.status });
  return data;
}

async function askConcierge(text) {
  text = text.trim();
  if (!text || asking) return;
  asking = true;
  bump();
  $("q").value = "";
  $("asked").textContent = `「${text}」`;
  setState("thinking");
  presenter.interruptPresentation?.();
  presenter.setThinking?.(true);

  turns.push({ role: "user", text });
  let out;
  try {
    out = await api("/api/ask", { turns, lang });
  } catch (err) {
    // 401: Maker only talks to checked-in phones or a kiosk signed in as staff.
    if (err.status === 401) out = { reply: "Staff: sign in at /staff/ in this browser first, then reload the kiosk.", lang, fallback: "staff" };
    // Server unreachable. Say something human rather than freezing.
    else out = { reply: t("lostConnection"), lang, fallback: "down" };
  }
  presenter.setThinking?.(false);

  if (out.fallback) turns.pop(); // don't feed a failed exchange back to the model
  else turns.push({ role: "assistant", text: out.reply });

  if (out.lang && out.lang !== lang) setLang(out.lang); // follow the visitor
  $("answer-q").textContent = `> ${UI.asked[lang]}${text}`;
  $("answer").textContent = out.reply;
  $("answer").lang = HTML_LANG[lang];
  showRecommendations(out);
  asking = false;
  setState("answer");
  bump();
  // Two "can't reach my brain" answers in a row: show the board instead.
  llmDownStreak = out.fallback === "down" ? llmDownStreak + 1 : 0;
  setDown("llm", llmDownStreak >= 2);
  await speak(out.reply);
}

$("dock").addEventListener("submit", (e) => {
  e.preventDefault();
  askConcierge($("q").value);
});
$("q").addEventListener("input", bump);

// ── Push-to-talk (browser speech recognition) ──────────────────────────
// Chrome only, and it needs the network. Without it the button just
// focuses the text box.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
{
  const ptt = $("ptt");
  let rec = null;
  let heard = "";
  let micBlocked = false;
  let stateBeforeListening = "idle";

  const startListening = (e) => {
    e.preventDefault();
    if (rec || asking) return;
    if (!Recognition || micBlocked) {
      $("q").focus();
      return;
    }
    presenter.interruptPresentation?.(); // let them cut the avatar off
    heard = "";
    $("transcript").textContent = "";
    stateBeforeListening = state;
    listenStart = Date.now();
    setState("listening");
    rec = new Recognition();
    rec.lang = SPEECH_LANG[lang];
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      heard = Array.from(ev.results, (r) => r[0].transcript).join("");
      $("transcript").textContent = heard;
    };
    rec.onerror = (ev) => {
      console.warn(`speech: ${ev.error}`);
      // Mic blocked or no mic: say so, or the button just looks dead.
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(ev.error)) {
        micBlocked = true;
        $("greet-sub").textContent = t("noMic");
      }
    };
    rec.onend = () => {
      rec = null;
      if (heard.trim()) askConcierge(heard);
      else setState(stateBeforeListening === "answer" ? "answer" : "idle");
    };
    rec.start();
    bump();
  };
  const stopListening = () => rec?.stop();

  ptt.addEventListener("pointerdown", startListening);
  ptt.addEventListener("pointerup", stopListening);
  ptt.addEventListener("pointerleave", stopListening);
  ptt.addEventListener("pointercancel", stopListening);
  ptt.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press on tablets
}

// ── Idle reset: the next visitor starts fresh ──────────────────────────

function bump() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(resetForNextVisitor, IDLE_RESET_MS);
}

function resetForNextVisitor() {
  if (state === "offline") return bump(); // try again later
  turns = [];
  presenter.interruptPresentation?.();
  setLang(cfg.persona.defaultLanguage);
  showRecommendations();
  $("q").value = "";
  $("q").blur();
  setState("attract");
}

// ── Start: any tap on the attract screen ────────────────────────────────

$("screen").addEventListener("click", async () => {
  if (state !== "attract" || !cfg) return;
  setState("idle");
  bump();
  fetch("/api/visit", { method: "POST" }).catch(() => {});
  // Must run inside this tap — browsers block audio otherwise. Same tap:
  // go fullscreen and keep the screen awake.
  if (!audioUnlocked) {
    try {
      await presenter.resumeAudioPlayback?.();
      audioUnlocked = true;
    } catch (err) {
      console.error(`audio unlock failed: ${err.message}`);
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
    keepAwake();
  }
  const greeting = cfg.persona.greeting[lang] ?? "";
  if (ready) speak(greeting);
  else waitFor(() => ready, 30_000).then((ok) => ok && !turns.length && speak(greeting));
});

// ── Boot ────────────────────────────────────────────────────────────────

/** The cover's event texts (event.yaml kiosk:), in the kiosk's language. */
function renderCover() {
  const k = cfg.event.kiosk ?? {};
  const name = cfg.persona.name;
  document.title = `${name} · ${pick(cfg.event.name)}`;
  $("bar-left").textContent = [pick(k.label), name.toUpperCase()].filter(Boolean).join(" · ");
  $("bar-mid").textContent = pick(k.title);
  $("bar-right").textContent = pick(k.coordinates);
  $("cover-sub").textContent = pick(k.subtitle) ? `> ${pick(k.subtitle)}` : "";
  $("cover-when").replaceChildren(...[pick(k.date), pick(k.place)].filter(Boolean).flatMap((x, i) => (i ? [el("br"), x] : [x])));
  // doors: a list of lines, or { en: [...], zh: [...] } per language.
  const doors = (Array.isArray(k.doors) ? k.doors : k.doors?.[lang] ?? k.doors?.en ?? []).map((x) => pick(x)).filter(Boolean);
  $("cover-doors").replaceChildren(...doors.flatMap((x, i) => (i ? [el("br"), x] : [x])));
  $("cover-doors").hidden = !doors.length;
}

function applyConfig() {
  const name = cfg.persona.name;
  renderCover();
  $("hi").replaceChildren("HI, I'M", el("br"), `${name.toUpperCase()}.`);
  $("poster-box").textContent = `掃我，跟 ${name} 聊`;
  $("poster-title").replaceChildren("SCAN TO", el("br"), "TALK TO", el("br"), `${name.toUpperCase()}.`);
  // Points at the public phone app (PUBLIC_URL on the server). The kiosk is
  // signed in as staff, so its QR carries the door code; it changes every
  // 2 minutes, so the picture is fetched again every minute.
  const drawQr = () => ($("app-qr").src = `/api/qr-app?src=kiosk&t=${Date.now()}`);
  drawQr();
  setInterval(drawQr, 60_000);
  body.dataset.theme = cfg.persona.theme || "blue";
  cacheQrs();
  renderBoard();
  setLang(lang);
}

async function main() {
  cfg = await api("/api/kiosk-config");
  lang = cfg.persona.defaultLanguage;
  applyConfig();
  setState("attract");
  try {
    await connectAvatar();
  } catch (err) {
    console.error(`avatar: ${err.message}`);
    reconnect(`boot failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  $("status").textContent = `kiosk server unreachable: ${err.message}`;
  // The server may just be starting — try again rather than sit here.
  setTimeout(() => location.reload(), 10_000);
});
