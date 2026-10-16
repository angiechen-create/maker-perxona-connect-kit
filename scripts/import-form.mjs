// CSV export → events/<slug>/attendees.csv (the roster). Same as the staff
// page's import button, for when you'd rather use the terminal.
//
//   npm run import-form -- ~/Downloads/form-responses.csv     opt-in form: marks consent
//   npm run import-form -- ~/Downloads/luma-guests.csv        Luma export: adds approved guests
//
// Only the roster's own columns are ever written (name, role, what they
// build, who they want to meet, LinkedIn, project link, source, consent,
// check-in, and their translations if any). Emails,
// phone numbers and everything else in the export never reach the event
// folder. Delete the downloaded export afterwards — it still has them.

import fs from "node:fs";
import path from "node:path";
import { fromCsv, parseCsv, readRows, merge, toCsv } from "../server/attendees.mjs";
import { eventDir } from "../server/config.mjs";

const src = process.argv[2];
const slug = process.env.EVENT_SLUG;
if (!src || !slug) {
  console.error("usage: npm run import-form -- <export.csv>");
  process.exit(1);
}

const text = fs.readFileSync(src, "utf8");
const header = (parseCsv(text)[0] ?? []).join(",").toLowerCase();
const fromForm = /consent|同意/.test(header) && !/approval_status/.test(header);
const { rows, problems } = readRows(text, { source: fromForm ? "form" : "luma" });
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length) process.exit(1);

const dest = path.join(eventDir(slug), "attendees.csv");
const existing = fs.existsSync(dest) ? fromCsv(fs.readFileSync(dest, "utf8")).all : [];
const result = merge(existing, rows, { fromForm });
fs.writeFileSync(dest, toCsv(result.rows));

console.log(`✓ ${fromForm ? "opt-in form" : "registration list"}: read ${rows.length}, added ${result.added}, updated ${result.updated} → ${result.rows.length} on the roster`);
if (fromForm) console.log(`  ${rows.filter((p) => p.consent).length} said yes to being introduced`);
console.log(`  The kiosk picks this up within a second.\n  Delete ${path.basename(src)} now — it still contains emails.`);
