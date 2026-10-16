// Staff page API: edit the event on the day without touching files.
//
// Everything here writes the same files a person would edit by hand
// (event.yaml, attendees.csv), so the config watcher, the git history and the
// "edit the file" workflow all keep working. Writes are atomic (temp file +
// rename) so the watcher never sees half a file.
//
// Auth: one shared password (STAFF_PASSWORD in .env) → an HttpOnly cookie.
// Sessions live in memory; a restart logs everyone out, which is fine.

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import * as config from "./config.mjs";
import * as stats from "./stats.mjs";
import * as perxona from "./perxona.mjs";
import * as llm from "./llm.mjs";
import * as roster from "./roster.mjs";
import * as phase from "./phase.mjs";
import { ipKey } from "./quota.mjs";
import { fromCsv, toCsv, isConsent, readRows, merge, parseCsv } from "./attendees.mjs";
import { isLangMap, loc } from "./i18n.mjs";

const PASSWORD = process.env.STAFF_PASSWORD || "";
// On a public host a short staff password can be guessed; say so loudly.
if (PASSWORD && PASSWORD.length < 12 && !["127.0.0.1", "localhost", "::1"].includes(process.env.HOST || "127.0.0.1")) {
  console.warn("⚠ STAFF_PASSWORD is shorter than 12 characters on a public host. Use a long random one.");
}
const COOKIE = "concierge_staff";
const sessions = new Map(); // token → expiry (24 h, also enforced here, not just by the browser)

/**
 * What staff can edit, and how the page should draw it. Paths are into
 * event.yaml. Anything not listed here is still editable by hand.
 *
 * List items keep what the page doesn't edit (a demo's speaker id, its
 * Japanese line…): a saved item takes those from the item it was, found by
 * `match` (the first of those fields that still has the same text).
 * `translations`: keys holding another language's version of a field;
 * they go when staff change that field, so no stale translation stays on screen.
 */
export const SECTIONS = [
  {
    key: "venue",
    title: { zh: "現場資訊", en: "On-site info" },
    kind: "fields",
    path: ["venue"],
    fields: [
      { key: "staff_desk", label: { zh: "工作人員在哪", en: "Where to find staff" } },
      { key: "wifi", label: { zh: "Wi-Fi 名稱與密碼", en: "Wi-Fi name & password" } },
      { key: "restrooms", label: { zh: "廁所", en: "Restrooms" } },
      { key: "food_and_drinks", label: { zh: "餐飲", en: "Food & drinks" } },
    ],
  },
  {
    key: "house_rules",
    title: { zh: "現場守則", en: "House rules" },
    kind: "strings",
    path: ["house_rules"],
  },
  {
    key: "faq",
    title: { zh: "常見問題", en: "FAQ" },
    kind: "list",
    path: ["faq"],
    match: ["q"],
    fields: [
      { key: "q", label: { zh: "問題", en: "Question" } },
      { key: "a", label: { zh: "回答", en: "Answer" }, long: true },
    ],
  },
  {
    key: "demos",
    title: { zh: "Demo 名單", en: "Demo lineup" },
    kind: "list",
    path: ["demos", "lineup"],
    match: ["title", "presenter"],
    translations: { title: ["title_zh", "title_ja"], one_liner: ["zh", "ja"], presenter: [] },
    fields: [
      { key: "title", label: { zh: "作品", en: "Project" } },
      { key: "presenter", label: { zh: "講者", en: "Presenter" } },
      { key: "one_liner", label: { zh: "一句話介紹", en: "One-liner" }, long: true },
      { key: "round", label: { zh: "第幾輪（1 或 2）", en: "Round (1 or 2)" } },
    ],
  },
  {
    key: "tables",
    title: { zh: "主題桌", en: "Topic tables" },
    kind: "list",
    path: ["topic_tables", "tables"],
    match: ["table", "topic"],
    translations: { topic: ["topic_zh", "topic_ja"], language: ["language_zh", "language_ja"] },
    fields: [
      { key: "table", label: { zh: "桌號", en: "Table" } },
      { key: "topic", label: { zh: "主題（英文標題）", en: "Topic (title)" } },
      { key: "detail", label: { zh: "英文說明一句", en: "One line, English" } },
      { key: "zh", label: { zh: "中文說明一句", en: "One line, 中文" } },
      { key: "ja", label: { zh: "日文說明一句", en: "One line, 日本語" } },
      { key: "lead", label: { zh: "桌長", en: "Topic Lead" } },
      { key: "language", label: { zh: "語言", en: "Language" } },
    ],
  },
  {
    key: "door_lines",
    title: { zh: "門口螢幕：Maker 輪流講的話", en: "Door screen: what Maker says" },
    kind: "list",
    path: ["door_lines"],
    fields: [
      { key: "lang", label: { zh: "語言（zh 或 en）", en: "Language (zh or en)" } },
      { key: "text", label: { zh: "這句話", en: "Line" }, long: true },
    ],
  },
  {
    key: "meet_lines",
    title: { zh: "Meet Maker 投影片：Maker 自我介紹", en: "Meet Maker slide: what Maker says" },
    kind: "list",
    path: ["meet_lines"],
    fields: [
      { key: "lang", label: { zh: "語言（zh 或 en）", en: "Language (zh or en)" } },
      { key: "text", label: { zh: "這句話", en: "Line" }, long: true },
    ],
  },
  {
    key: "seeyou_lines",
    title: { zh: "結束畫面：Maker 輪流講的話", en: "Thank-you screen: what Maker says" },
    kind: "list",
    path: ["seeyou_lines"],
    fields: [
      { key: "lang", label: { zh: "語言（zh 或 en）", en: "Language (zh or en)" } },
      { key: "text", label: { zh: "這句話", en: "Line" }, long: true },
    ],
  },
];

