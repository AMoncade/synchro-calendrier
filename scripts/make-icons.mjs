// Rasterise `public/icons/icon.svg` en icônes PNG 16/48/128 px pour le manifest.
// Usage : node scripts/make-icons.mjs
//
// Rendu par resvg (Rust, sans navigateur ni canvas) : la génération est
// reproductible en ligne de commande et ne dépend d'aucun outil installé
// à la main. Fond transparent, pour que l'icône tienne sur une barre
// d'outils claire comme sombre.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const SIZES = [16, 48, 128];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "public", "icons");
const source = readFileSync(join(iconsDir, "icon.svg"), "utf8");

for (const size of SIZES) {
  const renderer = new Resvg(source, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0, 0, 0, 0)",
    shapeRendering: 2, // antialiasing géométrique : bords nets à 16 px
  });
  const png = renderer.render().asPng();
  const target = join(iconsDir, `icon${size}.png`);
  writeFileSync(target, png);
  console.log(`icon${size}.png — ${size}×${size}, ${png.length} octets`);
}
