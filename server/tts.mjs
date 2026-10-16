// Optional: Maker's voice from ElevenLabs (VOICE_PROVIDER=elevenlabs) or,
// as a trial (?tts=openai), OpenAI, instead of Perxona's built-in voices.
// The phone gets the audio back and plays it on the avatar with
// presentWithAudio(), which also drives the lip-sync.
//
// Only text this server just said (or one of the page's own fixed lines) is
// synthesised, so the endpoint can't be used as a free TTS service. Every
// paid voice line also counts toward a daily ceiling (MAX_VOICE_PER_DAY),
// the same line is synthesised once and then served from memory, and the
// voice and model are the configured ones: a public site can't pick a
// pricier model or another voice on our account. TTS_LAB=1 lifts that last
// rule for tuning experiments (?voice=, model, lab), on a laptop only.

import fs from "node:fs";
import path from "node:path";

const KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
export const VOICES = ["ash", "verse", "cedar", "marin", "coral", "ballad", "echo", "alloy", "sage", "shimmer", "nova", "onyx", "fable"];
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || "ash";

const INSTRUCTIONS = {
  zh: "你是 Maker，活動現場的 AI 配對主持人，一個黃色笑臉的可愛角色。用台灣口音的國語說話（不是大陸腔），語氣活潑、熱情、有活力，像在派對上招呼朋友，節奏輕快但字字清楚。",
  en: "You are Maker, a playful AI matchmaker hosting a tech meetup, a cheerful yellow smiley character. Speak upbeat, warm and energetic, like a fun party host greeting friends. Lively pace, every word clear.",
  ja: "あなたはMaker、テックイベントのAIマッチメーカーで、黄色いスマイルの可愛いキャラクターです。明るく元気に、パーティーの司会のように楽しく話してください。テンポよく、はっきりと。",
};

// ElevenLabs: the most expressive option. eleven_v3 reads audio tags such as
// [excited] or [laughs], which we add from the answer's emotion.
const XI_KEY = process.env.ELEVENLABS_API_KEY || "";
const XI_MODEL = process.env.ELEVENLABS_MODEL || "eleven_v3";
const XI_VOICE = process.env.ELEVENLABS_VOICE_ID || ""; // an id, or "zh:ID,en:ID,ja:ID"
// Per-language "tune": play the voice a little fast, which also raises its
// pitch (ElevenLabs has no pitch control). "zh:1.06" = 6% faster, ~1 semitone up.
const XI_TUNE = process.env.ELEVENLABS_TUNE || "";
// Per-language speaking rate inside ElevenLabs (0.7–1.2). Paired with a
// tune below 1 it lowers the pitch (and makes the voice sound bigger) while
// keeping the pace: "zh:1.12" with tune "zh:0.88".
const XI_SPEED = process.env.ELEVENLABS_SPEED || "";
function speedFor(spec, lang) {
  const map = Object.fromEntries(String(spec ?? "").split(",").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2));
  const v = Number(map[lang]);
  return v >= 0.7 && v <= 1.2 ? v : null;
}
const XI_STABILITY = Math.min(1, Math.max(0, Number(process.env.ELEVENLABS_STABILITY ?? 0.75)));
function tuneFor(spec, lang) {
  const map = Object.fromEntries(String(spec ?? "").split(",").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2));
  const v = Number(map[lang] ?? (/^[\d.]+$/.test(String(spec)) ? spec : 1));
  return v >= 0.8 && v <= 1.3 ? v : 1;
}

/** Raw 16-bit mono PCM → WAV, declaring a (possibly faster) sample rate. */
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const TAG = {
  joy: "[happy]", excitement: "[excited]", admiration: "[impressed]", caring: "[warmly]", gratitude: "[happy]",
  curiosity: "[curious]", surprise: "[surprised]", realization: "[excited]", embarrassment: "[sheepishly]",
  confusion: "[confused]", sadness: "[sad]", disappointment: "[sighs]", annoyance: "[playfully]",
};

export const enabled = () => !!KEY || !!XI_KEY;

/**
 * The voice everyone hears unless the URL says otherwise. VOICE_PROVIDER=
 * elevenlabs (with its key and ELEVENLABS_VOICE_ID) makes ElevenLabs the
 * default; anything else keeps Perxona's built-in voice. The phone falls back
 * to Perxona's voice by itself if ElevenLabs fails or runs out of credits.
 */
export function defaultVoice() {
  if (process.env.VOICE_PROVIDER === "elevenlabs" && XI_KEY && XI_VOICE) return { tts: "eleven", voice: XI_VOICE, model: "" };
  return null;
}
export const providers = () => ({ openai: !!KEY, elevenlabs: !!XI_KEY });

