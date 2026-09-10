// Ramène les captures brutes docs/store/raw-N.png (zone 1152×720 capturée en pixels
// physiques, ratio 16:10) au format exigé par le Chrome Web Store : 1280 × 800 px, PNG.
// Usage : node scripts/store-shots.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const dir = resolve("docs/store");
const W = 1280;
const H = 800;
const names = {
  1: "1-aujourdhui",
  2: "2-semaine",
  3: "3-examens",
  4: "4-detail-cours",
  5: "5-demain",
};

for (const file of readdirSync(dir).filter((f) => /^raw-\d\.png$/.test(f))) {
  const n = file.match(/\d/)[0];
  const data = readFileSync(resolve(dir, file)).toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <image href="data:image/png;base64,${data}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  const out = resolve(dir, `${names[n] ?? `shot-${n}`}.png`);
  writeFileSync(out, png);
  console.log(`${file} → ${out} (${png.length} octets)`);
}
