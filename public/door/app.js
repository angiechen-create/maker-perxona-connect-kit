// The door screen: Maker, live in 3D, inviting arriving guests to scan the
// QR and check in on their own phone. He talks non-stop: the next line from
// event.yaml (door_lines, English and Chinese taking turns) a moment after
// the last one ends, in the event's ElevenLabs voices. He never answers questions and the screen shows
// nothing about anyone — only how many have checked in.
//
// The same script runs the thank-you screen (/seeyou/, <body data-set=
// "seeyou">): its own lines, a countdown to when Maker goes offline. Each
// screen hands over to the other when staff press "event over" (or undo).

const $ = (id) => document.getElementById(id);
const body = document.body;
const presenter = document.querySelector("sv-presenter");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const GAP = 1_200; // breath between lines
// door | seeyou | meet (the "Meet Maker" slide shown at the welcome)
const SET = ["seeyou", "meet"].includes(body.dataset.set) ? body.dataset.set : "door";
let tag = ""; // [EN] / [中文] on the thank-you screen
const PREVIEW = new URLSearchParams(location.search).has("preview");
const STILL = new URLSearchParams(location.search).has("still");
if (STILL) body.classList.add("still");

let cfg = null;
let lines = [];
let ready = false;
let lastMove = 0;

async function api(url) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

// ── Fit the design-size screen to this display ──────────────────────────

function fit() {
  const door = $("door");
  const portrait = innerHeight > innerWidth * 1.1;
  door.classList.toggle("portrait", portrait);
  const [w, h] = portrait ? [1080, 1920] : [1440, 900];
  door.style.setProperty("--fit", String(Math.min(innerWidth / w, innerHeight / h)));
}
addEventListener("resize", fit);
new ResizeObserver(fit).observe(document.documentElement); // also catches TV rotation / window snaps
fit();

// ── Avatar ───────────────────────────────────────────────────────────────

const moves = (category) => (cfg?.motions ?? []).filter((m) => m.category === category).map((m) => m.id);
function move(id) {
  if (!ready || !id) return;
  lastMove = Date.now();
  presenter.playMotion?.(id);
}
const flourish = () => move(pick(moves("emotion")) ?? pick(moves("talking")));

presenter.addEventListener("PRESENTER_STATUS", (e) => {
  const was = ready;
  ready = e.detail?.status === "Ready";
  body.classList.toggle("avatar-ready", ready);
  // Whole body in the narrow stage (the default framing crops his hands).
  if (ready && !was) try { presenter.updateCameraAngle?.("fullbody"); } catch {}
  if (ready && !was) setTimeout(flourish, 800);
});

async function connectAvatar() {
  const { avatarId, sceneId, voiceId } = cfg.target;
  if (!avatarId || !sceneId || !voiceId) return;
  await new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { type: "module", src: cfg.presenterUrl, onload: resolve, onerror: reject });
    document.head.append(s);
  });
  await customElements.whenDefined("sv-presenter");
  const { connect_key } = await api("/api/connect-key");
  await presenter.initializeWithConnectKey(connect_key, { avatarId, sceneId, voiceId });
}

// Between lines he never stands still.
setInterval(() => {
  if (!ready || Date.now() - lastMove < 6_000 + Math.random() * 4_000) return;
  Math.random() < 0.35 ? flourish() : move(pick([...moves("talking"), ...moves("listening")]));
}, 2_000);

// ── Voice ────────────────────────────────────────────────────────────────

// Each line's audio is fetched once and replayed: the same few lines all
// night cost the voice service only once each.
const audioCache = new Map(); // text → Promise<ArrayBuffer | null>
function audioFor(line) {
  if (!audioCache.has(line.text)) {
    const voice = cfg.tts;
    const get = () =>
      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line.text, lang: line.lang, provider: voice.tts, voice: voice.voice, model: voice.model, emotion: "excitement" }),
        signal: AbortSignal.timeout(20_000),
      })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
    // One retry: a server restart (deploy) or a voice-service hiccup
    // shouldn't cost a line its voice.
    const p = !voice ? Promise.resolve(null) : get().then((a) => a || wait(1_500).then(get));
    // A failed fetch is tried again next time round, not cached.
    p.then((a) => a || audioCache.delete(line.text));
    audioCache.set(line.text, p);
  }
  return audioCache.get(line.text);
}

