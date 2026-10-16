// The server's own secret: signs check-in tokens and door codes, and keys
// roster ids. CHECKIN_SECRET if set, else made once and kept in DATA_DIR
// (git-ignored), so restarts keep everyone checked in.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let secret = process.env.CHECKIN_SECRET || "";
export function getSecret() {
  if (secret) return secret;
  const file = path.join(process.env.DATA_DIR || path.resolve(import.meta.dirname, ".."), ".checkin-secret");
  try {
    secret = fs.readFileSync(file, "utf8").trim();
  } catch {}
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch {}
  }
  return secret;
}

/** A short keyed hash: same input, same output, and meaningless without the secret. */
export const mac = (text, length = 24) => crypto.createHmac("sha256", getSecret()).update(text).digest("hex").slice(0, length);
