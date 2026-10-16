// Where the night is: live → after (staff pressed "event over") → closed.
//
//   live    check-in open, door screen inviting people in
//   after   48 hours: no new check-ins; people who checked in keep using
//           Maker on their phone; the door screen says thank you
//   closed  Maker is off (on holiday): no answers, no check-in
//
// Saved in DATA_DIR/phase.json so a restart doesn't reopen check-in.
// A demo event (config.isDemo) is always live, whatever phase.json says.

import fs from "node:fs";
import path from "node:path";
import * as config from "./config.mjs";

const HOURS = 48;
const file = () => path.join(process.env.DATA_DIR || path.resolve(import.meta.dirname, ".."), "phase.json");

let endedAt = null;
try {
  endedAt = JSON.parse(fs.readFileSync(file(), "utf8")).endedAt ?? null;
} catch {}

const save = () => fs.writeFileSync(file(), JSON.stringify({ endedAt }, null, 2));

export function get() {
  // The demo event is never over.
  if (!endedAt || config.isDemo(config.get()?.event)) return { phase: "live", endedAt: null, closesAt: null };
  const closesAt = new Date(Date.parse(endedAt) + HOURS * 3600_000).toISOString();
  return { phase: Date.now() < Date.parse(closesAt) ? "after" : "closed", endedAt, closesAt };
}

/** Staff: "the event is over" (now). */
export function end() {
  endedAt ??= new Date().toISOString();
  save();
  return get();
}

/** Staff: pressed by mistake — back to live. */
export function undo() {
  endedAt = null;
  save();
  return get();
}
