// Anonymise une fixture HTML/texte capturée sur Synchro avant de la commiter.
// Usage : node scripts/scrub-fixture.mjs <fichier> [--name "Prénom Nom"] [--id 20123456]
// Remplace le nom, le matricule et le courriel de l'étudiant par des valeurs factices,
// et retire les jetons PeopleSoft (ICSID, ICStateNum) qui identifient la session.
import { readFileSync, writeFileSync } from "node:fs";

const [, , file, ...rest] = process.argv;
if (!file) {
  console.error("usage: node scripts/scrub-fixture.mjs <fichier> [--name N] [--id M]");
  process.exit(1);
}
const opt = (flag) => {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let text = readFileSync(file, "utf8");
const name = opt("--name");
const id = opt("--id");
const replacements = [
  [/[A-Za-z0-9._%+-]+@umontreal\.ca/g, "etudiant@umontreal.ca"],
  [/(ICSID['"]?\s*(?:value=|=)['"]?)[^'"&\s]+/g, "$1SCRUBBED"],
  [/(ICStateNum['"]?\s*(?:value=|=)['"]?)\d+/g, "$10"],
];
if (name) replacements.push([new RegExp(escapeRe(name), "gi"), "Prénom Nom"]);
if (id) replacements.push([new RegExp(escapeRe(id), "g"), "20000000"]);
for (const [re, sub] of replacements) text = text.replace(re, sub);
writeFileSync(file, text);
console.log(`anonymisé : ${file}`);
