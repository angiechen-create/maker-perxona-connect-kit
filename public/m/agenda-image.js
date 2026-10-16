// Tonight's agenda as a picture people can keep: drawn here in the browser
// from the live event data (so a schedule edit shows up at once), in the
// phone's language, in the BLUE look. Returns a PNG blob.

const W = 1080;
const PAD = 80;
const C = { bg: "#1F3BFF", grid: "#3A55FF", ink: "#FFFFFF", ink2: "#D6DCFF", box: "#FFFFFF", boxInk: "#0B0C10" };
const CJK = "'Noto Sans TC', 'PingFang TC', 'Hiragino Sans', 'Noto Sans JP', sans-serif";
const MONO = `'JetBrains Mono', ${CJK}`;
const DISPLAY = `'Archivo', ${CJK}`;

// Event texts are one string, or { en, zh, ja }: the reader's, else English,
// else Chinese, else Japanese (same as the app's pickL).
const pick = (o, lang) => {
  if (o == null) return "";
  if (typeof o !== "object") return String(o);
  for (const k of [lang, "en", "zh", "ja"]) if (o[k] != null && String(o[k]).trim()) return String(o[k]);
  return "";
};

const TITLE = { zh: "今晚議程", en: "Tonight's agenda", ja: "今夜のプログラム" };

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Wraps text to maxWidth; returns lines. Breaks between words, or between characters for CJK. */
function wrap(ctx, text, maxWidth) {
  const tokens = /[　-鿿]/.test(text) ? [...text] : text.split(/(\s+)/);
  const lines = [];
  let line = "";
  for (const tk of tokens) {
    const next = line + tk;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line.trimEnd());
      line = tk.trimStart();
    } else line = next;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/**
 * @param {{ event: object, lang: "zh"|"en"|"ja", logo?: string }} opts
 * @returns {Promise<Blob>}
 */
export function agendaImage({ event, lang, logo }) {
  const rows = (event.schedule ?? []).map((it) => {
    // One language per picture: the reader's (English when there's no translation).
    const en = pick(it.what, "en").split(" — ")[0];
    return { time: it.time, main: pick(it.label, lang) || ({ zh: it.zh, ja: it.ja }[lang]) || en, sub: "" };
  });
  return board({ event, lang, logo, title: TITLE[lang] ?? TITLE.en, rows });
}

const TABLES_TITLE = { zh: "今晚主題桌", en: "Topic tables", ja: "テーマ卓" };

/** All topic tables as a picture: number, topic, Topic Lead and language. */
export function tablesImage({ event, lang, logo }) {
  const rows = (event.tables ?? []).map((t) => {
    // Title as announced; the line under it in the reader's language.
    const detail = pick({ zh: t.zh, ja: t.ja }[lang], lang) || pick(t.detail, lang);
    const host = pick(t.host, lang).replace(/\s*\(.*\)$/, "");
    return { time: `T${t.table}`, main: pick(t.topic, lang), sub: [detail, `${host} · ${pick(t.language, lang)}`.replace(/ · $/, "")].filter(Boolean).join("\n") };
  });
  return board({ event, lang, logo, title: TABLES_TITLE[lang] ?? TABLES_TITLE.en, rows });
}

async function board({ event, lang, logo = "/brand/perxona-white.png", title, rows }) {
  await Promise.all([
    document.fonts?.load(`900 96px Archivo`),
    document.fonts?.load(`700 40px 'JetBrains Mono'`),
  ]).catch(() => {});

  // Measure first so the picture is exactly as tall as it needs to be.
  const measure = document.createElement("canvas").getContext("2d");
  const textX = PAD + 190;
  const textW = W - textX - PAD;
  const laid = rows.map((r) => {
    measure.font = `700 46px ${CJK}`;
    const main = wrap(measure, r.main, textW);
    measure.font = `500 28px ${CJK}`;
    const sub = r.sub ? String(r.sub).split("\n").flatMap((part) => wrap(measure, part, textW)) : [];
    // first baseline at +46, 58 per main line, 40 per sub line, 34 below the last
    return { ...r, main, sub, h: 46 + (main.length - 1) * 58 + sub.length * 40 + 34 };
  });
  const headH = 330;
  const footH = 170;
  const H = headH + laid.reduce((s, r) => s + r.h, 0) + footH;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background + the app's grid.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 2;
  for (let x = W / 4; x < W; x += W / 4) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 135; y < H; y += 135) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // Crop corners.
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 4;
  for (const [x, y, dx, dy] of [[36, 36, 1, 1], [W - 36, 36, -1, 1], [36, H - 36, 1, -1], [W - 36, H - 36, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * 44); ctx.lineTo(x, y); ctx.lineTo(x + dx * 44, y); ctx.stroke();
  }

  // Header.
  // Just the date, like the thank-you screen's top bar: 20260131.
  const label = String(event.date ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0].replace(/-/g, "") ?? "";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink2;
  ctx.font = `500 28px ${MONO}`;
  ctx.fillText(label, PAD, 118);
  ctx.fillStyle = C.ink;
  ctx.font = `900 92px ${DISPLAY}`;
  ctx.fillText("TONIGHT", PAD, 222);
  // The title in a white box, like the app's headline boxes.
  ctx.font = `900 46px ${CJK}`;
  const tw = ctx.measureText(title).width;
  ctx.fillStyle = C.box;
  ctx.fillRect(PAD, 248, tw + 32, 66);
  ctx.fillStyle = C.boxInk;
  ctx.fillText(title, PAD + 16, 298);

  // Rows.
  let y = headH + 24;
  for (const r of laid) {
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y - 10); ctx.lineTo(W - PAD, y - 10); ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = `700 44px ${MONO}`;
    ctx.fillText(r.time, PAD, y + 46);
    ctx.font = `700 46px ${CJK}`;
    r.main.forEach((ln, i) => ctx.fillText(ln, textX, y + 46 + i * 58));
    ctx.fillStyle = C.ink2;
    ctx.font = `500 28px ${CJK}`;
    r.sub.forEach((ln, i) => ctx.fillText(ln, textX, y + 46 + (r.main.length - 1) * 58 + (i + 1) * 40));
    y += r.h;
  }

  // Footer: when.
  const fy = H - 92;
  ctx.strokeStyle = C.ink2;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, fy - 40); ctx.lineTo(W - PAD, fy - 40); ctx.stroke();
  ctx.fillStyle = C.ink2;
  ctx.font = `500 28px ${MONO}`;
  ctx.fillText(String(event.time ?? "").match(/\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/)?.[0] ?? "", PAD, fy + 10);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
