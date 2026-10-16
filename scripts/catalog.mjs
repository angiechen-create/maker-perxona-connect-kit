// Lists the avatars, scenes and voices this Perxona account can use, so you
// can copy the IDs into events/<slug>/persona.md.
//
//   npm run catalog            everything
//   npm run catalog voices     just one kind

import { upstream } from "../server/perxona.mjs";

const only = process.argv[2];
const KINDS = {
  avatars: ["/api/v1/connect/assets/avatars", "avatar_id"],
  scenes: ["/api/v1/connect/assets/scenes", "scene_id"],
  voices: ["/api/v1/connect/voices", "id"],
};

for (const [kind, [endpoint, idField]] of Object.entries(KINDS)) {
  if (only && only !== kind) continue;
  console.log(`\n── ${kind} ──`);
  let page = 1;
  for (;;) {
    const res = await upstream(`${endpoint}?page=${page}&size=50`);
    for (const item of res.items ?? []) {
      const langs = item.languages ? `  [${item.languages.includes("zh") && item.languages.includes("en") && item.languages.includes("ja") ? "zh en ja ✓" : item.languages.join(" ")}]` : "";
      console.log(`${item[idField] ?? item.id}  ${item.name}${langs}`);
    }
    if (!res.items?.length || res.items.length < 50) break;
    page += 1;
  }
}
console.log("\nFor the voice, pick one marked “zh en ja ✓” — the concierge switches language per visitor.");
