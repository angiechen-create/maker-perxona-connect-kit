// Staff page. Small on purpose: every save writes event.yaml / attendees.csv
// on the server, and Maker (phones, door screen) picks it up within a second.

const $ = (id) => document.getElementById(id);

const STR = {
  openDoor: { zh: "開啟門口螢幕", en: "Open door screen" },
  openSeeyou: { zh: "預覽結束畫面", en: "Preview thank-you screen" },
  resetCheckins: { zh: "清除全部報到（彩排後、開門前）", en: "Clear all check-ins (after rehearsal)" },
  resetCheckinsConfirm: { zh: "清除全部報到？\n\n所有人變回「還沒到」、「同意介紹」也全部取消（包括你自己的測試）。名單不會被刪。\n\n彩排結束、開門前按一次。按錯可以馬上復原。", en: "Clear all check-ins?\n\nEveryone goes back to \"not here\" and every \"OK to introduce\" is cleared (your own tests too). The list itself stays.\n\nDo this once after rehearsal, before doors open." },
  undoCheckins: { zh: "↶ 復原剛剛的「清除全部報到」（{t}）", en: "↶ Undo \"clear all check-ins\" ({t})" },
  undoStats: { zh: "↶ 復原剛剛的「統計歸零」（{t}）", en: "↶ Undo \"reset stats\" ({t})" },
  undoneCheckins: { zh: "已復原，{n} 人的報到 / 同意介紹回來了", en: "Undone — {n} people's check-in / consent restored" },
  undoneStats: { zh: "已復原統計", en: "Stats restored" },
  resetCheckinsDone: { zh: "已清除，{n} 人都回到「還沒到」", en: "Cleared — all {n} back to \"not here\"" },
  logout: { zh: "登出", en: "Sign out" },
  signIn: { zh: "工作人員登入", en: "Staff sign-in" },
  checkin: { zh: "報到", en: "Check-in" },
  checkinCount: { zh: "到場 {h}/{n} · 可介紹 {i}", en: "{h}/{n} here · {i} introducible" },
  src_luma: { zh: "Luma", en: "Luma" },
  src_ait: { zh: "合辦夥伴頁面", en: "Partner page" },
  src_both: { zh: "兩邊都報", en: "Both" },
  "src_walk-in": { zh: "現場加入", en: "Added on site" },
  sourcesLine: { zh: "報名來源（已到／全部）：{list}", en: "Registered via (here / all): {list}" },
  askScript: {
    zh: "幫人手動報到時，先問他同不同意被介紹，說好才按「同意介紹」。",
    en: "Checking someone in by hand? Ask if they're OK being introduced; tick “OK to introduce” only if they say yes.",
  },
  fAll: { zh: "全部", en: "All" },
  fTodo: { zh: "還沒到", en: "Not here" },
  fHere: { zh: "已到", en: "Here" },
  fIntro: { zh: "可介紹", en: "Introducible" },
  here: { zh: "到了", en: "Here" },
  okIntro: { zh: "同意介紹", en: "OK to introduce" },
  searchPh: { zh: "搜尋名字…", en: "Search names…" },
  noMatch: { zh: "沒有符合的人", en: "Nobody matches" },
  noAnswers: { zh: "（沒有報名回答，介紹時只會用職稱）", en: "(no application answers — only their title will be used)" },
  role: { zh: "職稱／身份", en: "Role" },
  link: { zh: "作品連結（選填）", en: "Project link (optional)" },
  hereTick: { zh: "人已經到了", en: "They're here" },
  addPerson: { zh: "＋ 新增一位參加者（名單上漏掉的人）", en: "+ Add a guest missing from the list" },
  addPersonHint: {
    zh: "例如臨時核准的人、講者帶來的夥伴。加進來後，他就能用手機向 {persona} 報到；勾「同意介紹」的話，{persona} 也會用這裡的名字和回答介紹他。",
    en: "Only add people you approved. Once added they can check in with {persona} on their phone; if “OK to introduce” is ticked, {persona} uses their name, answers and LinkedIn to introduce them.",
  },
  name: { zh: "名字（會顯示在卡片上）", en: "Name (shown on the card)" },
  building: { zh: "在做什麼（一句話）", en: "What they're building (one line)" },
  lookingFor: { zh: "想聊什麼／想認識誰", en: "Wants to talk about / meet" },
  linkedin: { zh: "LinkedIn（選填）", en: "LinkedIn (optional)" },
  consent: {
    zh: "對方同意 {persona} 在現場介紹他，並知道回答會交給 AI 配對、活動後刪除。",
    en: "They agreed to be introduced by {persona} and know their answers go to an AI for matching and are deleted after the event.",
  },
  save: { zh: "儲存", en: "Save" },
  cancel: { zh: "取消", en: "Cancel" },
  edit: { zh: "修改", en: "Edit" },
  remove: { zh: "移除", en: "Remove" },
  optedIn: { zh: "可以被介紹的人", en: "People who can be introduced" },
  importTitle: { zh: "匯入名單或表單回覆（CSV）", en: "Import a guest list or form responses (CSV)" },
  importReplace: { zh: "取代整份名單（換掉練習用的假名單時勾這個）", en: "Replace the whole list (tick this to swap out the practice list)" },
  interestPill: { zh: "主題桌興趣", en: "Table interest" },
  voicePill: { zh: "聲音 ✓{ok} · 退回原聲 {bad}", en: "voice ✓{ok} · fell back {bad}" },
  exportAttendance: { zh: "⬇ 下載出席名單（CSV）", en: "⬇ Download attendance (CSV)" },
  mockWarning: { zh: "⚠️ 目前是練習用的假名單（{n} 人）。拿到真名單後，匯入時勾「取代整份名單」。", en: "⚠️ This is the practice list ({n} people). When the real list arrives, import it with “Replace the whole list”." },
  selfCheckin: { zh: "自己報到 {t}", en: "checked in on phone {t}" },
  importHint: {
    zh: "可以匯入 Luma 報名名單（只收已核准的人），或 Google 表單回覆（勾了同意的人會自動標成「同意介紹」）。email 和電話不會被存下來；匯完請刪除下載的檔案。",
    en: "Import the Luma guest export (approved guests only) or the Google Form responses (people who agreed are marked “OK to introduce”). Emails and phones are never kept; delete the download afterwards.",
  },
  add: { zh: "＋ 新增一筆", en: "+ Add" },
  saved: { zh: "已儲存，Maker 已更新", en: "Saved — Maker has it now" },
  removeConfirm: { zh: "確定移除 {name}？{persona} 之後不會再介紹他。", en: "Remove {name}? {persona} will stop introducing them." },
  todoNote: { zh: "還有 TODO 沒填", en: "Has TODO placeholders" },
  config: { zh: "活動設定", en: "Event config" },
  aiAnswers: { zh: "AI 回答", en: "AI answers" },
  llm_configured: { zh: "正常", en: "OK" },
  llm_credit: { zh: "⚠ AI 額度用完了，Maker 現在答不出來。請到 AI 服務的後台儲值。", en: "⚠ Out of AI credits — Maker can't answer. Top up your AI provider's account." },
  llm_error: { zh: "⚠ 最近的回答失敗了，Maker 現在可能答不出來", en: "⚠ Recent answers failed — Maker may not be answering" },
  llm_notset: { zh: "沒有設定 AI 金鑰", en: "No AI key set" },
  avatar: { zh: "頭像（Perxona）", en: "Avatar (Perxona)" },
  credits: { zh: "點數剩 {n}", en: "{n} credits left" },
  questions: { zh: "Maker 回答 {n} 題", en: "{n} questions answered" },
  intros: { zh: "介紹了 {n} 次", en: "{n} introductions" },
  system: { zh: "系統", en: "System" },
  allOk: { zh: "全部正常", en: "all OK" },
  sectionsHint: { zh: "活動內容（點標題展開編輯）", en: "Event content (tap a title to edit)" },
  todoBadge: { zh: "⚠ 還有沒填的", en: "⚠ has blanks" },
  visits: { zh: "來賓 {n}", en: "{n} visitors" },
  scans: { zh: "門口 QR 掃描 {n}", en: "Door QR scans {n}" },
  resetStats: { zh: "統計歸零（開門前）", en: "Reset stats (before doors)" },
  scansSeeyou: { zh: "結束畫面 QR 掃描 {n}", en: "Thank-you QR scans {n}" },
  phaseLive: { zh: "活動進行中：開放報到", en: "Event on: check-in open" },
  phaseAfter: { zh: "活動已結束：不再接受新報到，有報到的人可用到 {t}", en: "Event over: check-in closed; checked-in guests can use Maker until {t}" },
  phaseClosed: { zh: "Maker 已下線（{t} 結束）", en: "Maker is off (ended {t})" },
  endEvent: { zh: "活動結束", en: "Event over" },
  endConfirm: { zh: "活動結束？\n\n• 門口螢幕換成結束畫面\n• 不再接受新報到\n• Maker 再陪有報到的人 48 小時\n\n按錯可以復原。", en: "End the event?\n\n• The door screen turns into the thank-you screen\n• Check-in closes\n• Maker stays 48 hours for checked-in guests\n\nYou can undo this." },
  undoEnd: { zh: "復原（回到活動中）", en: "Undo (back to event on)" },
  resetConfirm: { zh: "把統計歸零？彩排結束、開門前按一次。按錯可以馬上復原。", en: "Reset the stats? Do this once after rehearsal, before doors open." },
  testRow: { zh: "測試資料，活動前刪除", en: "test row — delete before the event" },
  importedRoster: { zh: "報名名單：讀到 {r} 人，新增 {a}、更新 {u}，名單共 {t} 人", en: "Registration list: read {r}, {a} new, {u} updated — {t} on the roster" },
  importedForm: { zh: "表單：{r} 份回覆，{c} 人同意被介紹（新增 {a}、更新 {u}）", en: "Form: {r} responses, {c} said yes ({a} new, {u} updated)" },
};