/** Resolves when he has finished the line (or after a safety timeout). */
function finished(timeout) {
  return new Promise((resolve) => {
    const done = () => {
      presenter.removeEventListener("ALL_PERFORMANCE_FINISHED", done);
      resolve();
    };
    presenter.addEventListener("ALL_PERFORMANCE_FINISHED", done);
    setTimeout(done, timeout);
  });
}

/** Length in seconds of one of our WAV clips (16-bit mono), or 0. */
function seconds(audio) {
  if (!audio || audio.byteLength < 44) return 0;
  const v = new DataView(audio);
  return v.getUint32(0) === 0x52494646 ? (audio.byteLength - 44) / (v.getUint32(24, true) * 2) : 0;
}

async function say(line) {
  const audio = await audioFor(line);
  $("caption").textContent = SET === "door" ? `> MAKER: ${line.text}` : line.text;
  $("caption").lang = line.lang === "zh" ? "zh-Hant" : line.lang;
  tag = line.lang === "zh" ? "中文" : line.lang.toUpperCase();
  renderSound();
  const len = seconds(audio) || Math.max(3, line.text.length * 0.12);
  if (!ready) {
    // The 3D never came up: still be heard, with a plain audio player.
    if (audio) {
      const url = URL.createObjectURL(new Blob([audio], { type: "audio/wav" }));
      const el = new Audio(url);
      await el.play().catch(() => {});
      await new Promise((r) => ((el.onended = el.onerror = r), setTimeout(r, (len + 3) * 1000)));
      URL.revokeObjectURL(url);
    }
    return;
  }
  flourish();
  // Wait for the line to really finish — never less than its own length, so
  // the next line can't start on top of it (two clips at once = crackle).
  const end = Promise.all([finished((len + 6) * 1000), wait(len * 1000)]);
  // presentWithAudio may take the buffer over, so hand it a copy.
  const r = audio ? await presenter.presentWithAudio(audio.slice(0), line.text, { emotion: "excitement", intensity: "high" }) : null;
  if (!r?.success) await presenter.present(line.text, { emotion: "excitement", intensity: "high" });
  await end;
}

async function loop() {
  // Give the 3D a few seconds to arrive, so his first line is lip-synced;
  // not longer — a silent screen looks broken (he still talks without it).
  for (let t = 0; !ready && t < 8; t++) await wait(1_000);
  for (let i = 0; ; i++) {
    if (!lines.length) {
      await wait(5_000);
      continue;
    }
    const line = lines[i % lines.length];
    audioFor(lines[(i + 1) % lines.length]); // fetch the next one meanwhile
    try {
      await say(line);
    } catch (err) {
      console.warn(`say: ${err.message}`);
      await wait(3_000);
    }
    await wait(GAP);
  }
}

// ── Countdown (thank-you screen): how long Maker stays online ────────────

let closesAt = 0;
const pad = (n) => String(n).padStart(2, "0");
function renderClock() {
  if (!$("clock") || !closesAt) return;
  const s = Math.max(0, Math.floor((closesAt - Date.now()) / 1000));
  $("clock").textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  const tz = cfg?.event?.timezone || "Asia/Taipei";
  const d = new Date(closesAt);
  const md = new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "2-digit", day: "2-digit" }).formatToParts(d);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  $("until").textContent = `UNTIL ${md.find((x) => x.type === "month").value}.${md.find((x) => x.type === "day").value} ${hm}`;
}
setInterval(renderClock, 1_000);

// ── Count and lines (refreshed, so edits on the staff side show up) ──────

async function drawQr() {
  try {
    const res = await fetch(`/api/qr-app?src=${SET}`, { cache: "no-store" });
    if (!res.ok) return; // keep the last good QR
    $("qr").innerHTML = await res.text();
    // Check-in needs the code, and only a screen signed in as staff gets it.
    const missing = SET !== "seeyou" && cfg?.doorCheckin && res.headers.get("X-Door-Code") !== "1";
    let warn = document.getElementById("qr-warn");
    if (missing && !warn) {
      warn = Object.assign(document.createElement("a"), { id: "qr-warn", href: "/staff/", target: "_blank" });
      warn.textContent = "⚠ 這台螢幕還沒登入工作人員頁，掃這個 QR 不能報到。點這裡登入，再重新整理。 / Sign in to the staff page on this screen, or this QR can't check anyone in.";
      Object.assign(warn.style, { display: "block", marginTop: "8px", padding: "8px 10px", background: "#D7142B", color: "#fff", font: "700 14px/1.35 sans-serif", textDecoration: "none" });
      $("qr").after(warn);
    }
    if (!missing) warn?.remove();
  } catch {}
}

