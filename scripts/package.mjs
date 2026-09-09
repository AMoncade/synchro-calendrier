#!/usr/bin/env node
// Empaquette dist/ en synchro-calendrier-<version>.zip, prêt pour le Chrome Web
// Store ou pour une distribution manuelle.
//
// Écriture ZIP maison (~120 lignes) plutôt qu'une dépendance : le format est
// figé depuis 1989 et nous n'avons besoin que de deux modes de compression,
// tous deux fournis par node:zlib. Voir la spécification APPNOTE 6.3.10 de PKWARE.
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
//
// Contraintes respectées :
//   - manifest.json à la racine de l'archive (exigence des navigateurs) ;
//   - chemins en barres obliques, jamais de barres inverses Windows ;
//   - archive déterministe : entrées triées, horodatage fixe (SOURCE_DATE_EPOCH
//     si défini), donc deux builds identiques donnent deux zips identiques.
//
// Usage : node scripts/package.mjs [--out <dossier>] [--source <dossier>]

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ---------------------------------------------------------------------------
// Primitives ZIP

/** CRC-32 (IEEE 802.3), table calculée une fois. */
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Date/heure au format MS-DOS (deux mots de 16 bits) : secondes par pas de 2,
 * année à partir de 1980. Le format ne descend pas sous 1980-01-01.
 */
function dosDateTime(date) {
  const year = Math.max(date.getUTCFullYear(), 1980);
  const time =
    (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

/**
 * Construit l'archive à partir d'entrées { name, data }.
 * Chaque fichier est deflaté ; on retombe sur « stored » (méthode 0) si la
 * compression ne gagne rien, ce qui arrive sur les PNG déjà compressés.
 */
function buildZip(entries, modifiedAt) {
  const { time, day } = dosDateTime(modifiedAt);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);
    // Bit 11 : le nom de fichier est en UTF-8 (accents des noms de chunks).
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version minimale : 2.0 (deflate)
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // pas de champ « extra »
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // créé sous Unix, version 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // commentaire
    central.writeUInt16LE(0, 34); // numéro de disque
    central.writeUInt16LE(0, 36); // attributs internes
    central.writeUInt32LE(0o644 << 16, 38); // attributs externes : rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disque courant
  end.writeUInt16LE(0, 6); // disque du répertoire central
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // commentaire

  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------------------------------------------------------------------------
// Collecte des fichiers

/** Chemins relatifs de tous les fichiers de `dir`, en barres obliques, triés. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

// ---------------------------------------------------------------------------

function main(argv) {
  const arg = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  const source = resolve(ROOT, arg("--source", "dist"));
  const outDir = resolve(ROOT, arg("--out", "."));

  let files;
  try {
    files = listFiles(source);
  } catch {
    console.error(`Introuvable : ${source}\nLancez d'abord « npm run build ».`);
    process.exit(1);
  }

  if (!files.includes("manifest.json")) {
    console.error(`Aucun manifest.json à la racine de ${source} : rien à empaqueter.`);
    process.exit(1);
  }

  // La version fait foi dans manifest.json, pas dans package.json : c'est elle
  // que le navigateur affiche et que le Chrome Web Store contrôle.
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  const { version, name } = manifest;
  if (!version) {
    console.error("manifest.json ne déclare pas de version.");
    process.exit(1);
  }

  // Horodatage fixe : une archive reproductible se re-vérifie par son empreinte.
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const modifiedAt = new Date(Number.isFinite(epoch) ? epoch * 1000 : Date.UTC(2000, 0, 1));

  const entries = files.map((name) => ({ name, data: readFileSync(join(source, name)) }));
  const zip = buildZip(entries, modifiedAt);

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `synchro-calendrier-${version}.zip`);
  writeFileSync(outPath, zip);

  const raw = entries.reduce((n, e) => n + e.data.length, 0);
  const sha = createHash("sha256").update(zip).digest("hex");
  console.log(`${name} ${version}`);
  console.log(`${basename(outPath)} — ${files.length} fichiers, ${(raw / 1024).toFixed(1)} kio → ${(zip.length / 1024).toFixed(1)} kio`);
  console.log(`sha256 ${sha}`);
  for (const f of files) console.log(`  ${f}`);
}

// Exécuté directement (et non importé par un test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2));
}

export { buildZip, crc32 };
