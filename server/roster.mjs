// The live roster file (attendees.csv in the event folder), read and written
// in one place: the staff page and self check-in both go through here.
// Writes are synchronous read-modify-write, so in one Node process they
// can't interleave.

import fs from "node:fs";
import path from "node:path";
import * as config from "./config.mjs";
import { fromCsv, toCsv } from "./attendees.mjs";

let slug = "";
export function init(eventSlug) {
  slug = eventSlug;
}

const csvFile = () => path.join(config.eventDir(slug), config.rosterFileName(config.get()?.event));

export const read = () => (fs.existsSync(csvFile()) ? fromCsv(fs.readFileSync(csvFile(), "utf8")).all : []);

export function write(people) {
  const file = csvFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, toCsv(people));
  fs.renameSync(tmp, file);
  config.load(slug); // don't wait for the file watcher
}

/** Change one person in place; returns the updated row or null. */
export function update(id, change) {
  const people = read();
  const p = people.find((x) => x.id === id);
  if (!p) return null;
  change(p);
  write(people);
  return p;
}

/**
 * Practice roster for rehearsals (events/<slug>/attendees.mock.csv), loaded
 * when ROSTER_MOCK=1 and there's no roster yet. Every row is marked
 * source=mock so the staff page can warn; importing the real list with
 * "replace" clears them.
 */
export function seedMock() {
  if (process.env.ROSTER_MOCK !== "1" || fs.existsSync(csvFile())) return;
  const mock = path.join(config.repoEventDir(slug), "attendees.mock.csv");
  if (!fs.existsSync(mock)) return;
  fs.copyFileSync(mock, csvFile());
  console.log("[roster] loaded the practice roster (attendees.mock.csv)");
}

export const mockCount = () => read().filter((p) => p.source === "mock").length;
