// Perxona Connect, server side.
//
// Two keys, on opposite sides of the trust boundary (see "Auth model" in the
// Perxona Connect Kit's own README on GitHub):
//   SECRET      — stays here. Used only for health checks and the catalog script.
//   PUBLISHABLE — handed to the pages, which pass it to <sv-presenter>. It
//                 spends credits (presentations, speech), so watch the usage.
//                 Restrict its allowed domains to your site's domain in
//                 Perxona Console (this README, step 2, has the details).
// There is no token to mint or refresh: the presenter mints its own speech
// token from the publishable key.

export const BASE_URL = (process.env.PERXONA_API_BASE_URL || "https://console.perxona.ai/asia").replace(/\/$/, "");
export const PRESENTER_URL =
  process.env.PRESENTER_URL || "https://cdn.perxona.ai/asia/prod/latest/widget/entry/presenter.js";

const SECRET = process.env.PERXONA_CONNECT_SECRET_KEY || "";
export const PUBLISHABLE = process.env.PERXONA_CONNECT_PUBLISHABLE_KEY || "";

export async function upstream(pathname, { timeout = 8_000 } = {}) {
  if (!SECRET) throw Object.assign(new Error("PERXONA_CONNECT_SECRET_KEY is not set"), { status: 0 });
  const res = await fetch(`${BASE_URL}${pathname}`, {
    headers: { "X-Connect-Key": SECRET },
    signal: AbortSignal.timeout(timeout),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${res.status} ${body?.details ?? body?.message ?? res.statusText}`);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  return body;
}

/**
 * The avatar's official full-body render (Perxona CDN, public), shown until
 * the 3D model is ready. Cached per avatar id; null if the catalog has none.
 */
const thumbCache = new Map();
// A lookup that failed isn't retried for a few minutes: these calls use the
// secret key, and a page reload (or a script) mustn't hammer Perxona.
const failed = new Map(); // key → time it failed
const recentlyFailed = (key) => Date.now() - (failed.get(key) ?? 0) < 5 * 60_000;
const fail = (key) => {
  failed.set(key, Date.now());
  if (failed.size > 1000) failed.clear();
};

export async function avatarImage(avatarId) {
  if (!avatarId) return null;
  if (thumbCache.has(avatarId)) return thumbCache.get(avatarId);
  if (recentlyFailed(`img:${avatarId}`)) return null;
  try {
    const a = await upstream(`/api/v1/connect/assets/avatars/${avatarId}`);
    const urls = JSON.stringify(a.thumbnail_urls ?? a).match(/https?:[^"]+\.(?:png|webp|jpe?g)/g) ?? [];
    const url = urls.find((u) => /\/full_/.test(u)) ?? urls.find((u) => /\/upper_/.test(u)) ?? null;
    thumbCache.set(avatarId, url);
    return url;
  } catch {
    fail(`img:${avatarId}`);
    return null; // try again in a few minutes
  }
}

/**
 * The avatar's own body motions, grouped by the catalog's category tag
 * (idle / talking / listening / emotion / error …). Cached per avatar.
 */
const motionCache = new Map();
export async function avatarMotions(avatarId) {
  if (!avatarId) return [];
  if (motionCache.has(avatarId)) return motionCache.get(avatarId);
  if (recentlyFailed(`mot:${avatarId}`)) return [];
  try {
    const res = await upstream(`/api/v1/connect/assets/avatars/${avatarId}/motions?page=1&size=100`);
    const list = (res.items ?? []).map((m) => ({
      id: m.motion_id,
      name: m.name,
      category: (m.tags ?? []).find((t) => t.startsWith("category:"))?.slice(9) ?? "",
    }));
    motionCache.set(avatarId, list);
    return list;
  } catch {
    fail(`mot:${avatarId}`);
    return [];
  }
}

/**
 * Reachability + key + credit in one probe. The credit check matters: an
 * org out of credits fails every speech request with 400 / code 1003 — better to see that at rehearsal than at the door.
 */
export async function check() {
  const out = { secretKey: !!SECRET, publishableKey: !!PUBLISHABLE };
  try {
    await upstream("/api/v1/connect/voices?page=1&size=1");
    out.api = "ok";
  } catch (err) {
    out.api = `error: ${err.message}`;
    return out;
  }
  try {
    const c = await upstream("/api/v1/connect/credit");
    out.credit = c;
  } catch (err) {
    out.credit = `error: ${err.message}`;
  }
  return out;
}