// Replies we produced recently: only these (or short lines) may be spoken.
const recent = new Map(); // text → expiry
export function allow(text) {
  recent.set(text, Date.now() + 15 * 60_000);
  if (recent.size > 2000) for (const [t, exp] of recent) if (exp < Date.now()) recent.delete(t);
}
// Fixed lines from the event file (the door screen's invitations, the
// greeting): always allowed.
const fixed = new Set();
export const allowAlways = (texts) => texts.forEach((t) => fixed.add(String(t).trim()));
// The phone page's own fixed line (public/m/app.js soundHi). Its "welcome
// back, {name}" is allowed per guest, when /api/me sees them (welcomeBack).
allowAlways(["聲音打開囉！", "Sound is on!", "音声オンにしたよ！"]);
// `first`: one name, or { zh, en, ja } when it's written differently per language.
export function welcomeBack(first) {
  const f = (l) => (first && typeof first === "object" ? first[l] : first);
  for (const line of [`歡迎回來，${f("zh")}！`, `Welcome back, ${f("en")}!`, `おかえり、${f("ja")}さん！`]) allow(line);
}
/** Anyone may voice a fixed line; anything else needs a checked-in visitor (or staff). */
export const isFixed = (text) => fixed.has(String(text ?? "").trim());
const allowed = (text) => fixed.has(text) || (recent.get(text) ?? 0) > Date.now();

// Tuning experiments: only on a machine nobody else can reach.
const LAB = process.env.TTS_LAB === "1" && ["127.0.0.1", "localhost", "::1"].includes(process.env.HOST || "127.0.0.1");
const LANGS = ["zh", "en", "ja"];

// One line is synthesised at most a few times a day (the cache normally
// makes it once); stops one allowed line being paid for over and over.
const PER_LINE_PER_DAY = 3;
let lineCounts = { date: "", byText: new Map() };
// Fixed lines (door screen, greeting, About) repeat all night by design and
// anyone may ask for them, so they get more room, counted per line across
// every voice and language (one caller can't make each line over and over
// by switching voice settings).
const FIXED_PER_LINE_PER_DAY = 12;
function countLine(text) {
  const isFixedLine = fixed.has(text);
  // By the text alone: asking for the same line in another language or voice
  // is still the same line.
  const key = `${isFixedLine ? "fixed" : "line"}:${text}`;
  const date = new Date().toISOString().slice(0, 10);
  if (lineCounts.date !== date) lineCounts = { date, byText: new Map() };
  const n = lineCounts.byText.get(key) ?? 0;
  if (n >= (isFixedLine ? FIXED_PER_LINE_PER_DAY : PER_LINE_PER_DAY)) throw Object.assign(new Error("this line was already voiced today"), { status: 429 });
  lineCounts.byText.set(key, n + 1);
  return () => lineCounts.byText.set(key, Math.max(0, (lineCounts.byText.get(key) ?? 1) - 1)); // undo
}

// Paid lines per day (UTC), all voices together. A busy evening is a few hundred.
const PER_DAY = Number(process.env.MAX_VOICE_PER_DAY) > 0 ? Number(process.env.MAX_VOICE_PER_DAY) : 1000;
// Saved in DATA_DIR, so a restart doesn't forgive the day's count.
const dayFile = () => path.join(process.env.DATA_DIR || path.resolve(import.meta.dirname, ".."), "voice-day.json");
let day = { date: "", paid: 0 };
try {
  day = { ...day, ...JSON.parse(fs.readFileSync(dayFile(), "utf8")) };
} catch {}
let saveTimer = null;
function saveDay() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${dayFile()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(day));
      fs.renameSync(tmp, dayFile());
    } catch (err) {
      console.error(`[tts] couldn't save today's count: ${err.message}`);
    }
  }, 1000);
}
const paidToday = () => (day.date === new Date().toISOString().slice(0, 10) ? day.paid : 0);
function spend() {
  const date = new Date().toISOString().slice(0, 10);
  if (day.date !== date) day = { date, paid: 0 };
  if (day.paid >= PER_DAY) throw Object.assign(new Error(`daily voice limit (${PER_DAY}) reached`), { status: 429 });
  day.paid++;
  saveDay();
}
export const usage = () => ({ today: paidToday(), perDay: PER_DAY });

