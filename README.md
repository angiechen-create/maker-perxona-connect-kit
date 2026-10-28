# Maker — a live 3D AI matchmaker for community events, by Perxona Connect Kit

[![Built with Perxona](https://img.shields.io/badge/Built%20with-Perxona-000095)](https://github.com/XRSPACE-Inc/perxona-connect-kit)

A live 3D AI host for community events. Guests scan a QR code at the door,
check in on their own phone, and ask, by voice or by typing, in 中文 or
English (the code also has 日本語). It also runs as a kiosk at the entrance:

- **"What's on, and where?"** — answers only from your event's own info, and
  says "ask the staff" instead of guessing.
- **"Which topic table should I join?"** — suggests one or two and says why.
- **"Who should I meet?"** — recommends up to three attendees *who opted in*,
  with their LinkedIn as a QR code on screen.

> **Maker comes alive with [Perxona](https://console.perxona.ai).** The 3D
> avatar, its facial expressions, gestures and lip-sync are Perxona's, loaded
> from Perxona when the page opens: there's nothing to download. You need a
> Perxona account, and there's a **free trial**:
> [console.perxona.ai](https://console.perxona.ai) → Organization →
> Integration → create two Connect keys (step 2 below). Without them the app
> still runs, with Maker as a still picture and a link to the trial.

It runs on one laptop (or a tablet pointed at it). If the network drops, the
screen turns into the schedule and QR codes until it comes back — nobody has
to touch it.

First used at **AI Tinkerers Taipei — Kickoff**, 2026-10-08, with *Maker*, the
yellow FUN DAY avatar.

## Try it in 2 minutes (demo mode)

**On your phone, right now:** [perxona-maker.onrender.com](https://perxona-maker.onrender.com)

Or run it yourself:

`events/demo/` is **Builders Night**, a made-up meetup with a made-up host,
speakers and guests. Instead of checking in by name, you pick a made-up guest
and try Maker as them. Nothing is written to the roster, and questions are
capped (per phone, per address per day, in total per day) so a public demo
can't run up a bill.

```bash
npm install
cp .env.example .env      # EVENT_SLUG=demo; add your keys (step 2 below)
npm start
```

Open **http://localhost:8090/m/** (the phone page) and pick a guest. Without
keys it still runs: the check-in, the program and the buttons work, and Maker
says he can't connect.

Any event becomes a demo by adding a `demo:` section to its `event.yaml` (see
`events/demo/event.yaml`).

```
Browser (kiosk page)                     This laptop (Node server)            Cloud
┌──────────────────────────┐   /api/*    ┌────────────────────────────┐
│ <sv-presenter> 3D avatar │ ─────────▶ │ events/<slug>/ config       │ ──▶ AI (answers)    
│ speech-to-text (Chrome)  │            │ secret keys in .env         │ ──▶ Perxona (catalog, checks)
│ cards, QR, offline board │ ◀───────── │ attendees.csv (opt-in only) │
└──────────────────────────┘            └────────────────────────────┘
            └──────────── publishable key ───────────────────────────────▶ Perxona (avatar, voice)
```

No secret ever reaches the browser: the page only gets Perxona's
*publishable* key. It can't read billing or manage anything, but it can
make the avatar speak, and that uses your Perxona credits.

---

## Set it up for your own event (about 30 minutes)

### You need

- A Mac or PC with **Node 22+** and **Chrome**
- A **Perxona** account (free trial) → [console.perxona.ai](https://console.perxona.ai)
- An **Anthropic API** account with a few dollars of credit →
  [console.anthropic.com](https://console.anthropic.com) (a busy evening is
  about US$5)

### 1. Install (2 min)

```bash
git clone https://github.com/angiechen-create/maker-perxona-connect-kit.git
cd maker-perxona-connect-kit
npm install
cp .env.example .env
```

### 2. Keys (5 min)

In **Perxona Console → Organization → Integration → Connect API keys**, create
two keys. Each is shown once — paste it into `.env` straight away.

| Type | Goes in | Domain restrictions |
|---|---|---|
| **Secret** | `PERXONA_CONNECT_SECRET_KEY` | **leave empty** (server calls send no Origin, so any domain makes every call fail) |
| **Publishable** | `PERXONA_CONNECT_PUBLISHABLE_KEY` | empty is fine for a laptop kiosk (`localhost` isn't accepted) |

In **Anthropic Console → API Keys**, create one key for `ANTHROPIC_API_KEY`,
and set `LLM_MODEL` to a model ID your account can use (there's no default).
Set `STAFF_PASSWORD` to anything you'll remember.

> Don't paste keys into chats or screenshots. If one leaks, revoke it in the
> console and make a new one — nothing else needs to change.

### 3. Your event folder (15 min)

```bash
cp -R events/_template events/my-event-2026-01-31
```

Set `EVENT_SLUG=my-event-2026-01-31` in `.env`, then fill in:

- **`event.yaml`** — schedule, venue, demos, topic tables, FAQ, links. This is
  *everything* the concierge knows. Leave a `TODO` and it answers "ask the
  staff"; it never makes things up.
- **`persona.md`** — the avatar's name, greeting and personality.

**More than one language?** The phone switches between English, 中文 and
日本語. Any text in `event.yaml` that guests see can be one string or one per
language, e.g. `title: { en: Voice agents, zh: 語音 AI, ja: 音声エージェント }`
(a missing language falls back to English). In `attendees.csv`, add columns
such as `name_en`, `role_ja` or `building_zh` next to the plain ones, and the
cards and Maker's answers use the visitor's language. In `events/demo/`
everything guests see is filled in for all three, if you want an example.

Pick the avatar, scene and voice:

```bash
npm run catalog
```

Copy three IDs into `persona.md`. Use a scene with a transparent background for
the flat kiosk look, and a voice marked **`zh en ja ✓`**.

Then make the link-preview picture and icons (what LINE / Messenger show when
the link is shared, with "by Perxona"). Needs Google Chrome; re-run whenever
the avatar, name or date changes, and commit the three PNGs it writes:

```bash
npm run og
```

It makes one preview per language (`og-en.png`, `og-zh.png`, `og-ja.png`).
The plain link shows `og_lang` from `event.yaml` (English if unset); share
`https://your-site/?lang=ja` (or `zh`) and the preview and the page are in
that language.

### 4. The opt-in form (5 min)

The concierge only introduces people who said yes. Make the form with
[`scripts/create-opt-in-form.gs`](scripts/create-opt-in-form.gs): set
`PERSONA` at the top to your avatar's name, paste the file into a new project
at [script.google.com](https://script.google.com), press ▶ Run. Put the
"Send this link" URL in `event.yaml` under `links.opt_in_form` and send it to
attendees. Details: [docs/opt-in-form.md](docs/opt-in-form.md).

### 5. Run it and check it (3 min)

```bash
npm start
npm run rehearse
```

Open **http://localhost:8090/kiosk/** in Chrome. `rehearse` tests keys,
credits, the voice, answers in all three languages, matching, prompt
injection and the offline board, then prints the few things only a person can
check (sound, microphone, unplugging the Wi-Fi).

### 6. Phones and the cloud (optional)

The kiosk runs on one laptop. To let guests use Maker on their own phones
(scan the QR at the door → `/m/`), deploy it: `render.yaml` is a ready
[Render](https://render.com) Blueprint (one always-on service plus a small
disk for check-ins and staff edits). Secrets are asked for on the first deploy
and never stored in git. **Set `PUBLIC_URL`** to the address (QR codes and
link previews use it), and restrict the Perxona publishable key to that domain.

Pages: `/m/` phone app · `/door/` entrance screen with the QR · `/meet/`
"meet Maker" slide · `/seeyou/` thank-you screen · `/kiosk/` laptop kiosk ·
`/staff/` staff page.

---

## On the day

| When | Do |
|---|---|
| Day before | Staff page → **匯入**: the Luma guest export (approved guests become the roster), then the opt-in form responses (marks who agreed). Delete the downloaded CSVs — they contain emails. |
| Arrive | Laptop on power, sleep and notifications off, volume up. `npm start`, open the kiosk in Chrome, **tap once** (this unlocks sound and goes fullscreen). Allow the microphone the first time someone holds the talk button. |
| Before doors | `npm run rehearse` → staff page → **統計歸零** (reset stats) |
| Entrance screen | Open `/staff/` and sign in **in the same browser** as the entrance screen (`/door/`) and the kiosk. Their QR then carries a code that changes every 2 minutes: guests can only check in by scanning it at the venue, so nobody can check in as someone else from a public guest list. Not signed in, the door screen says so in red. A small meetup with no screen: `checkin: { anywhere: true }` in `event.yaml`. With it, anyone who knows a guest's full name can check in as them, and say yes to introductions for them, from anywhere: use it only when the guest list isn't public. |
| Check-in | Staff page → **報到**: search the name, tap **到了**. Ask the one line shown on the page ("can {name} introduce you using what you wrote when you applied?") and tap **同意介紹** only on a yes. Walk-ins: "＋ 新增一位參加者". |
| During | Fix the Wi-Fi line, add tonight's demo lineup and topic tables on the staff page. Changes reach the kiosk within a second. |
| After | Staff page shows anonymous counts for your post-mortem. Delete `events/<slug>/attendees.csv` and the form responses. If any key was ever shared, revoke it. |

**Staff page:** http://localhost:8090/staff/ — on the kiosk laptop. To use it
from a phone, start with `HOST=0.0.0.0 npm start` and open
`http://<laptop-ip>:8090/staff/` on the same Wi-Fi. That also exposes the
kiosk's API to that network, so only do it on a network you trust.

---

## Privacy

Built so the safe thing is the only thing:

- `events/<slug>/attendees.csv` is the roster (who's expected) with two ticks:
  **consent** and **here**. The AI only ever receives people with consent =
  yes — and once check-in starts, only those who are here, so no-shows are
  never recommended. Being on the registration list is not consent.
- Only the roster's own columns are ever written: name, role, what they're
  building, who they want to meet, LinkedIn, project link, source, consent,
  check-in (and their translations, if you add them). Email and
  phone columns in any import are dropped, and email/phone-looking text inside
  answers is blanked out.
- No web search, no scraping. The concierge knows only what each person wrote.
- It won't list everyone, and anyone not on the list gets "I can only
  introduce people who chose to be introduced".
- A person's LinkedIn or project link appears only on their card, and only
  when Maker introduces them (they opted in). The kiosk shows it as a QR code
  drawn on the server.
- Nothing visitors say is stored. `stats/` holds anonymous counts only
  (questions, languages, introductions made).
- `attendees.csv`, `.env`, `stats/` and `inbox/` are git-ignored.

Opted-in attendees' names and answers are sent to Anthropic's Claude to do the
matching; the form tells them so.

---

## Security, in short

- No secret key reaches a browser; the Perxona publishable key does, by
  design, and should be restricted to your domain in the Perxona Console.
- The publishable key spends credits. Restricting it to your domain stops
  other websites from using it, but not a script that copies it. On a
  public site, check your credit use in the Perxona Console.
- Every paid call is capped: questions per phone, per guest, per address, per
  hour and (in demo mode) per day, counted before the AI is asked; at most a
  few at once. Voice only for lines Maker said, with a daily ceiling.
- Check-in needs the entrance screen's rotating QR; staff pages need the
  password (sessions expire after 24 h).
- The 3D avatar is Perxona's script, loaded from Perxona's CDN
  (`PRESENTER_URL`) and trusted like any embedded widget: it runs on your pages.

## When something goes wrong

| You see | It means / do |
|---|---|
| Avatar but no sound | Nobody tapped since the page loaded. Tap the screen once. |
| `↻ RECONNECTING` on the avatar | It lost Perxona and is reconnecting by itself (backs off up to a minute). Text answers still work. |
| Full-screen **TONIGHT'S AGENDA** | No network or no answers twice in a row. It switches back by itself within ~20 s of recovery. |
| "Ask the staff" for something you did fill in | Check `event.yaml` on the staff page; a YAML typo keeps the *previous* version live — `/api/health` shows the error. |
| Talk button does nothing | Microphone blocked. Chrome address bar → allow microphone. Typing always works. |
| `400 code 1003` in the server log | Perxona credits ran out — Console → Organization → Subscription. |
| Answers are slow (>10 s) | Venue network. A phone hotspot is fine — payloads are small. |

---

## How it's put together

```
server/
  index.mjs       routes: kiosk config, /api/ask, voice, QR codes, health
  config.mjs      loads events/<slug>/, watches it, keeps the last good version
  checkin.mjs     phone check-in, door codes, visitor tokens
  quota.mjs       question limits per phone, person, address, hour and day
  tts.mjs         optional ElevenLabs / OpenAI voice (allow-listed lines only)
  nudge.mjs       quick-button answers that cost no AI call
  phase.mjs       before / live / after / closed
  roster.mjs      who's on the list and who came
  secret.mjs      the key that signs check-in tokens
  llm.mjs         one AI call per question; replies capped for speech
  attendees.mjs   CSV → opted-in people (all the privacy rules live here)
  perxona.mjs     server-side Perxona calls (secret key)
  staff.mjs       staff page API (password, atomic writes)
  stats.mjs       anonymous counters
public/
  m/              the phone app (welcome, chat, About Maker, program)
  door/           entrance screen with the check-in QR
  seeyou/         thank-you screen after the event
  meet/           "meet Maker" slide
  kiosk/          the kiosk page — tokens.css (design), style.css, app.js
  staff/          the staff page
  brand/          the Perxona logo
  fonts/          self-hosted Archivo + JetBrains Mono (OFL, licence files included)
events/
  _template/      copy this
  <slug>/         event.yaml, persona.md, attendees.csv (git-ignored)
scripts/
  rehearse.mjs              automatic checks + by-hand checklist
  catalog.mjs               list avatars / scenes / voices
  og.mjs                    makes the link-preview image (npm run og)
  import-form.mjs           form CSV → attendees.csv (or use the staff page)
  create-opt-in-form.gs     makes the Google Form
docs/
  opt-in-form.md    the consent form, word for word
```

Lessons baked in from earlier Perxona events: replies are capped at ~320
characters (long text has caused 422s); `present()` never throws, so its
result is checked; the presenter's status is `detail.status`; a 429 from
the AI service retries with backoff and then says "one moment" instead of freezing;
everything the offline board needs is served from the laptop.

Built by Angie Chen, Perxona's marketing director, who vibe-coded Maker as
her own event companion · made with the
[Perxona Connect Kit](https://github.com/XRSPACE-Inc/perxona-connect-kit)

## License

MIT, see [LICENSE](LICENSE). The fonts in `public/fonts/` are under the SIL
Open Font License (`public/fonts/OFL-*.txt`). For your own event, pick your
own avatar from your Perxona account (`npm run catalog`).