let lang = localStorageGet("staff-lang") || "zh";
let state = null;

function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

const t = (key, vars = {}) =>
  (STR[key]?.[lang] ?? STR[key]?.en ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? (k === "persona" ? state?.persona ?? "" : ""));
const L = (obj) => obj?.[lang] ?? obj?.en ?? "";

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

function toast(msg, bad = false) {
  const box = $("toast");
  box.textContent = msg;
  box.className = bad ? "toast bad" : "toast";
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (box.hidden = true), bad ? 6000 : 2500);
}

async function api(url, opts = {}) {
  const res = await fetch(`/api/staff${url}`, {
    ...opts,
    headers: opts.body && typeof opts.body === "string" && !opts.raw ? { "Content-Type": "application/json" } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || "signed out");
  }
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function applyLang() {
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  $("lang").textContent = lang === "zh" ? "EN" : "中文";
  for (const n of document.querySelectorAll("[data-t]")) n.textContent = t(n.dataset.t);
  if (state) render();
}
$("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  localStorageSet("staff-lang", lang);
  applyLang();
});

// ── Login ───────────────────────────────────────────────────────────────

function showLogin() {
  $("app").hidden = true;
  $("logout").hidden = true;
  $("login").hidden = false;
  $("password").focus();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").hidden = true;
  try {
    await api("/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    await load();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").hidden = false;
  }
});

