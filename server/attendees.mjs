// The event roster: events/<slug>/attendees.csv (git-ignored).
//
// The file holds everyone expected (imported from the registration export),
// with two flags staff tick on the day:
//   consent — the person said yes to being introduced by the concierge
//   here    — they checked in
//
// Privacy rules live here, at load time, so nothing downstream can get them
// wrong:
//   • the AI only ever sees `introducible()` — consent = yes, and once
//     check-in has started, here = yes (so no-shows are never recommended)
//   • only whitelisted columns are read — an email or phone column in any
//     import is never loaded, and email/phone-looking text inside answers is
//     scrubbed
//   • LinkedIn is kept only if it really is a linkedin.com URL; other links
//     only if they are http(s). Both become QR codes on screen.

import { mac } from "./secret.mjs";
import { LANGS } from "./i18n.mjs";

// Header aliases, matched case-insensitively as substrings, in priority order.
// Covers our own CSV, the Google Form export and the Luma guest export.
const COLUMNS = {
  name: ["name", "名字", "姓名", "名前"],
  role: ["role", "describes you", "最符合"],
  building: ["building", "built or shipped", "在做什麼", "在做", "working on", "作っている"],
  looking_for: ["looking_for", "looking for", "talk about", "想認識", "想聊", "meet", "話したい"],
  linkedin: ["linkedin"],
  link: ["link"], // never a LinkedIn column — see findColumns
  consent: ["consent", "同意", "agree"],
  here: ["here", "checked_in", "到場"],
  checkin: ["checkin"], // how/when: "self 18:12" (on their phone), "staff", or empty
  aliases: ["aliases"], // other names they registered under (check-in matches these too)
  event_role: ["event_role"], // tonight: "Demo speaker", "Topic table host"…
  source: ["source"],
  status: ["approval_status"],
};

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, newlines in quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

function findColumns(header) {
  const h = header.map((x) => x.toLowerCase());
  const exact = (k) => h.findIndex((col) => col.trim() === k);
  const out = {};
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    // Our own files use the exact key; prefer that over a fuzzy match.
    out[key] = exact(key);
    if (out[key] >= 0 || key === "source") continue; // "utm_source" is not ours
    out[key] = h.findIndex(
      (col) =>
        aliases.some((a) => col.includes(a.toLowerCase())) &&
        // "LinkedIn URL" contains "link"; a generic link column must not take it.
        !(key === "link" && col.includes("linkedin")) &&
        // Luma's "name" column also appears inside "first_name"/"last_name".
        !(key === "name" && /first_name|last_name/.test(col)),
    );
  }
  return out;
}

// The answers a person shows on screen, optionally once per language:
// name_en / name_zh / name_ja next to name, and so on. Matched by exact
// header only (a fuzzy "name" match must not take name_en). The plain column
// stays the default; these only add translations.
const LOCALISED = { name: 60, role: 60, building: 240, looking_for: 240 };
const LOCALISED_COLUMNS = Object.keys(LOCALISED).flatMap((k) => LANGS.map((l) => `${k}_${l}`));

const NO = /\b(no|not|false|n|0)\b|不|否|いいえ|しない/i;
const YES = /\b(yes|true|y|1)\b|是|同意|好|はい|agree/i;
export const isConsent = (v) => !!v && !NO.test(v.trim()) && YES.test(v.trim());

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(\+?\d[\d\s-]{7,}\d)/g;
const scrub = (s, max = 240) => (s ?? "").replace(EMAIL, "[removed]").replace(PHONE, "[removed]").replace(/\s+/g, " ").trim().slice(0, max);

