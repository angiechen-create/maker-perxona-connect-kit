# The "introduce me" opt-in form

The concierge only introduces people who filled this in and ticked the
consent box. Send it to admitted attendees (e.g. with the venue details the
day before), then import the responses.

## Fastest: run the script (~2 minutes)

`scripts/create-opt-in-form.gs` creates the whole form below in one click —
paste it into a new project at https://script.google.com and press Run. The
two links it prints are the editor and the link to send.

## Or create the form by hand (Google Forms, ~5 minutes)

**Settings first — before adding questions:**
Settings → Responses → **Collect email addresses: Do not collect**.
The concierge never needs an email, so don't collect one.

**Title:** 想讓 Maker 幫你介紹人嗎？ / Want Maker to introduce you?

**Description:**
> 活動現場入口有一位 AI 主持人 Maker。如果你填了這份表，當其他參加者問
> 「我該認識誰？」，Maker 可能會推薦你，並在螢幕上顯示你的名字、下面的回答和
> LinkedIn QR code。不填就不會被介紹。
>
> At the entrance there's an AI concierge, Maker. If you fill this in, Maker may
> recommend you when another attendee asks "who should I meet?", showing your
> name, your answers below and a LinkedIn QR code on screen. Skip it and
> you won't be introduced.

**Questions** (keep the titles — the import script matches on them):

| # | Title | Type | Required |
|---|---|---|---|
| 1 | 你的名字 / Name | Short answer | ✓ |
| 2 | 你在做什麼？（一句話）/ What are you building? (one line) | Short answer | ✓ |
| 3 | 想聊什麼、想認識怎樣的人？/ What do you want to talk about or who do you want to meet? | Short answer | |
| 4 | LinkedIn 網址（選填）/ LinkedIn URL (optional) | Short answer | |
| 5 | 同意 / Consent | Checkboxes, one option (text below) | ✓ |

Option text for question 5:

> 我同意 Maker 在活動現場向其他參加者介紹我，使用我的名字、上面的回答和
> LinkedIn。這些回答會交給 AI（Anthropic 的 Claude）用來配對，活動結束後
> 刪除。/ I agree that Maker may introduce me to other attendees at the event
> using my name, answers above and LinkedIn. My answers are sent to an AI
> (Anthropic's Claude) for matching and deleted after the event.

## Import the responses

Easiest: staff page → **匯入名單或表單回覆** → pick the downloaded CSV. People
already on the roster (from the Luma import) are matched by name and marked
"OK to introduce"; their form answers replace their application answers.

Or from the terminal:

1. In the form: Responses → ⋮ → **Download responses (.csv)**.
2. In the project folder:

   ```bash
   node --env-file=.env scripts/import-form.mjs ~/Downloads/<the file>.csv
   ```

3. **Delete the downloaded file.** Only opted-in people, with just the roster's own fields, land in
   `events/<slug>/attendees.csv`; the export itself is the only copy of
   everything else.

Re-running with a newer export updates people already imported and keeps
anyone added at check-in.

## After the event

Delete `events/<slug>/attendees.csv` (it is git-ignored, so it was never
committed), and delete the form's responses — the form promised that.
