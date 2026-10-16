// Self check-in on the visitor's phone, then one consent question.
//
//   POST /api/checkin  { name | pick }  → checked in (here = yes), or not found
//   POST /api/consent  { token, yes }   → may Maker introduce them to others?
//
// Only people on the organiser-approved roster can check in: there is no
// walk-in and no way to add yourself or write yourself into the pool. Maker
// only talks to a phone holding the token of someone on the roster who is
// checked in (visitor()) — everyone else stays on the check-in screen.
//
// The roster is never listed or hinted at: only a full-name match checks
// someone in (attendees.matchName), and failed attempts are rate-limited.
// Being on the roster is not consent — that is only ever the button.

import crypto from "node:crypto";
import express from "express";
import * as config from "./config.mjs";
import * as roster from "./roster.mjs";
import * as tts from "./tts.mjs";
import * as phase from "./phase.mjs";
import * as quota from "./quota.mjs";
import * as staff from "./staff.mjs";
import { matchName, maskedName, personIn } from "./attendees.mjs";
import { LANGS, loc } from "./i18n.mjs";
import { mac } from "./secret.mjs";

// Signs the token a phone keeps after check-in: proof it checked in as `id`,
// at this event (a token from an earlier event on the same server doesn't carry over).
const slug = () => config.get()?.slug ?? "";
const sign = (id) => `${id}.${mac(`tok:${slug()}:${id}`)}`;
// After the event, getting back in needs no door code (there is no door any
// more), only the full name. Such a "late" token works for the program and
// questions, but Maker isn't told that guest's own registration or anyone
// else's (no attendee introductions).
const signLate = (id) => `${id}.L${mac(`late:${slug()}:${id}`, 23)}`;
// A choice offered on screen ("Alex L."): proves the server offered it, without exposing ids.
const signPick = (id) => `${id}.${mac(`pick:${slug()}:${id}`)}`;

