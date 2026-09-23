#!/usr/bin/env node
// Dérive dist-firefox/ de dist/ : même code, empaqueté pour Firefox.
//
// Le code source ne change pas : en Manifest V3, Firefox accepte `chrome.*` avec
// promesses. Deux choses changent, parce que CRXJS produit une sortie Chrome :
//
// 1. Le manifeste : `service_worker` → `scripts` (Firefox n'a que des event pages),
//    réglages Gecko ajoutés.
// 2. Les content scripts. CRXJS les charge par un petit script qui fait
//    `import(chrome.runtime.getURL(...))`. Dans Firefox MV3, cet import passe par
//    le chargeur de modules de la page et échoue (« error loading dynamically
//    imported module », constaté le 2026-09-23 sur Synchro, Firefox bug 1803950
//    ouvert). On les reconstruit donc en scripts classiques autonomes (IIFE), sans
//    import, et le manifeste pointe vers eux ; les ressources accessibles au web,
//    qui ne servaient qu'à cet import, disparaissent.
//
// Détail et sources : docs/FIREFOX.md.
//
// Usage : node scripts/firefox.mjs [--source dist] [--out dist-firefox]

import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, isAbsolute } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * Réglages Gecko. L'`id` devient définitif à la première publication sur AMO.
 * 140 (bureau) et 142 (Android) : premières versions qui connaissent
 * `data_collection_permissions`, clé exigée par AMO pour toute nouvelle extension
 * depuis le 2025-11-03.
 */
export const GECKO = {
  id: "synchro-calendrier@moncade.com",
  strict_min_version: "140.0",
  data_collection_permissions: { required: ["none"] },
};
export const GECKO_ANDROID = { strict_min_version: "142.0" };

/** `src/content/synchro.ts` → `content/synchro.js`, le fichier IIFE de la sortie Firefox. */
export function firefoxContentScriptPath(sourcePath) {
  return `content/${basename(sourcePath, extname(sourcePath))}.js`;
}

/**
 * Manifeste construit par CRXJS (`built`) + manifeste source (`source`) → manifeste Firefox.
 * Les content scripts et les ressources accessibles au web sont repris de la source,
 * pas de la sortie CRXJS : c'est défaire ses chargeurs, pas les corriger.
 */
export function toFirefoxManifest(built, source) {
  const { service_worker, ...background } = built.background ?? {};
  if (typeof service_worker !== "string") {
    throw new Error("background.service_worker absent : la sortie de CRXJS a changé de forme.");
  }
  const out = {
    ...built,
    background: { ...background, scripts: [service_worker] },
    content_scripts: (source.content_scripts ?? []).map((script) => ({
      ...script,
      js: script.js.map(firefoxContentScriptPath),
    })),
    browser_specific_settings: { gecko: GECKO, gecko_android: GECKO_ANDROID },
  };
  if (source.web_accessible_resources) out.web_accessible_resources = source.web_accessible_resources;
  else delete out.web_accessible_resources;
  return out;
}

async function main(argv) {
  const arg = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  const from = resolve(ROOT, arg("--source", "dist"));
  const out = resolve(ROOT, arg("--out", "dist-firefox"));

  // `out` est effacé : il doit être un sous-dossier du dépôt, distinct de la source.
  const rel = relative(ROOT, out);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || out === from) {
    console.error(`Dossier de sortie refusé : ${out}`);
    process.exit(1);
  }

  let built;
  try {
    built = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
  } catch {
    console.error(`Aucun manifest.json lisible dans ${from}\nLancez d'abord « npm run build ».`);
    process.exit(1);
  }
  const source = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

  rmSync(out, { recursive: true, force: true });
  cpSync(from, out, { recursive: true });

  // Chargeurs CRXJS devenus inutiles : aucun manifeste Firefox ne les référence.
  for (const script of built.content_scripts ?? []) {
    for (const file of script.js) rmSync(join(out, file), { force: true });
  }

  // Un build par content script : une IIFE ne se découpe pas en morceaux partagés.
  const { build } = await import("vite");
  const entries = [...new Set((source.content_scripts ?? []).flatMap((script) => script.js))];
  for (const entry of entries) {
    const target = firefoxContentScriptPath(entry);
    await build({
      configFile: false,
      root: ROOT,
      logLevel: "warn",
      publicDir: false,
      build: {
        outDir: join(out, "content"),
        emptyOutDir: false,
        lib: {
          entry: resolve(ROOT, entry),
          formats: ["iife"],
          // Exigé par le format dès que le module exporte ; reste local au bac à sable.
          name: `ClientSideHoraire_${basename(target, ".js")}`,
          fileName: () => basename(target),
        },
      },
    });
  }

  writeFileSync(join(out, "manifest.json"), JSON.stringify(toFirefoxManifest(built, source), null, 2) + "\n");
  console.log(`${rel} — Firefox ≥ ${GECKO.strict_min_version}, ${GECKO.id}, content scripts : ${entries.map(firefoxContentScriptPath).join(", ")}`);
}

// Exécuté directement (et non importé par un test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main(process.argv.slice(2));
}