async function refresh() {
  try {
    const d = await api(`/api/door?set=${SET}`);
    // Staff pressed "event over" (or took it back): switch screens.
    if (SET === "door" && d.phase !== "live") return location.replace("/seeyou/");
    // (?preview: look at the thank-you screen before the event is over.)
    if (SET === "seeyou" && d.phase === "live" && !PREVIEW) return location.replace("/door/");
    lines = d.lines ?? [];
    closesAt = d.closesAt ? Date.parse(d.closesAt) : closesAt;
    if ($("count-n")) {
      $("count-n").textContent = String(d.checkedIn ?? 0);
      $("count").hidden = !d.checkedIn;
    }
  } catch {}
}

// ── Start ────────────────────────────────────────────────────────────────
// No start button: Maker starts moving and talking as soon as the page
// opens. Browsers only allow sound on their own once the site is allowed to
// autoplay (Chrome: site settings → Sound → Allow; Safari: Settings for this
// website → Auto-Play → Allow All Auto-Play). Until then he still moves and
// the captions run, the corner says SOUND OFF, and any tap turns it on.

/** True when this browser lets the page play sound without a tap. */
function soundAllowed() {
  if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy("audiocontext") === "allowed";
  try {
    const ctx = new AudioContext();
    const ok = ctx.state === "running";
    ctx.close();
    return ok;
  } catch {
    return false;
  }
}

function renderSound() {
  const on = soundAllowed();
  $("sound").textContent = !on ? "[SOUND OFF · TAP SCREEN]" : SET === "door" ? "[CHECK-IN]" : SET === "meet" ? "[MEET MAKER]" : `[${tag || "EN"}]`;
  $("sound").classList.toggle("warn", !on);
}

async function wakeSound() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {}
  try { await presenter.resumeAudioPlayback?.(); } catch {}
  document.documentElement.requestFullscreen?.().catch(() => {});
  renderSound();
}
// Any tap (the first one, or after the laptop slept) turns the sound on.
addEventListener("pointerdown", wakeSound, { capture: true, passive: true });
addEventListener("keydown", wakeSound);

async function main() {
  cfg = await api("/api/kiosk-config");
  const k = cfg.event.kiosk ?? {};
  const date = String(cfg.event.date ?? "").match(/\d{4}-(\d{2})-(\d{2})/);
  // A shared screen for everyone: event texts written per language ({ en, zh, ja }) show in English.
  const en = (o) => (o && typeof o === "object" ? o.en ?? o.zh ?? o.ja ?? "" : o ?? "");
  const venue = String(en(cfg.event.venue)).replace(/\s*\(.*\)$/, "").replace(/\s+(Company|Inc\.?|Ltd\.?)$/i, "");
  if ($("event-label")) $("event-label").textContent = [date ? `${date[1]}.${date[2]}.${String(cfg.event.date).slice(0, 4)}` : "", venue].filter(Boolean).join(" · ").toUpperCase();
  $("coords").textContent = en(k.coordinates);
  // The community's name above the big title (event.yaml kiosk.brand).
  for (const b of document.querySelectorAll(".brandline")) b.textContent = String(en(k.brand ?? k.label)).toUpperCase();
  if ($("url")) $("url").textContent = (cfg.publicUrl || location.origin).replace(/^https?:\/\//, "");
  if (cfg.avatarImage) document.querySelector(".placeholder").src = cfg.avatarImage;
  // The QR opens Maker on the phone, marked as scanned at the door. It also
  // carries the door code that lets a phone check in, which changes every
  // 2 minutes, so it's fetched again every minute.
  await drawQr();
  if (SET !== "seeyou") setInterval(drawQr, 60_000);
  await refresh();
  renderClock();
  setInterval(refresh, SET === "door" ? 15_000 : 30_000);
  connectAvatar().catch((err) => console.warn(`avatar: ${err.message}`)); // the picture stays if this fails
  renderSound();
  setInterval(renderSound, 5_000);
  // ?still: a static poster (for a screenshot or print) — no voice, no live bits.
  if (STILL) return;
  loop();
}

main().catch((err) => console.error(`boot: ${err.message}`));