// ── Door codes: you have to be at the venue to check in ─────────────────
// The QR on the entrance screen (signed in as staff) carries a code that
// changes every 2 minutes, and check-in needs a code from the last ~10
// minutes. Knowing someone's name from a public guest list isn't enough to
// check in as them, or to say yes to introductions in their name, from home.
// event.yaml `checkin: { anywhere: true }` turns this off (a small meetup
// with no entrance screen); the demo doesn't use names at all.
const DOOR_WINDOW = 120_000;
const doorCode = (w) => mac(`door:${slug()}:${w}`, 12);
export const currentDoorCode = () => doorCode(Math.floor(Date.now() / DOOR_WINDOW));
function validDoor(code) {
  const now = Math.floor(Date.now() / DOOR_WINDOW);
  const c = String(code ?? "");
  for (let w = now; w > now - 5; w--) {
    const good = doorCode(w);
    if (c.length === good.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(good))) return true;
  }
  return false;
}
export const doorRequired = (event) => !config.isDemo(event) && event?.checkin?.anywhere !== true;
function verifyPick(token) {
  const [id, mac] = String(token ?? "").split(".");
  if (!id || !mac) return null;
  const good = signPick(id).split(".")[1];
  return mac.length === good.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good)) ? id : null;
}
/** Up to 6 masked choices; identical labels get their role to tell them apart. */
function choices(people, typed) {
  const list = people.slice(0, 6).map((p) => ({ pick: signPick(p.id), label: maskedName(p, typed), role: p.role }));
  const seen = {};
  for (const c of list) seen[c.label] = (seen[c.label] ?? 0) + 1;
  return list.map((c) => ({ pick: c.pick, label: seen[c.label] > 1 && c.role ? `${c.label} · ${c.role}` : c.label }));
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** { id, late } for a genuine token, else null. */
export function verify(token) {
  const [id, sig] = String(token ?? "").split(".");
  if (!id || !sig) return null;
  if (same(sig, sign(id).split(".")[1])) return { id, late: false };
  if (same(sig, signLate(id).split(".")[1])) return { id, late: true };
  return null;
}
/** The roster row for a phone's token, or null — also null once staff undo the check-in. */
export const visitor = (token) => {
  const v = verify(token);
  const p = v ? roster.read().find((x) => x.id === v.id) : null;
  return p?.here ? { ...p, late: v.late } : null;
};

const firstName = (name) => {
  const latin = String(name).match(/[A-Za-z][A-Za-z'-]*/);
  if (latin) return latin[0];
  const cjk = String(name).match(/[㐀-鿿]+/)?.[0] ?? name;
  return cjk.length === 3 ? cjk.slice(1) : cjk; // 林小安 → 小安
};

/**
 * Their first name as each language writes it: from name_en / name_zh /
 * name_ja when the roster has them (林小雨 → Rain in English), and for a
 * demo guest, the short name event.yaml gives them.
 */
function firstNames(p) {
  const guest = config.isDemo(config.get()?.event) ? (config.get().event.demo.guests ?? []).find((g) => g?.name === p.name) : null;
  return Object.fromEntries(LANGS.map((l) => [l, (guest?.short && loc(guest.short, l)) || firstName(personIn(p, l).name)]));
}

const LINES = {
  checkedIn: {
    en: (n) => `You're checked in, ${n}! Can I introduce you to other people tonight? I'd only share what you wrote when you registered.`,
    zh: (n) => `${n}，報到完成！今晚我可以把你介紹給其他人嗎？我只會分享你報名時寫的內容。`,
    ja: (n) => `${n}さん、チェックイン完了！今夜、ほかの参加者にあなたを紹介してもいい？登録時に書いた内容だけを伝えるよ。`,
  },
  // Back after the event (no consent question: that was for the night itself).
  back: {
    en: (n) => `Welcome back, ${n}! Want to find a speaker or someone you met?`,
    zh: (n) => `${n}，歡迎回來！想找哪位講者或認識的人嗎？`,
    ja: (n) => `${n}さん、おかえり！講演者や会った人を探す？`,
  },
  yes: { en: "Great! Let me find people for you.", zh: "太好了！我來幫你找人。", ja: "やった！あなたに合う人を探すね。" },
  // Demo: the visitor plays a made-up guest. Nothing is asked or saved.
  demo: {
    en: (who) => `Hey hey, welcome to Builders Night! You're now ${who}: a made-up guest at a made-up event. Tap “Match me” and I'll find people for you!`,
    zh: (who) => `嗨嗨，歡迎來到 Builders Night！你現在是「${who}」，一位虛構的賓客。點「幫我配對」，我馬上幫你找人！`,
    ja: (who) => `やっほー、Builders Night へようこそ！あなたは今、架空のゲスト「${who}」だよ。「マッチして」を押したら、会うべき人を探すね！`,
  },
  // Said no: no matching. Show them around the evening instead.
  no: {
    en: "No problem! There are live demos and topic tables tonight. What would you like to see first?",
    zh: "沒問題！今晚有現場 Demo 和主題桌，想先看哪個？",
    ja: "大丈夫！今夜はライブデモとテーマ卓があるよ。どれから見る？",
  },
};
const say = (key, lang, name) => {
  const l = LINES[key][lang] ?? LINES[key].en;
  const line = typeof l === "function" ? l(name) : l;
  tts.allow(line); // Maker may speak it
  return line;
};

// Every name lookup counts, found or not (typing names to probe the list):
// 8 per phone and 60 per address in 10 minutes. Per phone first, so one
// prankster on the venue Wi-Fi can't lock everyone else out.
const tries = new Map(); // "d:<device>" or "ip:<address>" → [timestamps]
const recentTries = (k) => (tries.get(k) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
const keysFor = (req) => [`d:${quota.cleanDevice(req.get("x-device")) ?? "none"}`, `ip:${quota.ipKey(req.ip)}`];
// With a valid door code the phone is at the venue, where everyone shares
// one Wi-Fi address: then only the per-phone limit applies (doors-open
// would hit 60 lookups per address in minutes).
const tooMany = (req, atVenue) => {
  const [d, ip] = keysFor(req);
  return recentTries(d).length >= 8 || (!atVenue && recentTries(ip).length >= 60);
};
function tried(req) {
  for (const k of keysFor(req)) tries.set(k, [...recentTries(k), Date.now()]);
  if (tries.size > 10_000) for (const [k] of tries) if (!recentTries(k).length) tries.delete(k);
}

const clock = () => new Intl.DateTimeFormat("en-GB", { timeZone: config.get()?.event?.timezone || "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export { firstName, firstNames };

export function router() {
  const r = express.Router();
  // Per route: this router is mounted on /api, so r.use() here would also cap
  // /api/ask's body at 2 KB (a few Chinese turns) and every question would fail.
  const json = express.json({ limit: "2kb" });

  r.post("/checkin", json, (req, res) => {
    // The demo has no real roster to find a name on: it's "try as" only.
    if (config.isDemo(config.get().event)) return res.json({ found: false });
    const now = phase.get().phase;
    if (now === "closed") return res.status(410).json({ error: "closed", closed: true });
    const name = String(req.body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const lang = ["en", "zh", "ja"].includes(req.body?.lang) ? req.body.lang : "en";
    const pickId = verifyPick(req.body?.pick);
    if (!pickId && name.length < 2) return res.status(400).json({ error: "name" });
    // At the venue: a code from the entrance screen's QR. (After the event,
    // people who came can get back in from anywhere; see below.)
    const atVenue = validDoor(req.body?.door);
    if (now === "live" && doorRequired(config.get().event) && !atVenue && !staff.isStaff(req)) {
      return res.json({ needDoor: true });
    }
    if (tooMany(req, atVenue)) return res.status(429).json({ error: "too many tries", tooMany: true });
    tried(req);

    const people = roster.read();
    let found = pickId ? people.filter((p) => p.id === pickId) : matchName(people, name);
    // Same full name twice: masked choices to pick from. Each lookup counts
    // as a try (probing).
    if (!pickId && found.length > 1) {
      return res.json({ choices: choices(found, name) });
    }
    // Only a first name typed: no guessing who it is (anyone could check in
    // as "David" and answer for him). The page asks for the full name.
    if (!found.length) {
      return res.json({ found: false });
    }
    // After the event only people who came can get back in (a lost phone
    // session); nobody new checks in.
    if (now === "after" && !found[0].here) return res.json({ ended: true });
    const p = roster.update(found[0].id, (x) => {
      if (!x.here) x.checkin = `self ${clock()}`;
      x.here = true;
    });
    console.log("[checkin] roster"); // never the name
    // The first name only: a full name is never handed out for a typed one.
    res.json({
      ok: true,
      token: now === "live" ? sign(p.id) : signLate(p.id),
      name: firstName(p.name),
      first: firstName(p.name),
      firsts: firstNames(p),
      consent: p.consent,
      late: now !== "live",
      say: say(now === "live" ? "checkedIn" : "back", lang, firstNames(p)[lang]),
    });
  });

  // Demo: "try as <made-up guest>". Only the guests event.yaml offers, and
  // the roster is never written: everyone trying the demo shares these rows.
  r.post("/demo-checkin", json, (req, res) => {
    const { event } = config.get();
    if (!config.isDemo(event)) return res.sendStatus(404);
    const lang = ["en", "zh", "ja"].includes(req.body?.lang) ? req.body.lang : "en";
    const guest = (event.demo.guests ?? [])[Number(req.body?.guest)];
    const p = guest && roster.read().find((x) => x.name === guest.name && x.here);
    if (!p) return res.status(400).json({ error: "guest" });
    const first = firstName(p.name);
    const line = say("demo", lang, guest.label?.[lang] ?? guest.label?.en ?? first);
    tts.allowAlways([line]); // everyone who picks this guest hears the same welcome
    res.json({ ok: true, token: sign(p.id), name: p.name, first, firsts: firstNames(p), consent: true, demo: true, say: line });
  });

  r.post("/consent", json, (req, res) => {
    if (phase.get().phase === "closed") return res.status(410).json({ error: "closed", closed: true });
    // Saying yes (or no) to introductions happens at the venue, during the event.
    if (phase.get().phase !== "live") return res.status(409).json({ error: "the event is over" });
    const id = visitor(req.body?.token)?.id;
    if (!id) return res.status(401).json({ error: "not checked in" });
    if (config.isDemo(config.get().event)) return res.status(409).json({ error: "demo guests can't change their answers" });
    const yes = req.body?.yes === true;
    const p = roster.update(id, (x) => (x.consent = yes));
    if (!p) return res.status(404).json({ error: "not on the roster any more" });
    const lang = ["en", "zh", "ja"].includes(req.body?.lang) ? req.body.lang : "en";
    res.json({ ok: true, consent: p.consent, say: say(yes ? "yes" : "no", lang) });
  });

  return r;
}
