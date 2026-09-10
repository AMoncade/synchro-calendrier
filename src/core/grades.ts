// Carnet de notes StudiUM (phase 13, 2026-09-10) : la page
// `/grade/report/user/index.php?id=<courseid>` → un `GradeReport`.
// Voir docs/ARCHITECTURE.md et docs/REPERAGE-STUDIUM-2026-09-10.md §6.
//
// Règle de fond : **on n'invente et on ne recalcule rien**. Les valeurs sont
// recopiées telles que la page les affiche — « 2,0 », « 0–2 » (tiret
// demi-cadratin), « 100,0 % », « 1,8 (285) », et même « Erreur » quand Moodle
// n'arrive pas à calculer. La virgule décimale, le séparateur de plage et le
// nombre de répondants entre parenthèses sont ce que l'étudiant voit ; les
// convertir en nombres serait une deuxième source de vérité, donc une source
// d'écart. Le popup affiche, il ne calcule pas.
//
// Le tableau est repéré par le TEXTE de ses en-têtes, pas par leur ordre ni par
// leurs classes (règle CLAUDE.md) : un cours peut masquer la moyenne, la
// pondération ou la rétroaction, et l'ordre des colonnes suit sa configuration.
// Les classes `column-*` de Moodle ne servent que de second recours.
//
// Pur et déterministe (règle `src/core/`) : `DOMParser` est fourni par le
// content script et par happy-dom dans les tests, comme dans `content/extract.ts`.

import type { GradeItem, GradeReport } from "./model";

/** En-têtes de la page StudiUM, tels qu'affichés, → champ de `GradeItem`. */
const HEADERS: ReadonlyArray<readonly [key: keyof GradeItem, labels: readonly string[]]> = [
  ["name", ["element d'evaluation", "grade item"]],
  ["weight", ["ponderation calculee", "calculated weight"]],
  ["grade", ["note", "grade"]],
  ["range", ["valeurs possibles", "range"]],
  ["percentage", ["pourcentage", "percentage"]],
  ["average", ["moyenne", "average"]],
  ["feedback", ["retroaction", "feedback"]],
];

/** Libellés de la ligne de total, dans les deux langues de l'interface. */
const TOTAL_LABELS = ["total du cours", "course total"];

// Contenus à retirer d'une cellule avant d'en lire le texte : ils sont là pour
// le lecteur d'écran ou pour la souris, pas pour l'œil. Sans ça le nom de
// l'activité sortirait « Activité Test Quiz-tp1 » au lieu de « Quiz-tp1 ».
const INVISIBLE = [
  "script",
  "style",
  "img",
  "button",
  "svg",
  ".accesshide",
  ".sr-only",
  ".visually-hidden",
  "[aria-hidden='true']",
  "[role='menu']",
  ".dropdown-menu",
  ".action-menu",
  ".menu",
].join(",");

