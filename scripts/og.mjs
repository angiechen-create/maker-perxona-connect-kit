// Makes the link-preview pictures for an event: what LINE / Messenger /
// Slack / iMessage show when someone shares the link, plus the browser and
// home-screen icons. Writes them into events/<slug>/ (served by the server):
//
//   og.png      1200×630  link preview (in event.yaml og_lang, English by default)
//   og-en.png, og-zh.png, og-ja.png   the same per language: a link with
//               ?lang=ja shows the Japanese one (see previewTags in the server)
//   icon.png    512×512   icon (Android, browser tab)
//   apple-touch-icon.png  180×180  iPhone home screen
//
//   npm run og                     (uses EVENT_SLUG from .env)
//
// Needs Google Chrome installed (it takes the screenshots) and the Perxona
// secret key (to fetch the avatar's official render). Re-run after changing
// the persona, the avatar, or the event's date / name.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as config from "../server/config.mjs";
import * as perxona from "../server/perxona.mjs";
import { loc } from "../server/i18n.mjs";

const SLUG = process.env.EVENT_SLUG || process.argv[2];
if (!SLUG) throw new Error("Set EVENT_SLUG in .env (or pass the slug)");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const cfg = config.load(SLUG);
const { event, persona } = cfg;
const outDir = config.eventDir(SLUG);
const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));

