// Tells the owner on Slack when the Perxona credits run low or run out, so
// the avatar doesn't quietly stop talking on a public demo.
//
//   SLACK_WEBHOOK_URL   a Slack "incoming webhook" (https://hooks.slack.com/…)
//   CREDIT_ALERT_BELOW  remaining points that count as low (default: 20% of
//                       the plan's total)
//
// Checks a minute after start and then every 6 hours. Each warning (low,
// out) is sent once until the credits go back up, also across restarts.

import fs from "node:fs";
import path from "node:path";
import * as perxona from "./perxona.mjs";

const WEBHOOK = /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL ?? "") ? process.env.SLACK_WEBHOOK_URL : "";
const BELOW = Number(process.env.CREDIT_ALERT_BELOW) > 0 ? Number(process.env.CREDIT_ALERT_BELOW) : null;
const file = () => path.join(process.env.DATA_DIR || path.resolve(import.meta.dirname, ".."), "credit-alert.json");

let sent = { level: "ok" }; // the last warning sent: ok | low | out
try {
  sent = { ...sent, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
} catch {}
const save = () => {
  try {
    fs.writeFileSync(file(), JSON.stringify(sent));
  } catch (err) {
    console.error(`[alerts] couldn't save: ${err.message}`);
  }
};

async function post(text) {
  const res = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Slack ${res.status}`);
}

/** One check: send a warning if the level got worse; reset once credits are back. */
export async function checkCredits(siteName = "Maker") {
  if (!WEBHOOK) return null;
  let c;
  try {
    c = (await perxona.check()).credit;
  } catch {
    return null;
  }
  const left = Number(c?.remaining_credit_points);
  const total = Number(c?.total_credit_points);
  if (!Number.isFinite(left)) return null; // the check itself failed: say nothing
  const low = BELOW ?? (Number.isFinite(total) && total > 0 ? total * 0.2 : 500);
  const level = c?.is_quota_exceeded || left <= 0 ? "out" : left < low ? "low" : "ok";
  if (level === sent.level) return level;
  // Better than last time (topped up, or out → low after a small top-up):
  // remember it, so the next drop warns again, but don't post.
  const rank = { ok: 0, low: 1, out: 2 };
  if (rank[level] < rank[sent.level]) {
    sent.level = level;
    save();
    return level;
  }
  const points = Math.round(left).toLocaleString("en-US");
  const text = level === "out"
    ? `⚠️ ${siteName} 的 Perxona 點數用完了（剩 ${points}）。3D 的 Maker 現在不能說話，請到 Perxona Console 儲值：https://console.perxona.ai`
    : `⚠️ ${siteName} 的 Perxona 點數剩 ${points}，快用完了。記得到 Perxona Console 儲值：https://console.perxona.ai`;
  try {
    await post(text);
    sent.level = level;
    save();
    console.log(`[alerts] credits ${level}: told Slack`);
  } catch (err) {
    console.error(`[alerts] couldn't post to Slack: ${err.message}`);
  }
  return level;
}

/** Once per webhook: a hello on Slack, so the owner knows the alerts work. */
async function hello(siteName) {
  const id = WEBHOOK.slice(-6); // a new webhook says hello again
  if (sent.hello === id) return;
  let points = "";
  try {
    const left = Number((await perxona.check()).credit?.remaining_credit_points);
    if (Number.isFinite(left)) points = `目前剩 ${Math.round(left).toLocaleString("en-US")} 點。`;
  } catch {}
  try {
    await post(`✅ ${siteName} 的點數提醒設定好了。Perxona 點數快用完、或用完時，會在這裡通知妳。${points}`);
    sent.hello = id;
    save();
  } catch (err) {
    console.error(`[alerts] couldn't post to Slack: ${err.message}`);
  }
}

export function start(siteName) {
  if (!WEBHOOK) return;
  setTimeout(() => hello(siteName).then(() => checkCredits(siteName)), 60_000).unref();
  setInterval(() => checkCredits(siteName), 6 * 3600_000).unref();
  console.log("  Alerts: Slack, when Perxona credits run low");
}
