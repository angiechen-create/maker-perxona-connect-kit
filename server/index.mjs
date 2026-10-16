import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as config from "./config.mjs";
import * as llm from "./llm.mjs";
import * as perxona from "./perxona.mjs";
import * as alerts from "./alerts.mjs";
import * as stats from "./stats.mjs";
import * as staff from "./staff.mjs";
import * as quota from "./quota.mjs";
import * as tts from "./tts.mjs";
import * as roster from "./roster.mjs";
import * as checkin from "./checkin.mjs";
import * as phase from "./phase.mjs";
import { nudge } from "./nudge.mjs";
import { loc, langs, all, mapText, variants } from "./i18n.mjs";
import { personIn } from "./attendees.mjs";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT || 8090);
// Localhost only by default (a laptop kiosk). A cloud host sets HOST=0.0.0.0;
// /api/ask then answers only checked-in phones (or a staff-signed-in kiosk),
// within the limits in quota.mjs.
const HOST = process.env.HOST || "127.0.0.1";
// The address phones open (what the entrance QR points to). Behind a proxy
// we can't reliably guess it, so set PUBLIC_URL when deployed.
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const SLUG = process.env.EVENT_SLUG;
if (!SLUG) {
  console.error("EVENT_SLUG is not set in .env — which folder under events/ is this kiosk for?");
  process.exit(1);
}

config.seed(SLUG);
roster.init(SLUG);
roster.seedMock();
config.load(SLUG);
config.watch(SLUG);
stats.init(SLUG);

const app = express();
app.disable("x-powered-by");

// Express 4 doesn't catch a rejected async handler, and Node then exits: one
// bad request took the whole service down (and a restart forgets every
// spending cap held in memory). Every async route goes through safe().
const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
process.on("unhandledRejection", (err) => console.error(`[server] unhandled: ${err?.stack ?? err}`));
// Cloud hosts sit behind one proxy; trust it for the client address (rate limits).
// Render puts Cloudflare in front: X-Forwarded-For arrives as
// "<visitor>, <Cloudflare edge>" (measured). Trusting one hop made every
// visitor look like a handful of Cloudflare addresses, so per-address limits
// were shared by a whole country. Trust Render's private network and
// Cloudflare's published ranges instead: the visitor is the first address
// from the right that is neither (a forged entry further left is ignored).
// TRUST_PROXY=<number> trusts that many hops instead, for other hosts.
const CLOUDFLARE = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", hops > 1 ? hops : ["loopback", "linklocal", "uniquelocal", ...CLOUDFLARE]);
}

const PUBLIC = path.resolve(import.meta.dirname, "..", "public");

