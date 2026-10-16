// Motion on the welcome screen. "a" for everyone; ?fx=b shows
// the other look and ?fx=0 turns it off (remembered for the visit):
//
//   a  "HI, I'M MAKER." slams in letter by letter; the tagline flips like a
//      departure board through the event's languages; huge outlined words
//      drift behind it.
//   b  the tagline types itself out in each language, then a marker sweeps
//      under it.
//
// CSS transforms and opacity only, so the 3D avatar above keeps its frame
// rate. Off for people who ask their phone for less motion.

const params = new URLSearchParams(location.search);
let pick = params.get("fx");
try {
  if (pick) sessionStorage.setItem("maker-fx", pick);
  else pick = sessionStorage.getItem("maker-fx");
} catch {}
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const variant = REDUCED ? "0" : ["a", "b", "0"].includes(pick) ? pick : "a";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let run = 0; // a newer start() stops the older loops

/**
 * @param hi    the "HI, I'M MAKER." heading
 * @param match the tagline element
 * @param lines () => [[lang, text], …] the tagline in each of the event's languages, current first
 * @param stage the landing pane (for the drifting words)
 */
export function start({ hi, match, lines, stage }) {
  if (variant === "0") return;
  const me = ++run;
  document.body.dataset.fx = variant;
  if (variant === "a") {
    slam(hi);
    drift(stage);
    flipLoop(match, lines, me);
  } else {
    typeLoop(match, lines, me);
  }
}

/** Each letter drops in, big to normal, one after another. */
export function slam(el) {
  if (!el || el.dataset.fxDone || REDUCED) return;
  el.dataset.fxDone = "1";
  let i = 0;
  const wrap = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 3) continue; // keep the <br>
      const frag = document.createDocumentFragment();
      // Latin words stay whole (a line may only break between words); CJK
      // characters each stand alone, as they wrap anywhere anyway; closing
      // punctuation stays with what it follows (never alone on a line).
      for (const part of child.textContent.match(/[A-Za-z0-9'’.,!?-]+[。、，！？」）]*|\s+|.[。、，！？」）]*/gu) ?? []) {
        if (/^\s+$/.test(part)) {
          frag.append(" "); // a space inside an inline-block would collapse
          continue;
        }
        const word = document.createElement("span");
        word.className = "fx-word";
        for (const ch of part) {
          const s = document.createElement("span");
          s.className = "fx-slam";
          s.textContent = ch;
          s.style.animationDelay = `${150 + i++ * 45}ms`;
          word.append(s);
        }
        frag.append(word);
      }
      child.replaceWith(frag);
    }
  };
  wrap(el);
}

/** Huge outlined words drifting behind Maker (in the stage, under his canvas). */
function drift(stage) {
  if (!stage || stage.querySelector(".fx-drift")) return;
  const band = document.createElement("div");
  band.className = "fx-drift";
  band.setAttribute("aria-hidden", "true");
  const words = "MEET! · MATCH! · BUILD! · 認識！ · 配對！ · 出会い！ · ";
  const row = (dir) => {
    const r = document.createElement("div");
    r.className = `fx-row ${dir}`;
    r.textContent = words.repeat(4);
    return r;
  };
  band.append(row("l"), row("r"), row("l"));
  stage.prepend(band);
}

/** The tagline flips to the next language every few seconds, departure-board style. */
async function flipLoop(el, lines, me) {
  if (!el) return;
  el.classList.add("fx-flip");
  let k = 0;
  while (me === run) {
    const list = lines();
    const [, text] = list[k % list.length];
    if (el.textContent !== text) {
      el.classList.add("out");
      await wait(260);
      if (me !== run) return;
      el.textContent = text;
      el.classList.remove("out");
      el.classList.add("in");
      await wait(320);
      el.classList.remove("in");
    }
    await wait(k === 0 ? 3000 : 2800); // a flip every ~3.2 s
    k++;
  }
}

/** The tagline types itself out, a marker sweeps under it, then the next language. */
async function typeLoop(el, lines, me) {
  if (!el) return;
  el.classList.add("fx-type");
  let k = 0;
  while (me === run) {
    const list = lines();
    const [lang, text] = list[k % list.length];
    el.lang = { zh: "zh-Hant", ja: "ja" }[lang] ?? "en";
    el.classList.remove("marked");
    for (let n = 0; n <= [...text].length; n++) {
      if (me !== run) return;
      el.textContent = [...text].slice(0, n).join("");
      await wait(lang === "en" ? 38 : 85);
    }
    el.classList.add("marked");
    await wait(2600);
    k++;
  }
}