// ── helpers ──────────────────────────────────────────────────────────────

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const clean = (v, max = 600) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// The page edits one text per field. A field written per language
// ({ en, zh, ja }) shows as its English; saved unchanged, every language
// stays. Changed, the new text replaces them: it's what staff meant now.
const flat = (v) => (isLangMap(v) ? loc(v, "en") : v);
const flatItem = (v) => (v && typeof v === "object" && !Array.isArray(v) && !isLangMap(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flat(x)])) : flat(v));
const flatValue = (v) => (Array.isArray(v) ? v.map(flatItem) : flatItem(v));
const unchanged = (old, next) => isLangMap(old) && clean(loc(old, "en")) === next;

/** One saved list item on top of the item it was (see SECTIONS). */
function mergeItem(section, old, item) {
  const out = old && typeof old === "object" ? { ...old } : {};
  for (const f of section.fields) {
    const next = item[f.key];
    if (unchanged(old?.[f.key], next)) continue;
    if (old && clean(flat(old[f.key])) !== (next ?? "")) for (const k of section.translations?.[f.key] ?? []) delete out[k];
    if (next) out[f.key] = next;
    else delete out[f.key];
  }
  return out;
}

function cookieValue(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m?.[1];
}

/** Signed in on the staff page (the kiosk laptop rides on this cookie too). */
export const isStaff = (req) => {
  const token = cookieValue(req);
  const exp = token ? sessions.get(token) : 0;
  if (exp && exp < Date.now()) sessions.delete(token);
  return !!exp && exp > Date.now();
};
const requireStaff = (req, res, next) =>
  isStaff(req) ? next() : res.status(401).json({ error: "not signed in" });