// Security headers on everything: no framing by other sites (the phone app
// frames its own program page), no MIME sniffing, no full URLs in Referer.
app.use((_req, res, next) => {
  res.set({
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  next();
});

// One address only. Once PUBLIC_URL is a custom domain (e.g. maker.example.com),
// anyone still on the host's own *.onrender.com address is sent there, so
// old links and QR codes keep working. Health checks stay reachable.
const CANONICAL_HOST = PUBLIC_URL ? new URL(PUBLIC_URL).host : "";
app.use((req, res, next) => {
  const host = req.get("host") ?? "";
  if (!CANONICAL_HOST || host === CANONICAL_HOST || !host.endsWith(".onrender.com") || ["/api/health", "/api/ping"].includes(req.path)) return next();
  res.redirect(301, PUBLIC_URL + req.originalUrl);
});

// Link previews (LINE, Messenger, Slack, iMessage) and icons. The pictures
// are made by `npm run og`; the text comes from the event, so each page's
// <head> gets its tags here rather than hard-coded in the HTML.
const PREVIEW_FILES = ["og.png", "og-en.png", "og-zh.png", "og-ja.png", "icon.png", "apple-touch-icon.png"];
for (const file of PREVIEW_FILES) {
  app.get(`/${file}`, (_req, res) =>
    res.sendFile(file, { root: config.repoEventDir(SLUG), maxAge: "1h" }, (err) => err && res.sendStatus(404)));
}
app.get("/favicon.ico", (_req, res) => res.redirect(301, "/icon.png"));

// Changes only when the picture does, so LINE / Messenger refetch it then
// (they cache previews hard) and not on every deploy.
const previewV = {};
function previewVersion(file = "og.png") {
  if (previewV[file]) return previewV[file];
  try {
    previewV[file] = crypto.createHash("sha1").update(fs.readFileSync(path.join(config.repoEventDir(SLUG), file))).digest("hex").slice(0, 8);
  } catch {
    return "0";
  }
  return previewV[file];
}
const PREVIEW_LANGS = ["en", "zh", "ja"];
// Title of the link preview, per language.
const PREVIEW_TITLE = {
  en: (n) => `${n}: Who should you meet tonight? | by Perxona`,
  zh: (n) => `${n}：今晚，你該認識誰？ | by Perxona`,
  ja: (n) => `${n}：今夜、誰に会うべき？ | by Perxona`,
};

const escAttr = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function previewTags(req, page) {
  const { event, persona } = config.get() ?? {};
  const name = persona?.name ?? "Maker";
  const base = PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  // The preview's language: ?lang= on the shared link, else the event's
  // og_lang (English by default). Each language has its own picture.
  const lang = PREVIEW_LANGS.includes(req.query.lang) ? req.query.lang : PREVIEW_LANGS.includes(event?.og_lang) ? event.og_lang : "en";
  const ogFile = fs.existsSync(path.join(config.repoEventDir(SLUG), `og-${lang}.png`)) ? `og-${lang}.png` : "og.png";
  const v = previewVersion();
  const ogV = previewVersion(ogFile);
  const date = String(event?.date ?? "").match(/\d{4}-(\d{2})-(\d{2})/);
  const when = [date ? `${Number(date[1])}/${Number(date[2])}` : "", String(event?.time ?? "").match(/\d{1,2}:\d{2}/)?.[0]].filter(Boolean).join(" ");
  const venue = loc(event?.venue?.name).replace(/\s*\(.*\)$/, "").replace(/\s+(Company|Inc\.?|Ltd\.?)$/i, "");
  const title = page === "staff" ? `${name} · 工作人員報到 | by Perxona` : PREVIEW_TITLE[lang](name);
  const desc = page === "staff"
    ? `${loc(event?.name, "zh")} 現場報到與名單管理。`
    : loc(event?.og_description, lang) || `${[loc(event?.name, lang), when, venue].filter(Boolean).join(" · ")}. Live 3D AI matchmaker by Perxona.`;
  const tags = [
    `<meta name="description" content="${escAttr(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Perxona">`,
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(desc)}">`,
    `<meta property="og:url" content="${escAttr(base + req.path + (req.query.lang && lang === req.query.lang ? `?lang=${lang}` : ""))}">`,
    `<meta property="og:locale" content="${{ en: "en_US", zh: "zh_TW", ja: "ja_JP" }[lang]}">`,
    `<meta property="og:image" content="${escAttr(`${base}/${ogFile}?v=${ogV}`)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escAttr(`${name} — Who should you meet tonight? by Perxona`)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escAttr(title)}">`,
    `<meta name="twitter:description" content="${escAttr(desc)}">`,
    `<meta name="twitter:image" content="${escAttr(`${base}/${ogFile}?v=${ogV}`)}">`,
    `<link rel="icon" type="image/png" href="/icon.png?v=${v}">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${v}">`,
    `<meta name="apple-mobile-web-app-title" content="${escAttr(name)}">`,
    page === "staff" ? `<meta name="robots" content="noindex">` : "",
  ];
  return tags.filter(Boolean).join("\n    ");
}

for (const page of ["m", "kiosk", "staff"]) {
  app.get([`/${page}`, `/${page}/`, `/${page}/index.html`], (req, res, next) => {
    if (req.path === `/${page}`) return res.redirect(301, `/${page}/`);
    fs.readFile(path.join(PUBLIC, page, "index.html"), "utf8", (err, html) => {
      if (err) return next();
      res.set("Cache-Control", "no-cache").type("html").send(html.replace("</head>", `    ${previewTags(req, page)}\n  </head>`));
    });
  });
}

app.use(express.static(PUBLIC, { etag: false, maxAge: 0 }));
// The entrance QR opens the site root: that's the phone app.
app.get("/", (req, res) => res.redirect(PREVIEW_LANGS.includes(req.query.lang) ? `/m/?lang=${req.query.lang}` : "/m/"));
app.use("/api/staff", staff.router(SLUG));
app.use("/api", checkin.router());

// The program page (/m/guide.html): agenda with the demo speakers, the
// speakers, topic tables, tonight's people, food and links. For checked-in
// guests (or staff), like everything else about the evening's people.
// The phone's check-in token: in the X-Token header (an address ends up in
// access logs); ?token= still works for a page loaded before this change.
const tokenOf = (req) => req.get("x-token") ?? req.query.token;

app.get("/api/guide", (req, res) => {
  if (!checkin.visitor(tokenOf(req)) && !staff.isStaff(req)) return res.status(401).json({ error: "checkin" });
  const { event } = config.get();
  const people = Object.fromEntries((event.featured_people ?? []).map((f) => [f.id, f]));
  const card = (f) => f && { ...featuredCard(f), demo: undefined };
  // Every text comes as { en, zh, ja } (fallbacks filled in): the page
  // switches language without asking again.
  const noParens = (v) => mapText(v, (x) => x.replace(/\s*\(.*\)$/, ""));
  res.json({
    name: all(event.name),
    languages: llm.eventLangs(config.get().persona),
    about: config.get().persona.about ?? {},
    date: event.date,
    time: event.time ?? "",
    venue: all(event.venue?.name),
    schedule: realSchedule(event).map((s) => ({ time: s.time, ...all(scheduleLabel(s)) })),
    demos: realDemos(event).map((d, i) => ({
      n: i + 1, round: Number(d.round) || 1, title: all(d.title, { zh: d.title_zh, ja: d.title_ja }), ...all(d.one_liner, { zh: d.zh, ja: d.ja }),
      ask: all(d.ask, { zh: d.ask_zh, ja: d.ask_ja }),
      speaker: card(people[d.speaker]) ?? { name: langs(noParens(d.presenter)) },
    })),
    tables: llm.realTables(event).map((t) => ({
      table: String(t.table), topic: all(t.topic, { zh: t.topic_zh, ja: t.topic_ja }), ...all(t.detail, { zh: t.zh, ja: t.ja }), language: all(t.language, { zh: t.language_zh, ja: t.language_ja }),
      lead: card(featuredNamed(event, t.lead ?? t.host)) ?? { name: langs(noParens(t.lead ?? t.host ?? "")) },
    })),
    people: (event.guide_people ?? []).map((id) => card(people[id])).filter(Boolean),
    food: event.food?.guide == null ? null : all(event.food.guide),
    menu: (event.food?.menu ?? []).map((m) => ({
      ...m,
      name: all(m.name ?? m.en, { zh: m.zh, ja: m.ja }),
      tag: all(m.tag ?? m.tag_en, { zh: m.tag_zh, ja: m.tag_ja }),
    })),
    drinks: event.food?.drinks_guide == null ? null : all(event.food.drinks_guide),
    links: Object.fromEntries((event.guide_links ?? []).filter((k) => linkTargets(event)[k]).map((k) => [k, { url: linkTargets(event)[k], label: all(event.link_labels?.[k] ?? k) }])),
  });
});

// Maker's line for a tapped quick button, or when the visitor has gone
// quiet (nudge.mjs). Costs no question; spoken like any answer.
app.get("/api/nudge", (req, res) => {
  if (!checkin.visitor(tokenOf(req))) return res.status(401).json({ error: "checkin" });
  if (phase.get().phase === "closed") return res.status(410).json({ error: "closed", closed: true });
  const kind = ["agenda", "demos", "tables", "idle"].includes(req.query.kind) ? req.query.kind : "idle";
  const lang = llm.eventLangs(config.get().persona).includes(req.query.lang) ? req.query.lang : "en";
  const { event } = config.get();
  const today = config.isDemo(event) || String(event.date ?? "").slice(0, 10) === todayIn(event.timezone);
  const out = nudge(event, kind, lang, { today, tables: llm.realTables(event).length });
  tts.allow(out.reply);
  llm.issue(out.reply);
  stats.recordTap(`nudge-${kind}`);
  res.set("Cache-Control", "no-store").json({ ...out, lang });
});

// Who this phone checked in as. Tonight's host, guests, speakers and Topic Leads come with it:
// the event's people are only for those who checked in.
app.get("/api/me", (req, res) => {
  const p = checkin.visitor(tokenOf(req));
  if (!p) return res.json({ checkedIn: false, ...phase.get() });
  tts.welcomeBack(checkin.firstNames(p)); // the page may greet them by voice
  res.json({
    ...phase.get(),
    // First name only: a token got by typing a first name mustn't reveal the full one.
    checkedIn: true, name: checkin.firstName(p.name), first: checkin.firstName(p.name), consent: p.consent,
    // Their first name as each language writes it (the demo's 林小雨 is "Rain" in English).
    firsts: checkin.firstNames(p),
    featured: (config.get().event.featured_people ?? []).map((f) => featuredCard(f)),
  });
});

// Images that live in the event folder (e.g. the background photo). Images
// only — this folder also holds attendees.csv, which must never be served.
app.get("/event-assets/:file", (req, res) => {
  const file = req.params.file;
  if (!/^[\w.-]+\.(webp|png|jpe?g)$/i.test(file)) return res.sendStatus(404); // no SVG: it can carry script
  res.sendFile(file, { root: config.eventDir(SLUG) }, (err) => err && res.sendStatus(404));
});

// What the kiosk needs to boot. Re-read on every call so a persona edit
// shows up on the next page load without restarting anything.
app.get("/api/kiosk-config", safe(async (_req, res) => {
  const { event, persona, version } = config.get();
  tts.allowAlways(Object.values(persona.greeting ?? {}).map(String)); // the phone and kiosk say it
  // What Maker says on the About page, part by part.
  tts.allowAlways(Object.values(persona.about?.speech ?? {}).flatMap((l) => Object.values(l ?? {})).map(String));
  const [avatarImage, motions] = await Promise.all([
    perxona.avatarImage(persona.avatar.avatarId),
    perxona.avatarMotions(persona.avatar.avatarId),
  ]);
  res.json({
    version,
    presenterUrl: perxona.PRESENTER_URL,
    target: persona.avatar,
    avatarImage,
    motions,
    tts: tts.defaultVoice(),
    persona: {
      name: persona.name,
      languages: persona.languages,
      defaultLanguage: persona.defaultLanguage,
      greeting: persona.greeting,
      about: persona.about,
      theme: persona.theme,
      background: persona.background ? `/event-assets/${encodeURIComponent(persona.background)}?v=${version}` : "",
    },
    event: {
      name: event.name,
      // The demo is always tonight (the agenda marks ◀ NOW).
      date: config.isDemo(event) ? todayIn(event.timezone) : event.date,
      time: event.time ?? "",
      // Display texts below are a string, or { en, zh, ja } when the event
      // writes them per language: each screen picks its own (i18n.mjs).
      venue: langs(event.venue?.name),
      // For the offline board: shown when the avatar or the network is down.
      kiosk: event.kiosk ?? {},
      // `label`: the row's title in each language (" — details" left off).
      schedule: realSchedule(event).map((s) => ({ ...s, label: langs(scheduleLabel(s)) })),
      tables: llm.realTables(event).map((t) => tableCard(t)),
      links: Object.keys(linkTargets(event)),
    },
    llm: llm.enabled(),
    // No Perxona key: the page invites the person running it to sign up.
    perxonaReady: !!perxona.PUBLISHABLE,
    phase: phase.get(),
    questionLimit: questionLimit(config.get()),
    // Check-in needs the entrance screen's QR (see checkin.mjs).
    doorCheckin: checkin.doorRequired(event),
    // Demo: the made-up guests a visitor can try Maker as (index = what /api/demo-checkin takes).
    demo: config.isDemo(event) ? { guests: (event.demo.guests ?? []).map((g) => ({ label: g.label ?? { en: g.name, zh: g.name }, role: g.role ?? null, short: g.short ?? null })) } : null,
    optInUrl: linkTargets(event).opt_in_form ?? "",
    publicUrl: PUBLIC_URL,
  });
}));

/**
 * A card for the host, a special guest, a speaker or a Topic Lead (photo
 * served from the event folder). With `lang`, its texts in that language;
 * without, each text as written (a string, or { en, zh, ja }) for a page
 * that switches language itself.
 */
function featuredCard(f, lang) {
  const text = (v) => (lang ? loc(v, lang) : langs(v));
  return {
    id: f.id, name: text(f.name), title: text(f.title ?? ""), tonight: text(f.tonight ?? ""),
    // Their role tonight in each language (host / special guest / speaker / Topic Lead).
    role: f.role && typeof f.role === "object" ? { en: f.role.en ?? "", zh: f.role.zh ?? "", ja: f.role.ja ?? "" } : null,
    linkedin: /^https:\/\/([a-z]+\.)?linkedin\.com\//.test(f.linkedin ?? "") ? f.linkedin : "",
    // Their project / demo site: the card's button when there's no LinkedIn.
    link: /^https:\/\//.test(f.link ?? "") ? f.link : "",
    photo: /^[\w.-]+\.(webp|png|jpe?g)$/i.test(f.photo ?? "") ? `/event-assets/${f.photo}?v=${config.get().version}` : "",
  };
}

/** The featured person a Topic Lead line names ("Leo Chen (…)"), in any of their names. */
function featuredNamed(event, who) {
  const want = new Set(variants(who).map((n) => n.replace(/\s*\(.*\)$/, "").toLowerCase()));
  return (event.featured_people ?? []).find((f) => variants(f.name).some((n) => want.has(n.toLowerCase())));
}

const realSchedule = (event) => (event.schedule ?? []).filter((s) => s?.time && !/TODO/.test(s.time + loc(s.what)));
const realDemos = (event) => (event.demos?.lineup ?? []).filter((d) => d?.title && !/TODO/.test(loc(d.title)));
/** A schedule row's title per language: "Doors open — check-in…" → "Doors open"; zh / ja keys win. */
const scheduleLabel = (s) => langs(mapText(s.what, (x) => x.split(" — ")[0]), { zh: s.zh, ja: s.ja });

/**
 * A topic table for the screens. Without `lang`: each text as written
 * (string or { en, zh, ja }); `detail` / `zh` / `ja` stay the line under the
 * title in each language, as before. With `lang`: plain strings in it.
 */
function tableCard(t, lang) {
  const topic = langs(t.topic, { zh: t.topic_zh, ja: t.topic_ja });
  const line = all(t.detail, { zh: t.zh, ja: t.ja });
  const language = langs(t.language, { zh: t.language_zh, ja: t.language_ja });
  const host = String(loc(t.lead ?? t.host ?? "", lang ?? "en"));
  return lang
    ? { table: String(t.table), topic: loc(topic, lang), detail: line[lang], zh: line.zh, ja: line.ja, language: loc(language, lang), host }
    : { table: String(t.table), host: langs(t.lead ?? t.host ?? ""), topic, detail: line.en, zh: line.zh, ja: line.ja, language };
}

// "Which topic table are you most curious about?" — counts only, one vote per phone.
app.post("/api/interest", express.json({ limit: "1kb" }), (req, res) => {
  if (!checkin.visitor(req.body?.me)) return res.status(401).json({ error: "checkin" });
  const table = String(req.body?.table ?? "");
  if (!llm.realTables(config.get().event).some((t) => String(t.table) === table) && table !== "unsure") return res.status(400).json({ error: "table" });
  stats.recordInterest(quota.cleanDevice(req.get("x-device")) || req.ip, table);
  res.sendStatus(204);
});

// Trying another avatar (?avatar=<id> on the phone): its picture and motions.
app.get("/api/avatar-info", safe(async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!/^[0-9A-Z]{26}$/.test(id)) return res.status(400).json({ error: "id" });
  // It asks Perxona with the secret key: staff trying avatars, or this event's own.
  if (!staff.isStaff(req) && id !== config.get().persona.avatar.avatarId) return res.status(403).json({ error: "staff only" });
  const [image, motions] = await Promise.all([perxona.avatarImage(id), perxona.avatarMotions(id)]);
  res.json({ image, motions });
}));

