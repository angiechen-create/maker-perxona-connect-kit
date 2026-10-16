// Anonymous counters for the post-mortem. Never anything a visitor said, and
// never who was recommended to whom — just how many times things happened.
// Written to stats/<slug>.json (git-ignored) so a restart doesn't lose them.

import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "stats") : path.resolve(import.meta.dirname, "..", "stats");
let file = null;
let counts = null;
let dirty = false;

const empty = () => ({
  since: new Date().toISOString(),
  questions: 0,
  languages: { zh: 0, en: 0, ja: 0 },
  peopleIntroduced: 0, // cards shown, summed
  answersWithIntroductions: 0,
  tableRecommendations: 0,
  fallbacks: { busy: 0, down: 0 },
  visits: 0, // taps on "start"
  // Maker's voice: lines spoken with ElevenLabs, and lines that fell back to
  // Perxona's built-in voice (a different-sounding voice), by reason.
  voice: { eleven: 0, fallback: 0, reasons: {} },
  // Topic table interest after check-in: device → table (latest pick wins).
  interest: {},
  // Phones that opened Maker from a printed / on-screen QR: device → where
  // (e.g. "door"), so a phone scanning twice counts once.
  scans: {},
});

export function init(slug) {
  file = path.join(DIR, `${slug}.json`);
  try {
    counts = { ...empty(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    counts = empty();
  }
  setInterval(flush, 15_000).unref();
  process.on("SIGINT", () => { flush(); process.exit(0); });
  process.on("SIGTERM", () => { flush(); process.exit(0); });
}

function flush() {
  if (!dirty) return;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(counts, null, 2));
  dirty = false;
}

export function recordAnswer(out) {
  counts.questions++;
  if (counts.languages[out.lang] !== undefined) counts.languages[out.lang]++;
  if (out.fallback) counts.fallbacks[out.fallback]++;
  if (out.people?.length) {
    counts.answersWithIntroductions++;
    counts.peopleIntroduced += out.people.length;
  }
  if (out.tables?.length) counts.tableRecommendations++;
  dirty = true;
}

export function recordVoice(ok, reason = "") {
  counts.voice ??= { eleven: 0, fallback: 0, reasons: {} };
  if (ok) counts.voice.eleven++;
  else {
    counts.voice.fallback++;
    const r = String(reason).slice(0, 60) || "unknown";
    counts.voice.reasons[r] = (counts.voice.reasons[r] ?? 0) + 1;
  }
  dirty = true;
}

// Per-phone maps (one vote, one scan each) are capped: a script inventing
// device ids mustn't grow them forever.
const MAX_DEVICES = 5000;
const full = (map) => Object.keys(map).length >= MAX_DEVICES;

export function recordInterest(device, table) {
  counts.interest ??= {};
  if (full(counts.interest) && !(String(device).slice(0, 64) in counts.interest)) return;
  counts.interest[String(device).slice(0, 64)] = table;
  dirty = true;
}

/** { "1": 4, "2": 3, …, unsure: 1 } */
export const interestCounts = () => Object.values(counts.interest ?? {}).reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});

export function recordScan(device, src) {
  counts.scans ??= {};
  const key = String(device).slice(0, 64);
  if (counts.scans[key] || full(counts.scans)) return;
  counts.scans[key] = src;
  dirty = true;
}

/** { door: 31, … } */
export const scanCounts = () => Object.values(counts.scans ?? {}).reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});

// What people tap on the phone (counts only): the quick buttons, cards'
// LinkedIn / site buttons, page links. To see whether Maker gets used.
export const TAPS = ["agenda", "demos", "tables", "match", "linkedin", "site", "official", "photos", "program"];
export function recordTap(what) {
  if (!TAPS.includes(what)) return;
  counts.taps ??= {};
  counts.taps[what] = (counts.taps[what] ?? 0) + 1;
  dirty = true;
}

export function recordVisit() {
  counts.visits++;
  dirty = true;
}

// Never hand out the device ids, only the tally.
export const get = () => ({ ...counts, interest: interestCounts(), scans: scanCounts() });

/** Before doors open: rehearsal questions shouldn't count toward the night. */
// The counts as they were before the last reset, so a mis-press can be undone.
const backupFile = () => `${file}.before-reset`;

export function reset() {
  flush();
  try { fs.writeFileSync(backupFile(), JSON.stringify({ at: new Date().toISOString(), counts }, null, 2)); } catch {}
  counts = empty();
  dirty = true;
  flush();
}

/** When the last reset happened, if it can still be undone. */
export function resetBackupAt() {
  try { return JSON.parse(fs.readFileSync(backupFile(), "utf8")).at ?? null; } catch { return null; }
}

/** Undo the last reset (counts made since then are added back on top). */
export function undoReset() {
  const before = JSON.parse(fs.readFileSync(backupFile(), "utf8")).counts;
  const now = counts;
  const add = (a, b) => (typeof a === "number" ? a + (b ?? 0) : a);
  counts = { ...before };
  for (const k of ["questions", "peopleIntroduced", "answersWithIntroductions", "tableRecommendations", "visits"]) counts[k] = add(before[k] ?? 0, now[k]);
  counts.interest = { ...(before.interest ?? {}), ...(now.interest ?? {}) };
  counts.scans = { ...(before.scans ?? {}), ...(now.scans ?? {}) };
  fs.rmSync(backupFile(), { force: true });
  dirty = true;
  flush();
}