$("logout").addEventListener("click", async () => {
  await api("/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

// ── Status ──────────────────────────────────────────────────────────────

/** The server's warnings are in English; the common one, in the page's language. */
function warning(w) {
  const n = w.match(/still has (\d+) TODO/)?.[1];
  if (n && lang === "zh") return `活動資料還有 ${n} 個地方沒填（下面標 ⚠ 的區塊，例如工作人員位置、Wi-Fi）`;
  return w;
}

function renderStatus() {
  const { status, perxona, stats } = state;
  const line = (ok, label, detail) =>
    el("div", { class: "line" }, el("span", { class: `dot ${ok}` }), el("strong", {}, label), el("span", { class: "hint" }, detail));

  const credit = typeof perxona.credit === "object" ? perxona.credit : null;
  const box = $("status");
  const ph = state.phase ?? { phase: "live" };
  const until = ph.closesAt ? new Date(ph.closesAt).toLocaleString(lang === "zh" ? "zh-TW" : "en-GB", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  const phaseRow = el("div", { class: "line" },
    el("span", { class: `dot ${ph.phase === "live" ? "ok" : "warn"}` }),
    el("strong", {}, ph.phase === "live" ? t("phaseLive") : ph.phase === "after" ? t("phaseAfter", { t: until }) : t("phaseClosed", { t: until })),
    ph.phase === "live"
      ? el("button", { type: "button", onclick: async () => {
          if (!confirm(t("endConfirm"))) return;
          await api("/phase/end", { method: "POST" }).catch((err) => toast(err.message, true));
          await load();
        } }, t("endEvent"))
      : el("button", { class: "ghost", type: "button", onclick: async () => {
          await api("/phase/undo", { method: "POST" }).catch((err) => toast(err.message, true));
          await load();
        } }, t("undoEnd")),
  );
  // One line for "is everything working?" — details only when something isn't.
  const problems = [
    status.error,
    state.llm !== "configured" ? t(`llm_${state.llm.replace(" ", "")}`) : null,
    perxona.api !== "ok" ? `${t("avatar")}：${perxona.api}` : credit?.is_quota_exceeded ? `${t("avatar")}：${t("credits", { n: 0 })}` : null,
    credit && credit.remaining_credit_points < 30 ? `${t("avatar")}：${t("credits", { n: credit.remaining_credit_points })}` : null,
    state.mock ? t("mockWarning", { n: state.mock }) : null,
  ].filter(Boolean);
  const interest = Object.entries(stats.interest ?? {}).sort().map(([k, v]) => `${k === "unsure" ? "?" : "T" + k} ${v}`).join(" · ");
  box.replaceChildren(...[
    phaseRow,
    line(problems.length ? "bad" : "ok", t("system"), problems.length ? "" : t("allOk")),
    problems.length ? el("ul", { class: "problems" }, problems.map((w) => el("li", {}, w))) : null,
    el("div", { class: "kpis" },
      // QR scans by where the QR was: door, Meet Maker slide, deck, thank-you screen.
      ...["door", "meet", "slides", "seeyou"].filter((k) => k === "door" || stats.scans?.[k]).map((k) =>
        el("span", { class: "pill" }, `${{ door: lang === "zh" ? "門口 QR" : "Door QR", meet: "Meet Maker QR", slides: lang === "zh" ? "簡報 QR" : "Deck QR", seeyou: lang === "zh" ? "結束畫面 QR" : "Thank-you QR" }[k]} ${lang === "zh" ? "掃描" : "scans"} ${stats.scans?.[k] ?? 0}`)),
      el("span", { class: "pill" }, t("questions", { n: stats.questions })),
      el("span", { class: "pill" }, t("intros", { n: stats.peopleIntroduced })),
      interest ? el("span", { class: "pill" }, `${t("interestPill")} ${interest}`) : null,
      // What people tap on their phones (counts only).
      stats.taps && Object.keys(stats.taps).length ? el("span", { class: "pill" }, `${lang === "zh" ? "按鈕點擊" : "Taps"} ` + Object.entries(stats.taps).map(([k, v]) => `${({ agenda: lang === "zh" ? "議程" : "Agenda", demos: lang === "zh" ? "Demo 講者" : "Demo speakers", tables: lang === "zh" ? "主題桌" : "Tables", match: lang === "zh" ? "幫我配對" : "Match me", linkedin: "LinkedIn", site: lang === "zh" ? "作品網站" : "Project site", official: lang === "zh" ? "官方頁面" : "Official page", photos: lang === "zh" ? "照片頁" : "Photos", program: lang === "zh" ? "節目單" : "Program" })[k] ?? k} ${v}`).join(" · ")) : null,
    ),
  ].filter(Boolean));
}

// ── People ──────────────────────────────────────────────────────────────

const form = $("person-form");

let filter = "all";
let query = "";

function counts() {
  const all = state.attendees;
  const here = all.filter((p) => p.here).length;
  // Mirrors the server: once anyone is checked in, only people here count.
  const intro = all.filter((p) => p.consent && (here ? p.here : true)).length;
  return { n: all.length, h: here, i: intro };
}

function renderPeople() {
  $("checkin-count").textContent = t("checkinCount", counts());
  const by = {};
  for (const p of state.attendees) {
    const k = STR[`src_${p.source}`] ? p.source : "luma";
    by[k] ??= { here: 0, all: 0 };
    by[k].all++;
    if (p.here) by[k].here++;
  }
  $("sources").textContent = t("sourcesLine", {
    list: ["luma", "ait", "both", "walk-in"].filter((k) => by[k]).map((k) => `${t(`src_${k}`)} ${by[k].here}／${by[k].all}`).join(" · "),
  });
  const q = query.trim().toLowerCase();
  const shown = state.attendees
    .filter((p) => !q || `${p.name} ${p.role}`.toLowerCase().includes(q))
    .filter((p) => filter === "all" || (filter === "todo" && !p.here) || (filter === "here" && p.here) || (filter === "intro" && p.consent))
    .sort((a, b) => a.here - b.here || a.name.localeCompare(b.name));
  $("people").replaceChildren(
    ...(shown.length ? shown.map(personRow) : [el("li", { class: "empty" }, t("noMatch"))]),
  );
}

function toggle(p, key, label) {
  return el("button", {
    type: "button", class: `tick ${key}`, "aria-pressed": String(!!p[key]),
    onclick: async (e) => {
      const next = !p[key];
      e.currentTarget.disabled = true;
      try {
        await api(`/attendees/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ [key]: next }) });
        p[key] = next;
        renderPeople();
      } catch (err) {
        toast(err.message, true);
        e.currentTarget.disabled = false;
      }
    },
  }, `${p[key] ? "✓ " : ""}${label}`);
}

function personRow(p) {
  const about = [p.role, p.building].filter(Boolean).join(" · ");
  return el("li", { class: p.here ? "is-here" : "" },
    el("div", { class: "who" },
      el("strong", {}, p.name),
      el("span", {}, about || ""),
      /^self/.test(p.checkin ?? "") ? el("span", { class: "hint" }, t("selfCheckin", { t: p.checkin.slice(5) })) : null,
      STR[`src_${p.source}`] ? el("span", { class: `src src-${p.source}` }, t(`src_${p.source}`)) : null,
      !p.building && !p.looking_for ? el("div", { class: "test" }, t("noAnswers")) : null,
      /\bTEST\b/i.test(p.name) ? el("div", { class: "test" }, t("testRow")) : null,
    ),
    el("div", { class: "ticks" },
      toggle(p, "here", t("here")),
      toggle(p, "consent", t("okIntro")),
      el("button", { class: "ghost small", type: "button", onclick: () => editPerson(p) }, t("edit")),
    ),
  );
}

$("search").addEventListener("input", (e) => {
  query = e.target.value;
  renderPeople();
});
for (const b of document.querySelectorAll("[data-filter]")) {
  b.addEventListener("click", () => {
    filter = b.dataset.filter;
    for (const x of document.querySelectorAll("[data-filter]")) x.setAttribute("aria-pressed", String(x === b));
    renderPeople();
  });
}

function editPerson(p) {
  for (const k of ["name", "role", "building", "looking_for", "linkedin", "link"]) form[k].value = p[k] ?? "";
  form.replaces.value = p.id;
  form.here.checked = !!p.here;
  form.consent.checked = !!p.consent;
  $("person-cancel").hidden = false;
  $("person-remove").hidden = false;
  $("person-remove").onclick = () => removePerson(p).then(resetPersonForm);
  $("person-details").open = true;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetPersonForm() {
  form.reset();
  form.replaces.value = "";
  form.here.checked = true;
  $("person-cancel").hidden = true;
  $("person-remove").hidden = true;
}
$("person-cancel").addEventListener("click", resetPersonForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  // Unticked checkboxes are absent from FormData; say "no" explicitly.
  body.here = form.here.checked ? "yes" : "no";
  body.consent = form.consent.checked ? "yes" : "no";
  try {
    await api("/attendees", { method: "POST", body: JSON.stringify(body) });
    resetPersonForm();
    toast(t("saved"));
    await load();
  } catch (err) {
    toast(err.message, true);
  }
});

async function removePerson(p) {
  if (!confirm(t("removeConfirm", { name: p.name }))) return;
  try {
    await api(`/attendees/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    toast(t("saved"));
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}

/** The undo buttons, shown only while a clear / reset can still be undone. */
function renderUndo() {
  const when = (iso) => new Date(iso).toLocaleTimeString(lang === "zh" ? "zh-TW" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const u = state.undo ?? {};
  $("undo-checkins").hidden = !u.checkins;
  $("undo-stats").hidden = !u.stats;
  if (u.checkins) $("undo-checkins").textContent = t("undoCheckins", { t: when(u.checkins) });
  if (u.stats) $("undo-stats").textContent = t("undoStats", { t: when(u.stats) });
}
$("undo-checkins").addEventListener("click", async () => {
  try {
    const r = await api("/attendees/undo-reset-checkins", { method: "POST" });
    toast(t("undoneCheckins", { n: r.restored }));
    await load();
  } catch (err) {
    toast(err.message, true);
  }
});
$("undo-stats").addEventListener("click", async () => {
  try {
    await api("/stats/undo-reset", { method: "POST" });
    toast(t("undoneStats"));
    await load();
  } catch (err) {
    toast(err.message, true);
  }
});

$("reset-stats").addEventListener("click", async () => {
  if (!confirm(t("resetConfirm"))) return;
  await api("/stats/reset", { method: "POST" }).catch((err) => toast(err.message, true));
  await load();
});

$("reset-checkins").addEventListener("click", async () => {
  if (!confirm(t("resetCheckinsConfirm"))) return;
  try {
    const r = await api("/attendees/reset-checkins", { method: "POST" });
    toast(t("resetCheckinsDone", { n: r.total }));
    await load();
  } catch (err) {
    toast(err.message, true);
  }
});

$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const r = await api($("import-replace").checked ? "/import?replace=1" : "/import", { method: "POST", body: await file.text(), raw: true, headers: { "Content-Type": "text/csv" } });
    $("import-result").textContent =
      r.kind === "form"
        ? t("importedForm", { r: r.read, c: r.consented, a: r.added, u: r.updated })
        : t("importedRoster", { r: r.read, a: r.added, u: r.updated, t: r.total });
    toast(t("saved"));
    await load();
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = "";
  }
});

// ── Event sections ──────────────────────────────────────────────────────

const hasTodo = (v) => /TODO/.test(JSON.stringify(v ?? ""));

// A TODO placeholder shows as grey hint text, not as text staff must delete.
function fieldInput(f, value) {
  const todo = /TODO/.test(String(value ?? ""));
  const attrs = { "data-key": f.key, placeholder: todo ? String(value).replace(/^TODO\s*/, "") : "" };
  const input = el(f.long ? "textarea" : "input", attrs);
  input.value = todo ? "" : (value ?? "");
  return input;
}

function renderSection(s) {
  // Folded by default: open the one you want to edit.
  const card = el("details", { class: `card fold ${hasTodo(s.value) ? "todo" : ""}` });
  card.append(el("summary", {}, el("span", {}, L(s.title)), hasTodo(s.value) ? el("span", { class: "badge" }, t("todoBadge")) : null));

  const body = el("div", { class: "items" });
  const readValue = () => {
    if (s.kind === "fields") {
      return Object.fromEntries([...body.querySelectorAll("[data-key]")].map((i) => [i.dataset.key, i.value]));
    }
    if (s.kind === "strings") return [...body.querySelectorAll("[data-key]")].map((i) => i.value);
    return [...body.querySelectorAll(".item")].map((item) =>
      Object.fromEntries([...item.querySelectorAll("[data-key]")].map((i) => [i.dataset.key, i.value])),
    );
  };

  const itemBox = (fields, value) => {
    const item = el("div", { class: "item" });
    const grid = el("div", { class: "item-fields" });
    for (const f of fields) {
      grid.append(el("label", { class: f.long ? "long" : "" }, L(f.label), fieldInput(f, value?.[f.key])));
    }
    item.append(grid, el("div", { class: "item-actions" }, el("button", { class: "danger", type: "button", onclick: () => item.remove() }, t("remove"))));
    return item;
  };

  if (s.kind === "fields") {
    const grid = el("div", { class: "item-fields" });
    for (const f of s.fields) grid.append(el("label", {}, L(f.label), fieldInput(f, s.value?.[f.key])));
    body.append(el("div", { class: "item" }, grid));
  } else if (s.kind === "strings") {
    for (const v of s.value ?? []) body.append(itemBox([{ key: "v", label: {}, long: true }], { v }));
  } else {
    for (const v of s.value ?? []) body.append(itemBox(s.fields, v));
  }
  card.append(body);

  const actions = el("div", { class: "section-actions" });
  if (s.kind !== "fields") {
    actions.append(el("button", {
      class: "ghost", type: "button",
      onclick: () => body.append(s.kind === "strings" ? itemBox([{ key: "v", label: {}, long: true }], {}) : itemBox(s.fields, {})),
    }, t("add")));
  }
  actions.append(el("button", {
    type: "button",
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        await api(`/section/${s.key}`, { method: "PUT", body: JSON.stringify({ value: readValue() }) });
        toast(t("saved"));
        await load();
      } catch (err) {
        toast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    },
  }, t("save")));
  card.append(actions);
  return card;
}

function render() {
  $("event-name").textContent = state.event;
  for (const n of document.querySelectorAll("[data-t]")) n.textContent = t(n.dataset.t); // now with the persona name
  renderStatus();
  renderUndo();
  $("search").placeholder = t("searchPh");
  renderPeople();
  $("sections").replaceChildren(el("p", { class: "hint sections-hint" }, t("sectionsHint")), ...state.sections.map(renderSection));
  // strings sections store items under "v"
  for (const ta of document.querySelectorAll('#sections [data-key="v"]')) ta.rows = 2;
}

async function load() {
  state = await api("/state");
  $("login").hidden = true;
  $("app").hidden = false;
  $("logout").hidden = false;
  render();
}

applyLang();
load().catch(() => showLogin());