function cleanUrl(raw, { linkedinOnly = false } = {}) {
  // People paste sentences: "My app: https://…". Take the first URL, or a bare domain.
  const text = String(raw ?? "").trim();
  if (!text || /^(n\/?a|none|-)$/i.test(text)) return "";
  const found = text.match(/https?:\/\/[^\s，、)）]+/i)?.[0] ?? text.match(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/)?.[0];
  if (!found) return "";
  try {
    const u = new URL(found.startsWith("http") ? found : `https://${found}`);
    if (!/^https?:$/.test(u.protocol)) return "";
    if (linkedinOnly && !/(^|\.)linkedin\.com$/i.test(u.hostname)) return "";
    if (!linkedinOnly && /(^|\.)linkedin\.com$/i.test(u.hostname)) return "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * Stable across reloads, imports and edits of the answers, and meaningless
 * on its own: keyed with the server secret, so an id seen on a card or in a
 * token can't be matched back to a name by hashing guesses.
 */
export const normName = (name) => String(name ?? "").toLowerCase().replace(/[\s()（）._-]+/g, "");
export const idFor = (name) => "p" + mac(`id:${normName(name)}`, 10);

/**
 * Every row of a roster-shaped CSV, normalised.
 * @param defaults applied when a column is absent (e.g. a form export implies consent)
 */
export function readRows(text, defaults = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], problems: [], header: [] };
  const col = findColumns(rows[0]);
  const exactCol = Object.fromEntries(LOCALISED_COLUMNS.map((k) => [k, rows[0].findIndex((h) => h.trim().toLowerCase() === k)]).filter(([, i]) => i >= 0));
  const problems = [];
  if (col.name < 0) problems.push("no name column");
  const out = [];
  for (const r of rows.slice(1)) {
    const get = (k) => (col[k] >= 0 ? r[col[k]] ?? "" : "");
    const name = scrub(get("name"), 60);
    if (!name) continue;
    if (col.status >= 0 && get("status").trim() !== "approved") continue; // Luma: approved guests only
    out.push({
      id: idFor(name),
      name,
      role: scrub(get("role").split(/[｜|]/)[0], 60),
      building: scrub(get("building")),
      looking_for: scrub(get("looking_for")),
      linkedin: cleanUrl(get("linkedin"), { linkedinOnly: true }),
      link: cleanUrl(get("link")),
      source: scrub(get("source"), 20) || defaults.source || "",
      consent: col.consent >= 0 ? isConsent(get("consent")) : !!defaults.consent,
      // Ours says yes/no; Luma's checked_in_at holds a timestamp.
      here: col.here >= 0 ? isConsent(get("here")) || /\d{4}-\d{2}-\d{2}/.test(get("here")) : !!defaults.here,
      checkin: scrub(get("checkin"), 40),
      aliases: scrub(get("aliases"), 120),
      event_role: scrub(get("event_role"), 60),
      ...Object.fromEntries(Object.entries(exactCol).map(([k, i]) => {
        const base = k.replace(/_(en|zh|ja)$/, "");
        const v = String(r[i] ?? "");
        return [k, scrub(base === "role" ? v.split(/[｜|]/)[0] : v, LOCALISED[base])];
      }).filter(([, v]) => v)),
    });
  }
  return { rows: out, problems, header: rows[0] };
}

/** Who the AI may introduce: consented, and present once check-in has begun. */
export function introducible(rows) {
  const consented = rows.filter((p) => p.consent);
  return rows.some((p) => p.here) ? consented.filter((p) => p.here) : consented;
}

/** The roster file as the server uses it. */
export function fromCsv(text) {
  const { rows, problems } = readRows(text);
  const people = introducible(rows);
  return { all: rows, people, skipped: rows.length - people.length, problems };
}

/**
 * Merge an import into the roster, matching people by name.
 *   roster export (Luma)  → adds people; never touches consent/here already set
 *   opt-in form           → sets consent = yes and takes their fresh answers
 */
export function merge(existing, incoming, { fromForm = false } = {}) {
  const byId = new Map(existing.map((p) => [p.id, { ...p }]));
  let added = 0, updated = 0;
  for (const p of incoming) {
    const cur = byId.get(p.id);
    if (!cur) {
      byId.set(p.id, { ...p, consent: fromForm ? p.consent : false, here: false });
      added++;
      continue;
    }
    // Fill gaps from the import; a form answer (written for this purpose) wins.
    for (const k of ["role", "building", "looking_for", "linkedin", "link", "aliases", "event_role", ...LOCALISED_COLUMNS]) {
      if (p[k] && (fromForm || !cur[k])) cur[k] = p[k];
    }
    if (fromForm && p.consent) cur.consent = true;
    // Where they registered (Luma / a partner's page / both): the roster is the truth.
    if (!fromForm && ["luma", "ait", "both"].includes(p.source)) cur.source = p.source;
    updated++;
  }
  return { rows: [...byId.values()], added, updated };
}