/** URL d'activité : `…/mod/<type>/view.php?…id=<cmid>`. */
const MODULE_URL_RE = /\/mod\/[a-z0-9_]+\/view\.php\?(?:[^#]*&)?id=\d+/i;

/** `level1`, `level2`… posé par Moodle sur la cellule de nom : la profondeur d'affichage. */
const LEVEL_RE = /\blevel(\d+)\b/;

/**
 * La page du carnet → un rapport, ou `undefined` si aucun tableau de notes n'est
 * reconnu — page de connexion, cours sans carnet, page d'erreur. Rendre un
 * rapport vide serait pire : il effacerait les notes déjà stockées.
 */
export function parseGradeReport(
  html: string,
  course: { id: number; shortname: string; courseCode?: string },
): GradeReport | undefined {
  if (typeof html !== "string" || !html.trim()) return undefined;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return undefined;
  }

  const found = findGradeTable(doc);
  if (!found) return undefined;
  const { table, columns, headerRow } = found;

  const items: GradeItem[] = [];
  let total: GradeItem | undefined;

  for (const row of table.querySelectorAll("tr")) {
    // La ligne d'en-têtes est écartée par identité, pas par sa position : un
    // tableau Moodle sans `<thead>` la met dans le `<tbody>`, et elle sortirait
    // sinon comme un élément nommé « Élément d'évaluation ».
    if (row === headerRow || row.closest("thead")) continue;
    if (row.className.includes("spacer")) continue;
    const cells = [...row.querySelectorAll("th,td")];
    if (cells.length === 0) continue;

    const nameCell = cells[columns.name];
    if (!nameCell) continue;
    const name = readName(nameCell);
    if (!name) continue; // ligne de mise en page, sans intitulé

    const item: GradeItem = { name, grade: readCell(cells[columns.grade]) };
    assign(item, "range", readCell(cells[columns.range]));
    assign(item, "percentage", readCell(cells[columns.percentage]));
    assign(item, "weight", readCell(cells[columns.weight]));
    assign(item, "average", readCell(cells[columns.average]));
    assign(item, "feedback", readCell(cells[columns.feedback]));

    const depth = readDepth(nameCell, row);
    if (depth !== undefined) item.depth = depth;
    const url = readModuleUrl(nameCell);
    if (url) item.url = url;

    if (isTotalRow(name)) total = item;
    else items.push(item);
  }

  if (items.length === 0 && !total) return undefined;

  const report: GradeReport = { studiumCourseId: course.id, shortname: course.shortname, items };
  if (course.courseCode) report.courseCode = course.courseCode;
  if (total) report.total = total;
  return report;
}

// ---------------------------------------------------------------------------
// Détail
// ---------------------------------------------------------------------------

/** Index de colonne par champ ; `-1` quand le cours ne montre pas cette colonne. */
type ColumnIndex = Record<keyof GradeItem, number>;

/**
 * Le tableau de notes est celui dont les en-têtes portent au moins un intitulé
 * d'élément et une note. On les cherche par le texte : l'ordre des colonnes
 * suit la configuration du cours, et une page peut contenir d'autres tableaux.
 */
function findGradeTable(
  doc: Document,
): { table: Element; columns: ColumnIndex; headerRow: Element } | undefined {
  for (const table of doc.querySelectorAll("table")) {
    const headerRow = table.querySelector("thead tr") ?? table.querySelector("tr");
    if (!headerRow) continue;
    const headers = [...headerRow.querySelectorAll("th,td")].map((cell) => normalize(readCell(cell)));
    if (headers.length === 0) continue;

    const columns = mapColumns(headers);
    // Sans intitulé ni note, ce n'est pas un carnet — c'est le tableau de mise
    // en page d'un formulaire de connexion, par exemple.
    if (columns.name < 0 || columns.grade < 0) continue;
    return { table, columns, headerRow };
  }
  return undefined;
}

function mapColumns(headers: string[]): ColumnIndex {
  const columns = {} as ColumnIndex;
  for (const [key] of HEADERS) columns[key] = -1;
  for (const [key, labels] of HEADERS) {
    const index = headers.findIndex((header) => header !== "" && labels.some((label) => header === label));
    if (index >= 0) columns[key] = index;
  }
  return columns;
}

/**
 * Le nom affiché de la ligne. Moodle met dans la même cellule une icône, un
 * intitulé de type pour le lecteur d'écran (« Activité Test ») et, parfois, un
 * menu d'actions. On préfère la div `.rowtitle` qu'il pose autour du nom ;
 * à défaut le lien vers l'activité ; à défaut ce qui reste de texte visible.
 */
function readName(cell: Element): string {
  const clean = cell.cloneNode(true) as Element;
  for (const node of clean.querySelectorAll(INVISIBLE)) node.remove();

  const rowtitle = clean.querySelector(".rowtitle");
  if (rowtitle) {
    const text = squash(rowtitle.textContent ?? "");
    if (text) return text;
  }
  for (const link of clean.querySelectorAll("a[href]")) {
    if (!MODULE_URL_RE.test(link.getAttribute("href") ?? "")) continue;
    const text = squash(link.textContent ?? "");
    if (text) return text;
  }
  return squash(clean.textContent ?? "");
}

/**
 * Le lien vers l'activité, s'il y en a un. Seules les URL de module sont
 * retenues : le menu « Actions » contient un lien d'analyse qui porte le
 * `userid` de l'étudiant, et rien qui identifie une personne ne doit être
 * recopié dans l'état, encore moins dans un export. Les jetons de session
 * (`sesskey`, `authtoken`) sont refusés pour la même raison.
 */
function readModuleUrl(cell: Element): string | undefined {
  for (const link of cell.querySelectorAll("a[href]")) {
    const href = (link.getAttribute("href") ?? "").trim();
    if (!MODULE_URL_RE.test(href)) continue;
    const lower = href.toLowerCase();
    if (lower.includes("userid=") || lower.includes("sesskey=") || lower.includes("authtoken=")) continue;
    if (!lower.startsWith("https://") && !lower.startsWith("http://")) continue;
    return href;
  }
  return undefined;
}

/**
 * Profondeur d'affichage, tirée de la classe `levelN` que Moodle pose sur la
 * cellule de nom. `level1` (la catégorie racine et le total du cours) donne 0,
 * ses enfants 1, une sous-catégorie et ses éléments 2 — c'est le nombre de
 * crans d'indentation, pas une distinction élément/catégorie.
 */
function readDepth(nameCell: Element, row: Element): number | undefined {
  const found = LEVEL_RE.exec(nameCell.className) ?? LEVEL_RE.exec(row.className);
  if (!found?.[1]) return undefined;
  const level = Number(found[1]);
  if (!Number.isFinite(level) || level < 1) return undefined;
  return level - 1;
}

function isTotalRow(name: string): boolean {
  const value = normalize(name);
  return TOTAL_LABELS.some((label) => value === label || value.startsWith(`${label} `));
}

/** Texte visible d'une cellule, espaces normalisés. Chaîne vide si la cellule est vide. */
function readCell(cell: Element | undefined): string {
  if (!cell) return "";
  const clean = cell.cloneNode(true) as Element;
  for (const node of clean.querySelectorAll(INVISIBLE)) node.remove();
  return squash(clean.textContent ?? "");
}

function assign(item: GradeItem, key: "range" | "percentage" | "weight" | "average" | "feedback", value: string): void {
  if (value) item[key] = value;
}

/** Espaces réduits à un seul, bords rognés. En JS, `\s` couvre l'insécable, dont Moodle abuse. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Pour comparer des libellés : minuscules, accents et apostrophes neutralisés. */
function normalize(text: string): string {
  return squash(text)
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/['’]/g, "'")
    .toLowerCase();
}