// The same line, voice and settings → the same audio; kept for the last 300.
const cache = new Map();
async function cached(key, make) {
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v); // most recent last
    return v;
  }
  spend();
  let audio;
  try {
    audio = await make();
  } catch (err) {
    day.paid--; // a failed call costs nothing
    saveDay();
    throw err;
  }
  cache.set(key, audio);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return audio;
}

/** @returns {Promise<Buffer>} MP3 */
export async function speak(text, { lang = "zh", voice, provider = "openai", emotion, model, tune, speed, lab } = {}) {
  text = String(text ?? "").trim().slice(0, 400);
  if (!text || !allowed(text)) throw Object.assign(new Error("not a reply from this server"), { status: 403 });
  if (!LAB) {
    // Production: only the configured voice and model, no experiments.
    voice = provider === "eleven" ? XI_VOICE : undefined;
    model = tune = speed = undefined;
    lab = undefined;
  }
  // Only real values: anything else would make the same line a new (paid) one.
  if (!["openai", "eleven"].includes(provider)) throw Object.assign(new Error("unknown voice provider"), { status: 400 });
  lang = LANGS.includes(lang) ? lang : "zh";
  emotion = TAG[emotion] ? emotion : undefined;
  if (provider === "eleven") {
    // Emotion only changes the audio on v3 (it becomes an audio tag).
    const modelId = XI_MODELS[model] ?? XI_MODELS[XI_MODEL_LANG[lang]] ?? XI_MODEL;
    if (modelId !== "eleven_v3") emotion = undefined;
  } else emotion = undefined;
  const key = JSON.stringify([provider, text, lang, voice, emotion, model, tune, speed, lab ?? null]);
  const make = provider === "eleven"
    ? () => eleven(text, { voice, emotion, lang, model, tune, speed, lab })
    : () => {
        if (!KEY) throw Object.assign(new Error("OPENAI_API_KEY is not set"), { status: 503 });
        return openai(text, { lang, voice });
      };
  return cached(key, async () => {
    const undo = countLine(text);
    try {
      return await make();
    } catch (err) {
      undo(); // a failed synthesis wasn't paid for
      throw err;
    }
  });
}

async function openai(text, { lang, voice }) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICES.includes(voice) ? voice : DEFAULT_VOICE,
      input: text,
      instructions: INSTRUCTIONS[lang] ?? INSTRUCTIONS.en,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`OpenAI TTS ${res.status}: ${body.slice(0, 200)}`), { status: 502 });
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * A voice id, or one per language: "zh:ID,en:ID,ja:ID" (e.g. a Taiwanese
 * voice for Chinese, a native one for Japanese). Unlike Perxona's voices,
 * these can change per answer: the audio is ours, nothing to re-initialise.
 */
function pickVoice(spec, lang) {
  const ok = (id) => /^[A-Za-z0-9]{10,40}$/.test(id ?? "");
  const map = Object.fromEntries(String(spec ?? "").split(",").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2 && ok(p[1])));
  if (map[lang]) return map[lang];
  if (ok(spec)) return spec;
  if (lang === "ja" && map.en) return map.en; // no Japanese voice set: the English one speaks it
  return map.zh ?? Object.values(map)[0] ?? "";
}

/**
 * A voice's first request can take ~15 s (ElevenLabs loading it); after that
 * ~0.5 s. Say one short line per default voice at startup so the first
 * visitor doesn't wait. A few credits.
 */
export async function warmUp() {
  const def = defaultVoice();
  if (!def) return;
  for (const [lang, line] of [["zh", "嗨！"], ["en", "Hi!"]]) {
    allow(line);
    await speak(line, { lang, voice: def.voice, provider: "eleven" }).catch((err) => console.warn(`[tts] warm-up ${lang}: ${err.message}`));
  }
  console.log("[tts] voices warmed up");
}

const XI_MODELS = { v3: "eleven_v3", flash: "eleven_flash_v2_5", turbo: "eleven_turbo_v2_5", multi: "eleven_multilingual_v2" };
// A different model for some languages: "zh:multi" (Turbo's Mandarin tones
// were off for the Chinese voice; multilingual is ~1 s slower but right).
// Japanese is on multilingual by default: the voice may not be a native one.
const XI_MODEL_LANG = { ja: "multi", ...Object.fromEntries(String(process.env.ELEVENLABS_MODEL_LANG || "").split(",").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2 && XI_MODELS[p[1]])) };