// Five wrong passwords a minute per address (IPv6: per /64, which one
// person can rotate through) is plenty for a human; past 30 a minute in
// total, any address with a wrong guess waits (guessing spread out).
const attempts = new Map();
let allFails = [];
function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  attempts.set(ip, recent);
  allFails = allFails.filter((t) => now - t < 60_000);
  // The overall cap only stops addresses already getting it wrong, so a
  // flood elsewhere never locks out staff typing the right password.
  if (allFails.length >= 30 && recent.length > 0) {
    console.warn("[staff] many wrong passwords in the last minute (from several addresses)");
    return true;
  }
  return recent.length >= 5;
}
function failedAttempt(ip) {
  attempts.get(ip)?.push(Date.now());
  allFails.push(Date.now());
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (!v.some((t) => now - t < 60_000)) attempts.delete(k);
}, 60_000).unref();

function sameText(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── routes ───────────────────────────────────────────────────────────────

export function router(slug) {
  const r = express.Router();
  const dir = config.eventDir(slug);
  const eventFile = path.join(dir, "event.yaml");
  // Staff see the whole roster; the AI only ever gets fromCsv().people.
  const readPeople = roster.read;
  const writePeople = roster.write;

  r.post("/login", express.json({ limit: "2kb" }), (req, res) => {
    if (!PASSWORD) return res.status(503).json({ error: "STAFF_PASSWORD is not set in .env — the staff page is off" });
    const ip = ipKey(req.ip);
    if (tooManyAttempts(ip)) return res.status(429).json({ error: "too many attempts — wait a minute" });
    if (!sameText(String(req.body?.password ?? ""), PASSWORD)) {
      failedAttempt(ip);
      return res.status(401).json({ error: "wrong password" });
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, Date.now() + 86_400_000);
    res.set("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${req.secure ? "; Secure" : ""}`).json({ ok: true });
  });

  r.post("/logout", (req, res) => {
    sessions.delete(cookieValue(req));
    res.set("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0`).json({ ok: true });
  });

  r.use(requireStaff);

  // Changes only from this site's own pages. The SameSite cookie already
  // covers it on *.onrender.com; on a custom domain a sibling subdomain
  // counts as "same site", so check the Origin too.
  r.use((req, res, next) => {
    if (["GET", "HEAD"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}` && origin !== (process.env.PUBLIC_URL || "").replace(/\/$/, "")) {
      return res.status(403).json({ error: "wrong origin" });
    }
    next();
  });

  r.get("/state", async (_req, res, next) => {
    try {
      const cfg = config.get();
      const doc = parseDocument(fs.readFileSync(eventFile, "utf8"));
      res.json({
        event: loc(cfg.event.name),
        persona: cfg.persona.name,
        sections: SECTIONS.map((s) => ({ ...s, value: flatValue(doc.getIn(s.path, false)?.toJSON?.() ?? doc.getIn(s.path) ?? null) })),
        attendees: readPeople(),
        mock: roster.mockCount(),
        status: config.status(),
        stats: stats.get(),
        phase: phase.get(),
        // A clear / reset that can still be undone (when it happened).
        undo: {
          checkins: (() => { try { return JSON.parse(fs.readFileSync(checkinBackup(), "utf8")).at; } catch { return null; } })(),
          stats: stats.resetBackupAt(),
        },
        perxona: await perxona.check(),
        llm: llm.status(),
      });
    } catch (err) {
      next(err);
    }
  });

  r.put("/section/:key", express.json({ limit: "64kb" }), (req, res) => {
    const section = SECTIONS.find((s) => s.key === req.params.key);
    if (!section) return res.status(404).json({ error: "unknown section" });
    const v = req.body?.value;
    let value;
    if (section.kind === "fields") {
      if (!v || typeof v !== "object") return res.status(400).json({ error: "expected an object" });
      value = Object.fromEntries(section.fields.map((f) => [f.key, clean(v[f.key])]).filter(([, x]) => x));
    } else if (section.kind === "strings") {
      if (!Array.isArray(v)) return res.status(400).json({ error: "expected a list" });
      value = v.map((x) => clean(x)).filter(Boolean);
    } else {
      if (!Array.isArray(v)) return res.status(400).json({ error: "expected a list" });
      value = v
        .map((item) => Object.fromEntries(section.fields.map((f) => [f.key, clean(item?.[f.key])]).filter(([, x]) => x)))
        .filter((item) => Object.keys(item).length);
    }

    const doc = parseDocument(fs.readFileSync(eventFile, "utf8"));
    const was = doc.getIn(section.path, false)?.toJSON?.() ?? doc.getIn(section.path) ?? null;
    if (section.kind === "fields") {
      // Merge so fields we don't edit here (name, address…) survive.
      for (const f of section.fields) {
        if (unchanged(was?.[f.key], value[f.key])) continue;
        if (value[f.key]) doc.setIn([...section.path, f.key], value[f.key]);
        else doc.deleteIn([...section.path, f.key]);
      }
    } else if (section.kind === "list") {
      const old = Array.isArray(was) ? [...was] : [];
      const merged = value.map((item) => {
        const i = old.findIndex((o) => o && (section.match ?? []).some((k) => item[k] && clean(flat(o[k])) === item[k]));
        return mergeItem(section, i >= 0 ? old.splice(i, 1)[0] : null, item);
      });
      doc.setIn(section.path, doc.createNode(merged));
    } else {
      doc.setIn(section.path, doc.createNode(value.map((x, i) => (unchanged(was?.[i], x) ? was[i] : x))));
    }
    if (doc.errors.length) return res.status(500).json({ error: String(doc.errors[0]) });
    writeAtomic(eventFile, doc.toString());
    config.load(slug);
    const st = config.status();
    if (st.error) return res.status(500).json({ error: st.error });
    res.json({ ok: true, status: st });
  });

  // Add or edit one person. Walk-ins arrive with consent and here ticked.
  r.post("/attendees", express.json({ limit: "8kb" }), (req, res) => {
    const b = req.body ?? {};
    const people = readPeople();
    const before = people.find((p) => p.id === b.replaces);
    const row = readRows(toCsv([{
      name: b.name, role: b.role ?? before?.role, building: b.building, looking_for: b.looking_for,
      linkedin: b.linkedin, link: b.link ?? before?.link, source: before?.source || "walk-in",
      consent: isConsent(String(b.consent ?? "")), here: b.here === undefined ? before?.here ?? true : isConsent(String(b.here)),
      checkin: before?.checkin || "staff",
    }])).rows[0];
    if (row && !row.here) row.checkin = "";
    if (!row) return res.status(400).json({ error: "name is required" });
    // Their name / answers in other languages (name_en…): kept for each field staff didn't change.
    for (const [k, v] of Object.entries(before ?? {})) {
      const base = k.match(/^(name|role|building|looking_for)_(en|zh|ja)$/)?.[1];
      if (base && row[base] === before[base]) row[k] = v;
    }
    const next = people.filter((p) => p.id !== row.id && p.id !== b.replaces);
    next.push(row);
    writePeople(next);
    res.json({ ok: true, person: row });
  });

  // The check-in ticks: { here?: bool, consent?: bool }.
  r.patch("/attendees/:id", express.json({ limit: "1kb" }), (req, res) => {
    const people = readPeople();
    const p = people.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "not found" });
    if (typeof req.body?.here === "boolean") {
      p.here = req.body.here;
      p.checkin = p.here ? p.checkin || "staff" : "";
    }
    if (typeof req.body?.consent === "boolean") p.consent = req.body.consent;
    writePeople(people);
    res.json({ ok: true, person: p });
  });

  // After rehearsal, before doors open: everyone back to "not here, not
  // introducible" (test check-ins and test consents gone). Names stay.
  // Saved before "clear all check-ins", so a mis-press can be undone.
  const checkinBackup = () => path.join(process.env.DATA_DIR || path.resolve(import.meta.dirname, ".."), "checkins.before-clear.json");
  r.post("/attendees/reset-checkins", (_req, res) => {
    const people = readPeople();
    fs.writeFileSync(checkinBackup(), JSON.stringify({ at: new Date().toISOString(), people: people.map(({ id, here, consent, checkin }) => ({ id, here, consent, checkin })) }));
    for (const p of people) Object.assign(p, { here: false, consent: false, checkin: "" });
    writePeople(people);
    res.json({ ok: true, total: people.length });
  });

  // Undo the last clear: everyone who was checked in / introducible then is
  // again (anyone who checked in since stays checked in).
  r.post("/attendees/undo-reset-checkins", (_req, res) => {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(checkinBackup(), "utf8")); } catch { return res.status(404).json({ error: "nothing to undo" }); }
    const before = new Map(saved.people.map((p) => [p.id, p]));
    const people = readPeople();
    let n = 0;
    for (const p of people) {
      const b = before.get(p.id);
      if (!b || p.here) continue;
      Object.assign(p, { here: b.here, consent: b.consent, checkin: b.checkin });
      if (b.here || b.consent) n++;
    }
    writePeople(people);
    fs.rmSync(checkinBackup(), { force: true });
    res.json({ ok: true, restored: n });
  });

  r.delete("/attendees/:id", (req, res) => {
    const people = readPeople();
    const next = people.filter((p) => p.id !== req.params.id);
    if (next.length === people.length) return res.status(404).json({ error: "not found" });
    writePeople(next);
    res.json({ ok: true });
  });

  // "The event is over": thank-you screen at the door, check-in closes,
  // Maker stays 48 h for those who came. Undo if pressed by mistake.
  r.post("/phase/end", (_req, res) => res.json(phase.end()));
  r.post("/phase/undo", (_req, res) => res.json(phase.undo()));

  r.post("/stats/reset", (_req, res) => {
    stats.reset();
    res.json({ ok: true, stats: stats.get() });
  });
  r.post("/stats/undo-reset", (_req, res) => {
    try { stats.undoReset(); } catch { return res.status(404).json({ error: "nothing to undo" }); }
    res.json({ ok: true, stats: stats.get() });
  });

  // Body is a CSV export as text: either the registration list (Luma —
  // adds people, consent untouched) or the opt-in form (marks consent).
  r.post("/import", express.text({ type: "*/*", limit: "2mb" }), (req, res) => {
    const text = String(req.body ?? "");
    const header = (parseCsv(text)[0] ?? []).join(",").toLowerCase();
    // A roster CSV of our own format has a consent column too,
    // but it's a roster, not form answers: it has "here".
    const fromForm = /consent|同意/.test(header) && !/approval_status/.test(header) && !/(^|,)here(,|$)/.test(header);
    const { rows, problems } = readRows(text, { source: fromForm ? "form" : "luma" });
    if (problems.length) return res.status(400).json({ error: problems.join("; ") });
    // ?replace=1: the real list replaces whatever is there (e.g. the practice roster).
    const result = req.query.replace === "1" ? { rows, added: rows.length, updated: 0 } : merge(readPeople(), rows, { fromForm });
    writePeople(result.rows);
    res.json({
      ok: true, kind: fromForm ? "form" : "roster",
      read: rows.length, consented: fromForm ? rows.filter((p) => p.consent).length : 0,
      added: result.added, updated: result.updated, total: result.rows.length,
    });
  });

  // After the event: who came (and how they checked in), who agreed to be introduced.
  r.get("/attendance.csv", (_req, res) => {
    const rows = readPeople().filter((p) => p.here);
    // A cell starting with = + - @ runs as a formula in Excel / Sheets: names
    // and roles are typed by attendees, so make those plain text.
    const esc = (v) => {
      const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const via = { luma: "Luma", ait: "partner page", both: "Luma + partner page", "walk-in": "added on site" };
    const csv = ["name,role,registered_via,checkin,introduced", ...rows.map((p) => [p.name, p.role, via[p.source] ?? p.source, p.checkin, p.consent ? "yes" : "no"].map((v) => esc(String(v ?? ""))).join(","))].join("\n");
    res.set("Content-Disposition", 'attachment; filename="attendance.csv"').type("text/csv").send("\ufeff" + csv + "\n");
  });

  return r;
}
