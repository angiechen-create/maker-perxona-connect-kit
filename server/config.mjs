// Loads everything event-specific from events/<slug>/ and keeps it fresh.
//
// Staff fix the FAQ on the day by editing these files, so a reload must never
// take the kiosk down: a file that fails to parse keeps the last good version
// live and reports the error (GET /api/health shows it). The avatar keeps
// answering from the previous version until the file is fixed.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";
import * as attendees from "./attendees.mjs";

const REPO_EVENTS = path.resolve(import.meta.dirname, "..", "events");
// On a cloud host the app's own folder is wiped on every deploy, but staff
// edits (check-ins, FAQ fixes) must survive. Point DATA_DIR at a persistent
// disk: the event folder is copied there once and used from then on.
const ROOT = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "events") : REPO_EVENTS;

let current = null; // { slug, event, persona, version, loadedAt }
let lastError = null;
let warnings = [];

export function eventDir(slug) {
  // The slug comes from .env, but it still becomes a path — keep it one.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw new Error(`EVENT_SLUG "${slug}" is not a plain folder name`);
  }
  return path.join(ROOT, slug);
}

/** The event folder in the repo: generated, read-only files (preview images). */
export function repoEventDir(slug) {
  eventDir(slug); // same slug check
  return path.join(REPO_EVENTS, slug);
}

/**
 * A demo event (`demo:` in event.yaml) ships its made-up guests in the repo
 * as attendees.demo.csv; a real event's attendees.csv is never in git.
 */
export const isDemo = (event) => !!(event?.demo && typeof event.demo === "object");
export const rosterFileName = (event) => (isDemo(event) ? "attendees.demo.csv" : "attendees.csv");