async function eleven(text, { voice, emotion, lang, model, tune, speed, lab }) {
  lab ??= {};
  if (!XI_KEY) throw Object.assign(new Error("ELEVENLABS_API_KEY is not set"), { status: 503 });
  const id = pickVoice(voice, lang) || pickVoice(XI_VOICE, lang);
  if (!id) throw Object.assign(new Error("no ElevenLabs voice id"), { status: 400 });
  const modelId = XI_MODELS[model] ?? XI_MODELS[XI_MODEL_LANG[lang]] ?? XI_MODEL;
  // Only v3 understands audio tags; the faster models get livelier settings instead.
  // The others take <break> tags: a clear pause at each sentence end and a
  // short one at commas, so a run of Chinese clauses doesn't blur together.
  // Only a pause between sentences: ElevenLabs warns that many <break> tags
  // make delivery unstable (commas already pause on their own).
  const input = modelId === "eleven_v3"
    ? (TAG[emotion] ? `${TAG[emotion]} ${text}` : text)
    : lab.nobreak ? text : text.replace(/([。！？!?])\s*(?=\S)/g, '$1 <break time="0.3s" /> ');
  // Consistency over flourish: Maker must sound like the same person every
  // answer. Low stability / high style made each generation drift (measured:
  // the same Japanese line came out 4 semitones apart). A fixed seed
  // makes repeat generations alike too.
  const stability = Number.isFinite(Number(lab.stability)) && lab.stability !== undefined ? Math.min(1, Math.max(0, Number(lab.stability))) : XI_STABILITY;
  const rate = speedFor(speed ?? XI_SPEED, lang);
  const voiceSettings = modelId === "eleven_v3" ? undefined : { stability, similarity_boost: 0.9, style: 0, use_speaker_boost: true, ...(rate ? { speed: rate } : {}) };
  const k = tuneFor(tune ?? XI_TUNE, lang);
  const generate = async (mid) => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=pcm_22050`, {
      method: "POST",
      headers: { "xi-api-key": XI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input, model_id: mid, voice_settings: mid === "eleven_v3" ? undefined : voiceSettings,
        seed: Number.isInteger(lab.seed) ? lab.seed : 8,
        ...(lang && mid !== "eleven_v3" && !lab.nolang ? { language_code: lang } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw Object.assign(new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`), { status: 502 });
    }
    return Buffer.from(await res.arrayBuffer());
  };
  let pcm = await generate(modelId);
  // The fast models sometimes stall on a sentence (measured: "聊聊AI吧！"
  // stops mid-way, goes silent for seconds, drops or blurts the rest). A
  // stall shows as a long silence after speech started: say it again with
  // the slower, steadier multilingual model.
  if (modelId !== "eleven_multilingual_v2" && modelId !== "eleven_v3" && longestPause(pcm) >= 1.2) {
    retries++;
    try { pcm = await generate("eleven_multilingual_v2"); } catch {}
  }
  return wav(level(trimEnd(pcm)), Math.round(22050 * k));
}

/**
 * Every clip at the same loudness, with headroom: peak at ~60% of full
 * scale. A shouted line ("Hey you!") came back peaking at 92%, and the
 * avatar player's own gain then distorted it into a crackle.
 */
function level(pcm, target = 0.6 * 32767) {
  let peak = 1;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  const g = target / peak;
  if (Math.abs(g - 1) < 0.05) return pcm;
  const out = Buffer.alloc(pcm.length - (pcm.length % 2));
  for (let i = 0; i < out.length; i += 2) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * g))), i);
  return out;
}

export let retries = 0;

/** Longest silence (s) after the first speech, in 16-bit mono PCM at 22050 Hz. */
function longestPause(pcm, rate = 22050) {
  const frame = Math.round(rate * 0.1);
  let started = false, run = 0, longest = 0;
  for (let i = 0; i + frame * 2 <= pcm.length; i += frame * 2) {
    let e = 0;
    for (let j = 0; j < frame; j += 4) { const v = pcm.readInt16LE(i + j * 2); e += v * v; }
    const loud = e / (frame / 4) > 2e5;
    if (loud) { started = true; run = 0; } else if (started) longest = Math.max(longest, ++run * 0.1);
  }
  return longest;
}

/** Drop trailing silence beyond 0.3 s (keeps the reply snappy). */
function trimEnd(pcm, rate = 22050) {
  const frame = Math.round(rate * 0.05) * 2;
  let end = pcm.length - (pcm.length % 2);
  while (end > frame) {
    let e = 0;
    for (let j = end - frame; j < end; j += 8) { const v = pcm.readInt16LE(j); e += v * v; }
    if (e / (frame / 8) > 2e5) break;
    end -= frame;
  }
  return pcm.subarray(0, Math.min(pcm.length - (pcm.length % 2), end + Math.round(rate * 0.3) * 2));
}