const HEADER = ["name", "role", "building", "looking_for", "linkedin", "link", "source", "consent", "here", "checkin", "aliases", "event_role"];
const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The canonical attendees.csv. These columns, nothing else — no email, no
 * phone. The per-language columns only when someone has one, so a roster
 * without translations keeps its usual shape.
 */
export function toCsv(rows) {
  const header = [...HEADER, ...LOCALISED_COLUMNS.filter((k) => rows.some((p) => p[k]))];
  return [
    header.join(","),
    ...rows.map((p) =>
      header.map((k) => (k === "consent" || k === "here" ? (p[k] ? "yes" : "no") : esc(String(p[k] ?? "")))).join(","),
    ),
  ].join("\n") + "\n";
}

/**
 * A person's on-screen fields in one language: that language's column, else
 * the plain one, else any other language's (the same fallback as i18n.loc).
 */
export function personIn(p, lang) {
  const out = {};
  for (const k of Object.keys(LOCALISED)) {
    out[k] = [p[`${k}_${lang}`], p[k], ...LANGS.map((l) => p[`${k}_${l}`])].find((v) => v && String(v).trim()) ?? "";
  }
  return out;
}

/** "張雅婷 (en: Ya-Ting Chang · ja: 張雅婷)": the name as written in each language, for Maker. */
export function namesLine(p) {
  const other = LANGS.filter((l) => p[`name_${l}`] && p[`name_${l}`] !== p.name).map((l) => `${l}: ${p[`name_${l}`]}`);
  return other.length ? `${p.name} (${other.join(" · ")})` : p.name;
}

/**
 * Self check-in: who typed this name? Only a full-name match counts (any
 * order, any spacing or case; or the whole Chinese / whole Latin part of a
 * name like "Alex Lin 林小安"). Never a partial or "did you mean", so typing
 * names can't be used to find out who registered.
 * @returns {object[]} the matching rows (0, 1, or several with the same name)
 */
// Their name, any name they registered under (aliases, "|"-separated), and
// their name as written in another language (name_en…).
const namesOf = (p) => [p.name, ...String(p.aliases ?? "").split("|"), ...LANGS.map((l) => p[`name_${l}`] ?? "")].filter((n) => n.trim());

export function matchName(rows, typed) {
  const forms = (name) => {
    const n = String(name ?? "").normalize("NFKC").toLowerCase();
    const latin = n.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    const cjk = (n.match(/[\u3400-\u9fff\u3040-\u30ff]+/g) ?? []).join("");
    const out = new Set([normName(n)]);
    if (latin.length >= 2) out.add("L:" + [...latin].sort().join(" "));
    if (latin.length) out.add("N:" + latin.join("")), out.add("N:" + [...latin].reverse().join(""));
    if (cjk.length >= 2) out.add("C:" + cjk);
    return out;
  };
  const want = forms(typed);
  if (![...want].some((f) => f.length >= 2)) return [];
  // Their name, or any name they registered under (aliases, "|"-separated).
  const names = namesOf;
  return rows.filter((p) => names(p).some((n) => [...forms(n)].some((f) => want.has(f))));
}

const latinOf = (n) => String(n ?? "").normalize("NFKC").replace(/[^A-Za-z\s'-]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
const cjkOf = (n) => (String(n ?? "").normalize("NFKC").match(/[\u3400-\u9fff\u3040-\u30ff]+/g) ?? []).join("");

/** "Alex L." / "林○○": enough for them to recognise themselves, not for others to learn the name. */
export function maskedName(p, typed) {
  const wantLatin = /[A-Za-z]/.test(String(typed ?? ""));
  for (const n of namesOf(p)) {
    const l = latinOf(n);
    const c = cjkOf(n);
    if (wantLatin && l.length) return l.length > 1 ? `${l[0][0].toUpperCase()}${l[0].slice(1)} ${l.at(-1)[0].toUpperCase()}.` : `${l[0][0].toUpperCase()}${l[0].slice(1)}`;
    if (!wantLatin && c.length >= 2) return c[0] + "○".repeat(c.length - 1);
  }
  const l = latinOf(p.name);
  return l.length ? `${l[0]} ${l.length > 1 ? l.at(-1)[0] + "." : ""}`.trim() : "○○○";
}
