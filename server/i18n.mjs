// Text that appears on screen can be written once (everyone sees the same
// string, as at a single-language event) or once per language:
//   title: "Organizer"                                  — every language
//   title: { en: "Organizer", zh: "主辦人", ja: "主催者" } — the reader's
// Older files also keep translations next to the English, under their own
// keys (a schedule row's zh / ja, a demo's ask_zh…); `all()` folds those in.
//
// A missing language falls back: the one asked for → English → Chinese →
// Japanese, so a half-translated event still shows something sensible.

export const LANGS = ["en", "zh", "ja"];
const ORDER = (lang) => [lang, ...LANGS.filter((l) => l !== lang)];
const has = (v) => v != null && String(v).trim() !== "";

/** { en?, zh?, ja? } and nothing else: one text per language. */
export const isLangMap = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => LANGS.includes(k));

/** The text for `lang` (string or per-language map), with the fallback above. */
export function loc(v, lang = "en") {
  if (v == null) return "";
  if (isLangMap(v)) {
    const l = ORDER(LANGS.includes(lang) ? lang : "en").find((x) => has(v[x]));
    return l ? String(v[l]) : "";
  }
  return typeof v === "object" ? "" : String(v);
}

/**
 * One field for a screen that switches language without asking again: a
 * plain string when there is only one text, else { en, zh, ja } with only
 * the languages that exist (the page falls back the same way as loc()).
 * `extra` holds translations kept under older keys; a plain string with
 * extras counts as the English.
 */
export function langs(v, extra = {}) {
  const map = isLangMap(v) ? { ...v } : has(v) && typeof v !== "object" ? { en: String(v) } : {};
  let added = false;
  for (const l of LANGS) if (has(extra[l])) (map[l] = String(extra[l])), (added = true);
  const keys = LANGS.filter((l) => has(map[l]));
  if (!keys.length) return "";
  if (!isLangMap(v) && !added) return String(v);
  return Object.fromEntries(keys.map((l) => [l, String(map[l])]));
}

/** Every language filled in (fallbacks applied): { en, zh, ja }. */
export function all(v, extra = {}) {
  const m = langs(v, extra);
  return Object.fromEntries(LANGS.map((l) => [l, loc(m, l)]));
}

/** Each text this field has, in any language (for matching names). */
export const variants = (v) => (isLangMap(v) ? Object.values(v).filter(has).map(String) : has(v) && typeof v !== "object" ? [String(v)] : []);

/** `fn` applied to the text, or to each language's text. */
export const mapText = (v, fn) =>
  isLangMap(v) ? Object.fromEntries(Object.entries(v).map(([l, x]) => [l, fn(String(x ?? ""))])) : v == null ? v : fn(String(v));