// Kiosk heartbeat: cheap, local, and tells the page when the config changed.
app.get("/api/ping", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ ok: true, version: config.get().version });
});

app.get("/api/connect-key", (_req, res) => {
  if (!perxona.PUBLISHABLE) return res.status(503).json({ error: "PERXONA_CONNECT_PUBLISHABLE_KEY is not set" });
  res.json({ connect_key: perxona.PUBLISHABLE });
});

app.post("/api/ask", express.json({ limit: "16kb" }), safe(async (req, res) => {
  const turns = Array.isArray(req.body?.turns) ? req.body.turns : null;
  const valid =
    turns &&
    turns.length > 0 &&
    turns.length <= 20 &&
    turns.every((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.length <= 1000) &&
    turns.at(-1).role === "user";
  if (!valid) return res.status(400).json({ error: "turns must be [{role, text}] ending with the visitor's message" });
  // Maker is for tonight's checked-in attendees only (or the staff-run kiosk):
  // the answers are built from people's registrations.
  if (phase.get().phase === "closed") return res.status(410).json({ error: "closed", closed: true });
  const visitor = checkin.visitor(req.body?.me);
  if (!visitor && !staff.isStaff(req)) return res.status(401).json({ error: "checkin" });

  const cfg = config.get();
  const limit = questionLimit(cfg);
  // Phones send their anonymous id; without one there's no per-phone limit,
  // so no answer. The staff-run kiosk counts as one device.
  const deviceId = quota.cleanDevice(req.get("x-device")) ?? (staff.isStaff(req) ? "staff-kiosk" : null);
  if (!deviceId) return res.status(400).json({ error: "device" });
  const daily = dailyLimits(cfg);
  // At a real event each guest has their own limit too (the demo's guests are shared).
  const personId = config.isDemo(cfg.event) ? undefined : visitor?.id;
  const { ticket, blocked } = quota.reserve({ deviceId, personId, ip: req.ip, limit, daily });
  if (blocked) {
    console.log(`[ask] limited: ${blocked}`);
    return res.status(429).json({ limited: blocked, used: quota.used(deviceId), limit });
  }

  // Visitor text is never logged — only that a question happened.
  const t0 = Date.now();
  let out;
  try {
    out = await llm.ask(cfg, turns, req.body?.lang, visitor);
  } catch (err) {
    quota.refund(ticket);
    throw err;
  }
  if (out.fallback && !out.billed) quota.refund(ticket);
  else quota.done(ticket);
  tts.allow(out.reply);
  if (!out.fallback) llm.issue(out.reply);
  stats.recordAnswer(out);
  console.log(`[ask] ${out.lang} ${Date.now() - t0}ms${out.people.length ? ` people=${out.people.length}` : ""}${out.tables.length ? ` tables=${out.tables.length}` : ""}${out.fallback ? ` fallback=${out.fallback}` : ""}`);
  res.json({
    reply: out.reply,
    lang: out.lang,
    emotion: out.emotion,
    agenda: !!out.agenda,
    tablesCard: !!out.tablesCard,
    // Cards in the reply's language, like the reply.
    featured: (out.featured ?? []).map((f) => featuredCard(f, out.lang)),
    followups: out.followups ?? [],
    // A page to open (official site, photos and videos…): url + label per language.
    link: out.link === "program"
      ? { url: "/m/guide.html", label: { zh: "打開完整節目單", en: "Open tonight's full program", ja: "今夜のプログラムを開く" } }
      : out.link ? { url: config.get().event.links[out.link], label: all(config.get().event.link_labels?.[out.link] ?? out.link) } : null,
    fallback: out.fallback,
    used: quota.used(deviceId),
    limit,
    // Only people who agreed to be introduced reach this point; their link is
    // a tap target on a phone and a QR code (drawn server-side) on the kiosk.
    people: out.people.map((p) => ({
      id: p.id, ...personIn(p, out.lang), looking_for: undefined,
      qr: p.linkedin ? "linkedin" : p.link ? "link" : null,
      url: p.linkedin || p.link || "",
    })),
    tables: out.tables.map((t) => tableCard(t, out.lang)),
  });
}));

function questionLimit(cfg) {
  const demo = config.isDemo(cfg.event) ? cfg.event.demo.per_device : undefined;
  const n = Number(demo ?? cfg.event.kiosk?.question_limit ?? process.env.QUESTION_LIMIT ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** The demo's daily caps (event.yaml demo:), or null for a real event. */
function dailyLimits(cfg) {
  if (!config.isDemo(cfg.event)) return null;
  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  return { day: todayIn(cfg.event.timezone), perIp: num(cfg.event.demo.per_ip_per_day, 30), total: num(cfg.event.demo.per_day, 200) };
}

/** "2026-10-12" in the event's time zone. */
function todayIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Taipei" }).format(new Date());
}

// How many questions this phone has used (the page shows [07/20]).
app.get("/api/quota", (req, res) => {
  res.set("Cache-Control", "no-store").json({ used: quota.used(quota.cleanDevice(req.get("x-device"))), limit: questionLimit(config.get()) });
});

// The phone app's address as a QR, for the entrance poster.
// ?src=door: the QR on the entrance screen, so its scans can be counted.
// On a screen signed in as staff it also carries the door code that lets a
// phone check in (checkin.mjs); the screens fetch it again every minute.
// X-Door-Code says whether it did, so a screen can warn when it can't.
const SRC = /^[a-z0-9-]{1,20}$/;
app.get("/api/qr-app", safe(async (req, res) => {
  const url = PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const src = SRC.test(String(req.query.src ?? "")) ? String(req.query.src) : "";
  const withCode = !!src && staff.isStaff(req) && checkin.doorRequired(config.get().event);
  const target = `${url}/${src ? `m/?src=${src}${withCode ? `&k=${checkin.currentDoorCode()}` : ""}` : ""}`;
  const svg = await QRCode.toString(target, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.type("image/svg+xml").set("Cache-Control", "no-store").set("X-Door-Code", withCode ? "1" : "0").send(svg);
}));

// The door screen: Maker's invitations, and how many have checked in (a
// number only — the door shows nothing about anyone).
// ?set=seeyou: the thank-you screen's lines (after the event).
app.get("/api/door", (req, res) => {
  const set = ["seeyou", "meet"].includes(req.query.set) ? req.query.set : "door";
  const lines = (config.get().event[`${set}_lines`] ?? [])
    .map((l) => ({ lang: ["zh", "en", "ja"].includes(l?.lang) ? l.lang : "en", text: String(l?.text ?? "").trim() }))
    .filter((l) => l.text);
  tts.allowAlways(lines.map((l) => l.text));
  res.set("Cache-Control", "no-store").json({ lines, checkedIn: roster.read().filter((p) => p.here).length, ...phase.get() });
});

// A phone opened Maker from a QR (?src=…): counted once per phone, nothing else kept.
app.post("/api/scan", express.json({ limit: "1kb" }), (req, res) => {
  const src = String(req.body?.src ?? "");
  const device = quota.cleanDevice(req.get("x-device"));
  if (!SRC.test(src) || !device) return res.status(400).json({ error: "src" });
  stats.recordScan(device, src);
  res.sendStatus(204);
});

app.post("/api/tap", express.json({ limit: "1kb" }), (req, res) => {
  stats.recordTap(String(req.body?.what ?? ""));
  res.sendStatus(204);
});

app.post("/api/visit", (_req, res) => {
  stats.recordVisit();
  res.sendStatus(204);
});

// QR codes for the event's own links (Luma, opt-in form…). Drawn here, not
// by a CDN, so they still work when the venue network is down.
function linkTargets(event) {
  // No prototype: a key like "constructor" or "__proto__" from the URL must
  // find nothing (it used to find Object's own and crash the QR maker).
  return Object.assign(Object.create(null), Object.fromEntries(
    Object.entries(event.links ?? {}).filter(([, url]) => typeof url === "string" && /^https?:\/\//.test(url)),
  ));
}
app.get("/api/qr-link/:key", safe(async (req, res) => {
  const url = linkTargets(config.get().event)[req.params.key];
  if (!url) return res.sendStatus(404);
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.type("image/svg+xml").send(svg);
}));

// LinkedIn QR for a recommended person, by id. Only opted-in people have ids.
app.get("/api/qr/:id", safe(async (req, res) => {
  if (!staff.isStaff(req)) return res.sendStatus(401); // the kiosk only
  const person = config.get().attendees.people.find((p) => p.id === req.params.id);
  const url = person?.linkedin || person?.link;
  if (!url) return res.sendStatus(404);
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.type("image/svg+xml").set("Cache-Control", "no-store").send(svg);
}));

// Maker's voice from ElevenLabs / OpenAI: MP3 of a line Maker just said.
// Capped per address so nobody can burn the voice credits from outside.
const ttsHits = new Map(); // ip → [timestamps]
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ttsHits) if (!v.some((t) => now - t < 10 * 60_000)) ttsHits.delete(k);
}, 60_000).unref();
app.post("/api/tts", express.json({ limit: "4kb" }), safe(async (req, res) => {
  const now = Date.now();
  const ip = quota.ipKey(req.ip);
  const hits = (ttsHits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 120) return res.status(429).json({ error: "too many voice requests" });
  hits.push(now);
  ttsHits.set(ip, hits);
  const { text, lang, voice, provider, emotion, model, tune, speed, lab, me } = req.body ?? {};
  // Fixed lines (the door screen, the greeting) for anyone; Maker's answers
  // only for the checked-in visitor (or the staff-run kiosk) who got them.
  if (!tts.isFixed(text) && !checkin.visitor(me) && !staff.isStaff(req)) return res.status(401).json({ error: "checkin" });
  try {
    // `lab`: tuning experiments only (stability, seed, nobreak, nolang); same
    // allow-list and rate limit as everything else here.
    const audio = await tts.speak(text, { lang, voice, provider, emotion, model, tune, speed, lab: lab && typeof lab === "object" ? lab : undefined });
    res.set("Cache-Control", "no-store").type(audio.subarray(0, 4).toString() === "RIFF" ? "audio/wav" : "audio/mpeg").send(audio);
  } catch (err) {
    if (err.status !== 403 && err.status !== 429) console.error(`[tts] ${err.message}`);
    if (err.status === 429) stats.recordVoice(false, "daily-limit");
    // Our own reasons (not allowed, daily limit) are fine to say; a voice
    // service's error text stays in the log.
    const ours = err.status === 401 || err.status === 403 || err.status === 429;
    res.status(err.status ?? 500).json({ error: ours ? err.message : "voice unavailable" });
  }
}));

// The phone reports how each line was voiced, so a silent fallback to the
// other voice shows up in /api/health and on the staff page.
// Only a handful of known reasons are kept (the phone's own wording, first
// word): anything else is "other", so a script can't grow the stats file.
const VOICE_REASONS = new Set(["play", "ended", "timeout", "tts", "daily-limit"]);
app.post("/api/voice-event", express.json({ limit: "1kb" }), (req, res) => {
  const word = String(req.body?.reason ?? "").trim().split(/[\s:]/)[0].toLowerCase();
  stats.recordVoice(req.body?.ok === true, VOICE_REASONS.has(word) ? word : word ? "other" : "");
  res.sendStatus(204);
});

// Details (credit balance, usage) only for staff, or on the machine running
// Maker (npm run rehearse). On a public URL anyone else just sees it's up.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
app.get("/api/health", safe(async (req, res) => {
  // Loopback with no proxy header: really this machine (a reverse proxy on the
  // same host connects from loopback too, but adds X-Forwarded-For).
  const local = LOOPBACK.has(req.socket.remoteAddress) && !req.get("x-forwarded-for");
  if (!staff.isStaff(req) && !local) {
    return res.set("Cache-Control", "no-store").json({ ok: !config.status().error, version: config.get().version });
  }
  res.json({
    config: config.status(),
    stats: stats.get(), // anonymous counts only
    llm: llm.status(),
    tts: tts.providers(),
    practiceRoster: roster.mockCount(),
    demoToday: config.isDemo(config.get().event) ? quota.demoToday() : undefined,
    ttsRetries: tts.retries,
    voiceToday: tts.usage(),
    perxona: await perxona.check(),
  });
}));

// Anything that went wrong: a short message, never a stack trace or server paths.
app.use((err, req, res, _next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "too large" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad json" });
  console.error(`[server] ${req.method} ${req.path}: ${err?.stack ?? err}`);
  if (!res.headersSent) res.status(500).json({ error: "server error" });
});

app.listen(PORT, HOST, () => {
  console.log(`\nMaker — ${loc(config.get().event.name)}`);
  console.log(`  Kiosk : http://localhost:${PORT}/kiosk/`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  alerts.start(loc(config.get().event.name, "zh"));
  console.log(`  LLM   : ${llm.enabled() ? "✓" : "✗ ANTHROPIC_API_KEY not set — avatar will only say the fallback line"}`);
  tts.warmUp();
  llm.warmUp(config.get()).then((w) => {
    if (w) console.log(`  Warm-up: ${w.ok ? "✓" : "✗ fallback — check the key and credits"} ${w.ms}ms`);
  });
  perxona.check().then((p) => {
    const credit = typeof p.credit === "object" ? ` · credits left ${p.credit.remaining_credit_points}/${p.credit.total_credit_points}${p.credit.is_quota_exceeded ? " ✗ QUOTA EXCEEDED" : ""}` : "";
    console.log(`  Perxona: ${p.api === "ok" ? "✓" : "✗"} ${p.api}${credit}`);
    if (!p.publishableKey) {
      console.log("  ✗ PERXONA_CONNECT_PUBLISHABLE_KEY not set — Maker can't appear in 3D yet.");
      console.log("    Start a free Perxona trial at https://console.perxona.ai and create two Connect keys (README, step 2).");
    }
  });
});
