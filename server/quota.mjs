// Question limits, so a public URL can't run up the AI bill.
//
// A question is counted BEFORE the AI is asked (reserve), and handed back
// only when nothing was billed (refund). Counting after a good answer let
// every slow, cut-off or refused call through for free, forever.
//
// Layers:
//   per device  — the phone's anonymous id (localStorage). The friendly limit
//                 the page shows as [07/20]; reaching it says "go meet humans".
//   per person  — a real event: the checked-in guest, whichever phone they use.
//   per address — venue Wi-Fi puts every phone behind one IP, so this is
//                 generous; it only stops one script hammering the API.
//                 IPv6 counts per /64 (one household or server gets many).
//   in total    — a ceiling per hour for the whole event, the wallet's last line.
//   at once     — one question per phone at a time, a few for everyone, so a
//                 burst can't slip past the counts before they go up.
//
// The public demo adds two daily caps (event.yaml demo.per_ip_per_day,
// demo.per_day), per calendar day in the event's time zone. Those daily
// counts are saved in DATA_DIR, so a restart doesn't forgive them.

import fs from "node:fs";
import path from "node:path";

const PER_IP_PER_10_MIN = Number(process.env.MAX_QUESTIONS_PER_IP_10MIN || 300);
const TOTAL_PER_HOUR = Number(process.env.MAX_QUESTIONS_PER_HOUR || 1500);
const MAX_AT_ONCE = Number(process.env.MAX_QUESTIONS_AT_ONCE || 16);

const perDevice = new Map(); // deviceId → count
const perPerson = new Map(); // roster id → count (real events)
const recentByIp = new Map(); // ip key → [timestamps]
let recentTotal = []; // timestamps
const busy = new Set(); // deviceIds with a question in flight
const inFlightByIp = new Map(); // ip key → questions in flight
let inFlight = 0;

const prune = (list, ms) => list.filter((t) => Date.now() - t < ms);

/** A device id is whatever the page made up; keep it short and boring. */
export const cleanDevice = (id) => (typeof id === "string" && /^[\w-]{8,64}$/.test(id) ? id : null);

/** One key per IPv4 address, or per IPv6 /64. */
export function ipKey(ip) {
  const a = String(ip ?? "").toLowerCase().replace(/^::ffff:/, "").split("%")[0];
  if (!a.includes(":")) return a;
  // Expand "::" to the missing zero groups, so every spelling of one /64 matches.
  const [left, right = ""] = a.split("::");
  const l = left ? left.split(":") : [];
  const r = a.includes("::") && right ? right.split(":") : [];
  const groups = a.includes("::") ? [...l, ...Array(Math.max(0, 8 - l.length - r.length)).fill("0"), ...r] : l;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function used(deviceId) {
  return deviceId ? perDevice.get(deviceId) ?? 0 : 0;
}

// ── The demo's daily caps, kept on disk ─────────────────────────────────

const file = () => path.join(process.env.DATA_DIR || path.resolve(import.meta.dirname, ".."), "quota-day.json");
let today = { day: "", byIp: {}, total: 0 };
try {
  today = { ...today, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
} catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${file()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(today));
      fs.renameSync(tmp, file());
    } catch (err) {
      console.error(`[quota] couldn't save today's counts: ${err.message}`);
    }
  }, 1000);
}
function rollDay(day) {
  if (today.day !== day) today = { day, byIp: {}, total: 0 };
}

/**
 * Count one question before spending. Returns { ticket } when allowed, or
 * { blocked } with the reason: "device" (friendly), "day" (the demo is done
 * for today), "busy" (one at a time), "ip" / "total" (busy — try again shortly).
 * Then done(ticket) once answered, or refund(ticket) when nothing was billed.
 * @param deviceId required (the caller rejects requests without one)
 * @param personId the checked-in guest at a real event (not the demo's shared guests)
 * @param daily { day: "YYYY-MM-DD", perIp, total } — demo only
 */
export function reserve({ deviceId, personId, ip, limit, daily }) {
  const key = ipKey(ip);
  if (limit > 0 && used(deviceId) >= limit) return { blocked: "device" };
  if (personId && limit > 0 && (perPerson.get(personId) ?? 0) >= limit) return { blocked: "device" };
  if (busy.has(deviceId) || inFlight >= MAX_AT_ONCE) return { blocked: "busy" };
  // The demo's visitors aren't in one room, so one address gets 2 slots at
  // most: a script can't take all of them. (At an event the venue Wi-Fi is
  // one address for everyone, so there it's per phone only.)
  if (daily && (inFlightByIp.get(key) ?? 0) >= 2) return { blocked: "busy" };
  if (daily) {
    rollDay(daily.day);
    if (daily.perIp > 0 && (today.byIp[key] ?? 0) >= daily.perIp) return { blocked: "day" };
    if (daily.total > 0 && today.total >= daily.total) return { blocked: "day" };
  }
  const ipList = prune(recentByIp.get(key) ?? [], 10 * 60_000);
  if (ipList.length >= PER_IP_PER_10_MIN) return { blocked: "ip" };
  recentTotal = prune(recentTotal, 60 * 60_000);
  if (recentTotal.length >= TOTAL_PER_HOUR) return { blocked: "total" };

  // Count it now.
  const at = Date.now();
  perDevice.set(deviceId, used(deviceId) + 1);
  if (personId) perPerson.set(personId, (perPerson.get(personId) ?? 0) + 1);
  ipList.push(at);
  recentByIp.set(key, ipList);
  recentTotal.push(at);
  if (daily) {
    today.byIp[key] = (today.byIp[key] ?? 0) + 1;
    today.total++;
    save();
  }
  busy.add(deviceId);
  inFlight++;
  inFlightByIp.set(key, (inFlightByIp.get(key) ?? 0) + 1);
  if (recentByIp.size > 20_000) {
    for (const [k, v] of recentByIp) if (!prune(v, 10 * 60_000).length) recentByIp.delete(k);
  }
  return { ticket: { deviceId, personId, key, at, daily: !!daily } };
}

/** The question is answered (or failed after being billed): free the slot. */
export function done(ticket) {
  if (!ticket || ticket.released) return;
  ticket.released = true;
  busy.delete(ticket.deviceId);
  inFlight = Math.max(0, inFlight - 1);
  const n = (inFlightByIp.get(ticket.key) ?? 1) - 1;
  if (n > 0) inFlightByIp.set(ticket.key, n);
  else inFlightByIp.delete(ticket.key);
}

/** Nothing was billed (e.g. the AI service turned the call away): hand the question back. */
export function refund(ticket) {
  if (!ticket) return;
  done(ticket);
  const { deviceId, personId, key, at } = ticket;
  perDevice.set(deviceId, Math.max(0, used(deviceId) - 1));
  if (personId) perPerson.set(personId, Math.max(0, (perPerson.get(personId) ?? 1) - 1));
  const drop = (list) => {
    const i = list ? list.lastIndexOf(at) : -1;
    if (i >= 0) list.splice(i, 1);
  };
  drop(recentByIp.get(key));
  drop(recentTotal);
  if (ticket.daily) {
    today.byIp[key] = Math.max(0, (today.byIp[key] ?? 1) - 1);
    today.total = Math.max(0, today.total - 1);
    save();
  }
}

/** Questions answered today in the demo (for /api/health). */
export const demoToday = () => ({ day: today.day, total: today.total, addresses: Object.keys(today.byIp).length });
