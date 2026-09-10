// Images promotionnelles du Chrome Web Store : 440×280 (petite) et 1400×560 (haut de page),
// PNG 24 bits SANS canal alpha (exigence du store). Rendu SVG → pixels par @resvg/resvg-js,
// puis encodage PNG RGB maison (resvg ne sort que du RGBA). Usage : node scripts/promo-images.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const OUT = resolve("docs/store");
const icon = readFileSync(resolve("public/icons/icon128.png")).toString("base64");
const shot = readFileSync(resolve("docs/store/1-aujourdhui.png")).toString("base64");

// Le popup occupe, dans une capture 1280×800, la zone x 798–1225, y 36–710.
const POPUP = { x: 798, y: 36, w: 427, h: 674 };

function svg(W, H, big) {
  const scale = big ? 0.72 : 0.27;
  const pw = POPUP.w * scale;
  const ph = POPUP.h * scale;
  const px = W - pw - (big ? 70 : 18);
  const py = big ? (H - ph) / 2 + 40 : 28;
  const title = big ? 64 : 25;
  const lede = big ? 24 : 12;
  const left = big ? 80 : 20;
  const iconSize = big ? 96 : 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="g" cx="80%" cy="20%" r="80%"><stop offset="0" stop-color="#16223a"/><stop offset="1" stop-color="#0b0e13"/></radialGradient>
    <clipPath id="c"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${big ? 14 : 8}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <image href="data:image/png;base64,${icon}" x="${left}" y="${big ? H / 2 - 150 : 30}" width="${iconSize}" height="${iconSize}"/>
  <text x="${left}" y="${big ? H / 2 + 20 : 100}" font-family="Segoe UI, Arial, sans-serif" font-size="${title}" font-weight="700" fill="#e9ecef" letter-spacing="-1">ClientSide Horaire</text>
  <text x="${left}" y="${big ? H / 2 + 62 : 132}" font-family="Segoe UI, Arial, sans-serif" font-size="${lede}" fill="#c2c8cf">Horaire, examens et échéances de l'UdeM,</text>
  <text x="${left}" y="${big ? H / 2 + 62 + lede * 1.4 : 132 + lede * 1.4}" font-family="Segoe UI, Arial, sans-serif" font-size="${lede}" fill="#c2c8cf">dans votre navigateur. Rien n'est transmis.</text>
  ${big ? `<text x="${left}" y="${H / 2 + 62 + lede * 3.4}" font-family="Segoe UI, Arial, sans-serif" font-size="${lede * 0.85}" fill="#6f7780">Extension non officielle, sans lien avec l'Université de Montréal.</text>` : ""}
  <g clip-path="url(#c)">
    <image href="data:image/png;base64,${shot}" x="${px - POPUP.x * scale}" y="${py - POPUP.y * scale}" width="${1280 * scale}" height="${800 * scale}"/>
  </g>
  <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${big ? 14 : 8}" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
</svg>`;
}

// Encodeur PNG minimal : couleur type 2 (RGB 8 bits), filtre 0 sur chaque ligne.
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function rgbPng(rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, W, H, big] of [
  ["promo-440x280.png", 440, 280, false],
  ["promo-1400x560.png", 1400, 560, true],
]) {
  const pixmap = new Resvg(svg(W, H, big), { fitTo: { mode: "width", value: W } }).render();
  const png = rgbPng(pixmap.pixels, pixmap.width, pixmap.height);
  writeFileSync(resolve(OUT, name), png);
  console.log(`${name} — ${pixmap.width}×${pixmap.height}, RGB sans alpha, ${png.length} octets`);
}