// The avatar's official full-body render (700×1200). Without a local secret
// key, pass its URL as MAKER_IMAGE (the live site's /api/kiosk-config has it).
const renderUrl = process.env.MAKER_IMAGE || (await perxona.avatarImage(persona.avatar.avatarId));
let maker = path.join(root, "public/m/maker.png");
if (renderUrl) {
  const res = await fetch(renderUrl);
  if (res.ok) {
    maker = path.join(tmp, "maker.png");
    fs.writeFileSync(maker, Buffer.from(await res.arrayBuffer()));
  }
} else console.warn("! No official render found; using public/m/maker.png (blurry)");

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const name = persona.name.toUpperCase();
const date = String(event.date ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
const when = [date ? `${date[2]}.${date[3]}` : "", String(event.time ?? "").match(/\d{1,2}:\d{2}/)?.[0]].filter(Boolean).join(" · ");
const venue = loc(event.venue?.name).replace(/\s*\(.*\)$/, "").replace(/\s+(Company|Inc\.?|Ltd\.?)$/i, "");
const label = event.kiosk?.label ?? "";

const base = `
<link rel="stylesheet" href="${pathToFileURL(path.join(root, "public/fonts/fonts.css"))}">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    background-color: #1F3BFF; color: #fff; -webkit-font-smoothing: antialiased;
    background-image: linear-gradient(to right, #3A55FF 1px, transparent 1px), linear-gradient(to bottom, #3A55FF 1px, transparent 1px);
    font-family: 'Archivo', 'Noto Sans TC', 'PingFang TC', sans-serif;
  }
  .mono { font-family: 'JetBrains Mono', 'PingFang TC', monospace; }
  .display { font-family: 'Archivo', sans-serif; font-stretch: 125%; font-weight: 900; line-height: .9; }
  .box { display: inline-block; background: #fff; color: #0B0C10; font-family: 'Noto Sans TC', 'PingFang TC', sans-serif; font-weight: 900; padding: .16em .32em; line-height: 1.1; }
  i.c { position: absolute; width: 28px; height: 28px; border: 0 solid #D6DCFF; }
</style>`;

// The preview's lines in each language: the big question in the white box,
// and one line under it.
const OG = {
  en: { lang: "en", ask: "Who to meet tonight?", sub: "Tell Maker what you're building." },
  zh: { lang: "zh-Hant", ask: "今晚，你該認識誰？", sub: "Who should you meet tonight?" },
  ja: { lang: "ja", ask: "今夜、誰に会うべき？", sub: "Who should you meet tonight?" },
};
const og = (l) => `<!doctype html><html lang="${OG[l].lang}"><meta charset="utf-8">${base}
<style>
  :lang(ja) .box, :lang(ja) .top { font-family: 'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', sans-serif; }
  body { background-size: 150px 105px; position: relative; }
  /* LINE shows a centre square crop (x 285–915): Maker stays inside it. */
  .maker { position: absolute; left: 545px; bottom: -6px; height: 640px; }
  .copy { position: absolute; left: 64px; top: 56px; bottom: 52px; width: 700px; display: flex; flex-direction: column; }
  .top { font-size: 24px; color: #D6DCFF; letter-spacing: .02em; }
  h1 { font-size: 92px; margin-top: 36px; }
  .box { font-size: 46px; margin-top: 28px; align-self: flex-start; }
  .en { font-size: 28px; font-weight: 700; margin-top: 18px; color: #D6DCFF; }
  .by { margin-top: auto; display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 800; }
  .by b { background: #0B0C10; color: #fff; padding: 6px 12px; letter-spacing: .04em; }
  .by span { color: #D6DCFF; font-weight: 600; }
</style>
<i class="c" style="left:24px;top:24px;border-width:3px 0 0 3px"></i><i class="c" style="right:24px;top:24px;border-width:3px 3px 0 0"></i>
<i class="c" style="left:24px;bottom:24px;border-width:0 0 3px 3px"></i><i class="c" style="right:24px;bottom:24px;border-width:0 3px 3px 0"></i>
<img class="maker" src="${pathToFileURL(maker)}">
<div class="copy">
  <p class="top mono">&gt; ${esc(loc(event.og_top, l) || `${label}${when ? ` · ${when}` : ""}${venue ? ` · ${venue}` : ""}`)}</p>
  <h1 class="display">HI, I'M<br>${esc(name)}.</h1>
  <span class="box">${esc(OG[l].ask)}</span>
  <p class="en">${esc(OG[l].sub)}</p>
  <p class="by mono"><b>by Perxona</b><span>Live 3D AI matchmaker</span></p>
</div>`;

// Icons: Maker's head and shoulders on the event blue.
const icon = (size) => `<!doctype html><meta charset="utf-8">${base}
<style>
  body { background-image: none; }
  img { position: absolute; left: 50%; transform: translateX(-50%); top: ${Math.round(size * -0.2)}px; height: ${Math.round(size * 1.8)}px; }
</style>
<img src="${pathToFileURL(maker)}">`;

function shoot(html, file, w, h) {
  const page = path.join(tmp, `${path.basename(file, ".png")}.html`);
  fs.writeFileSync(page, html);
  const out = path.join(outDir, file);
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--allow-file-access-from-files", "--virtual-time-budget=3000",
    `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(page).href,
  ], { stdio: "ignore" });
  console.log(`✓ ${path.relative(root, out)}  ${w}×${h}`);
}

const defaultLang = ["en", "zh", "ja"].includes(event.og_lang) ? event.og_lang : "en";
for (const l of ["en", "zh", "ja"]) shoot(og(l), `og-${l}.png`, 1200, 630);
fs.copyFileSync(path.join(outDir, `og-${defaultLang}.png`), path.join(outDir, "og.png"));
console.log(`✓ og.png = og-${defaultLang}.png`);
shoot(icon(512), "icon.png", 512, 512);
// Chrome won't make a window narrower than about 500 px, so the 180 px icon
// is the 512 one scaled down (macOS sips), not a screenshot of its own.
try {
  execFileSync("sips", ["-z", "180", "180", path.join(outDir, "icon.png"), "--out", path.join(outDir, "apple-touch-icon.png")], { stdio: "ignore" });
  console.log(`✓ ${path.relative(root, path.join(outDir, "apple-touch-icon.png"))}  180×180`);
} catch {
  shoot(icon(180), "apple-touch-icon.png", 180, 180);
}
fs.rmSync(tmp, { recursive: true, force: true });