/** Splits `---\nyaml\n---\nbody` into { meta, body }. */
function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing the --- frontmatter block at the top`);
  return { meta: parseYaml(m[1]) ?? {}, body: m[2].trim() };
}

function readEvent(slug) {
  const dir = eventDir(slug);
  const eventFile = path.join(dir, "event.yaml");
  const personaFile = path.join(dir, "persona.md");

  const event = parseYaml(fs.readFileSync(eventFile, "utf8"));
  if (!event || typeof event !== "object") throw new Error("event.yaml is empty");
  if (!event.name) throw new Error("event.yaml: `name` is required");

  const { meta, body } = parseFrontmatter(fs.readFileSync(personaFile, "utf8"), "persona.md");
  if (!meta.name) throw new Error("persona.md: `name` is required in the frontmatter");

  const persona = {
    name: meta.name,
    languages: meta.languages ?? ["zh", "en", "ja"],
    defaultLanguage: meta.default_language ?? "zh",
    greeting: meta.greeting ?? {},
    // Who Maker is, in his own words (the About page, and his answer to "who are you?").
    about: meta.about && typeof meta.about === "object" ? meta.about : {},
    avatar: {
      avatarId: meta.avatar_id || process.env.PERXONA_AVATAR_ID || "",
      sceneId: meta.scene_id || process.env.PERXONA_SCENE_ID || "",
      voiceId: meta.voice_id || process.env.PERXONA_VOICE_ID || "",
    },
    background: meta.background || "",
    theme: ["blue", "paper", "night"].includes(meta.theme) ? meta.theme : "blue",
    style: body,
  };

  // Optional: no file simply means nobody to introduce.
  const csvFile = path.join(dir, rosterFileName(event));
  const people = fs.existsSync(csvFile)
    ? attendees.fromCsv(fs.readFileSync(csvFile, "utf8"))
    : { all: [], people: [], skipped: 0, problems: [] };

  return { event, persona, attendees: people };
}

/** Things that load fine but would embarrass us on the day. */
function lint({ event, persona, attendees }) {
  const out = [];
  const raw = JSON.stringify(event);
  const todos = raw.match(/TODO[^"]*/g) ?? [];
  if (todos.length) out.push(`event.yaml still has ${todos.length} TODO(s), e.g. "${todos[0].slice(0, 60)}"`);
  for (const lang of persona.languages) {
    if (!persona.greeting[lang]) out.push(`persona.md: no greeting for "${lang}"`);
  }
  const { avatarId, sceneId, voiceId } = persona.avatar;
  if (!avatarId || !sceneId || !voiceId) {
    out.push("persona.md: avatar_id / scene_id / voice_id not all set — run `npm run catalog` to pick them");
  }
  out.push(...attendees.problems);
  if (isDemo(event)) {
    const names = new Set(attendees.all.map((p) => p.name));
    for (const g of event.demo.guests ?? []) {
      if (!names.has(g?.name)) out.push(`event.yaml demo.guests: "${g?.name}" is not in attendees.demo.csv`);
    }
  }
  const tests = attendees.all.filter((p) => /\bTEST\b/i.test(p.name));
  if (tests.length) out.push(`attendees.csv has ${tests.length} TEST row(s) — delete them before the event`);
  return out;
}

// The parts of event.yaml the staff page edits (keep in step with staff.SECTIONS).
const STAFF_PATHS = [["venue"], ["house_rules"], ["faq"], ["demos", "lineup"], ["topic_tables", "tables"], ["door_lines"], ["seeyou_lines"], ["meet_lines"]];

/**
 * With DATA_DIR: the first boot copies the event folder from the repo. Later
 * boots (every deploy) bring repo edits across too, without losing what
 * staff changed on the day:
 *   persona.md, images → always the repo's (staff never edit them)
 *   event.yaml         → the repo's, except staff-editable sections that staff
 *                        actually changed (live differs from what was last
 *                        copied, kept as .seeded-event.yaml)
 *   attendees.csv      → never touched
 */
export function seed(slug) {
  const live = eventDir(slug);
  const repo = path.join(REPO_EVENTS, slug);
  if (ROOT === REPO_EVENTS) return;
  if (!fs.existsSync(live)) {
    fs.mkdirSync(path.dirname(live), { recursive: true });
    fs.cpSync(repo, live, { recursive: true });
    fs.copyFileSync(path.join(repo, "event.yaml"), path.join(live, ".seeded-event.yaml"));
    console.log(`[config] seeded ${live} from the repo`);
    return;
  }
  for (const f of fs.readdirSync(repo)) {
    if (f === "event.yaml" || f === "attendees.csv" || f.startsWith(".")) continue;
    fs.copyFileSync(path.join(repo, f), path.join(live, f));
  }
  try {
    const repoText = fs.readFileSync(path.join(repo, "event.yaml"), "utf8");
    const liveFile = path.join(live, "event.yaml");
    const seededFile = path.join(live, ".seeded-event.yaml");
    const at = (obj, p) => p.reduce((o, k) => o?.[k], obj) ?? null;
    const liveObj = parseYaml(fs.readFileSync(liveFile, "utf8"));
    const seededObj = fs.existsSync(seededFile) ? parseYaml(fs.readFileSync(seededFile, "utf8")) : null;
    const next = parseDocument(repoText);
    const kept = [];
    for (const p of STAFF_PATHS) {
      const now = JSON.stringify(at(liveObj, p));
      const was = seededObj ? JSON.stringify(at(seededObj, p)) : now;
      if (now !== was) {
        next.setIn(p, next.createNode(at(liveObj, p)));
        kept.push(p.join("."));
      }
    }
    if (next.errors.length) throw next.errors[0];
    const tmp = `${liveFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, next.toString());
    fs.renameSync(tmp, liveFile);
    fs.writeFileSync(seededFile, repoText);
    console.log(`[config] event.yaml updated from the repo${kept.length ? `; kept staff edits in ${kept.join(", ")}` : ""}`);
  } catch (err) {
    console.error(`[config] couldn't bring repo event.yaml across, keeping the live one: ${err.message}`);
  }
}

export function load(slug) {
  try {
    const next = readEvent(slug);
    warnings = lint(next);
    current = {
      slug,
      ...next,
      version: Date.now().toString(36),
      loadedAt: new Date().toISOString(),
    };
    lastError = null;
    console.log(`[config] loaded ${slug} (v${current.version}) · ${next.attendees.all.length} on the roster, ${next.attendees.people.length} can be introduced`);
    for (const w of warnings) console.warn(`[config] ⚠ ${w}`);
  } catch (err) {
    lastError = `${err.message}`;
    if (!current) throw err; // first load: nothing to fall back to, fail loudly
    console.error(`[config] ✗ reload failed, still serving v${current.version}: ${lastError}`);
  }
  return current;
}

/** Reload on any change in the event folder. Editors save in bursts, so debounce. */
export function watch(slug) {
  let timer = null;
  fs.watch(eventDir(slug), () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(slug), 300);
  });
}

export const get = () => current;
export const status = () => ({
  slug: current?.slug,
  version: current?.version,
  loadedAt: current?.loadedAt,
  error: lastError,
  warnings,
  attendees: current
    ? {
        roster: current.attendees.all.length,
        here: current.attendees.all.filter((p) => p.here).length,
        consented: current.attendees.all.filter((p) => p.consent).length,
        introducible: current.attendees.people.length,
      }
    : null,
});
