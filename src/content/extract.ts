// Extraction DOM : page Synchro → RawCapture (texte brut, aucun parsing).
// Les tableaux sont localisés par le texte de leurs en-têtes, jamais par les id
// PeopleSoft. Structure observée le 2026-09-09 : docs/ARCHITECTURE.md §5.

import type { RawCapture, RawCourseBlock, RawMeetingRow } from "../core/model";

const LISTE_HEADERS: Record<string, keyof RawMeetingRow> = {
  "nº cours": "classNumber",
  "no cours": "classNumber",
  "n° cours": "classNumber",
  section: "section",
  volet: "component",
  "jours et heures": "daysTimes",
  local: "location",
  enseignant: "instructor",
  "dates début/fin": "dates",
  url: "url",
};
const TERM_LABEL = /^(Automne|Hiver|Été|Ete)\s+\d{4}/i;
const TIME_RANGE = /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/;
const CENTRE_COURSE = /^([A-Z]{2,4}\s?\d{4}[A-Z]?)-([A-Z]\d*)$/;
const CENTRE_COMPONENT = /^([A-Z]{2,4})\s*\((\d+)\)$/;

export function normalize(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Lignes de texte d'une cellule : `<br>` et blocs séparent, l'étiquette responsive est ignorée. */
function cellLines(cell: Element): string[] {
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    const t = normalize(current);
    if (t) parts.push(t);
    current = "";
  };
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      current += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.classList.contains("ui-table-cell-label") || el.classList.contains("sr-only")) return;
    const tag = el.tagName;
    if (tag === "BR") {
      flush();
      return;
    }
    const block = tag === "DIV" || tag === "P" || tag === "TR" || tag === "LI";
    if (block) flush();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) flush();
  };
  walk(cell);
  flush();
  return parts;
}

function cellText(cell: Element): string {
  return cellLines(cell).join(" ");
}

function headerTexts(table: HTMLTableElement): string[] {
  const head = table.tHead ?? table;
  return Array.from(head.querySelectorAll("th")).map((th) => normalize(th.textContent ?? "").toLowerCase());
}

/** Tableaux dont les en-têtes propres (pas ceux de tableaux imbriqués) contiennent tous les libellés voulus. */
function tablesWithHeaders(doc: Document, required: string[]): HTMLTableElement[] {
  const out: HTMLTableElement[] = [];
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const ownHeaders = Array.from(table.querySelectorAll("th")).filter((th) => th.closest("table") === table);
    if (ownHeaders.length === 0) continue;
    const texts = ownHeaders.map((th) => normalize(th.textContent ?? "").toLowerCase());
    if (required.every((r) => texts.some((t) => t === r || t.startsWith(r)))) out.push(table);
  }
  return out;
}

function dataRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.rows).filter((row) => row.closest("table") === table && row.cells.length > 1 && !row.querySelector("th"));
}

function precedingHeading(doc: Document, node: Node): string {
  const headings = Array.from(doc.querySelectorAll("h1, h2, h3, .PAGROUPDIVIDER"));
  let best = "";
  for (const h of headings) {
    if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) best = normalize(h.textContent ?? "");
  }
  return best;
}

function termLabel(doc: Document): string {
  for (const el of Array.from(doc.querySelectorAll("span, div, td, h1, h2"))) {
    if (el.children.length > 0) continue;
    const t = normalize(el.textContent ?? "");
    if (TERM_LABEL.test(t) && t.includes("|")) return t;
  }
  for (const el of Array.from(doc.querySelectorAll("span.PABOLDTEXT"))) {
    const t = normalize(el.textContent ?? "");
    if (TERM_LABEL.test(t)) return t;
  }
  return "";
}

export function detectPage(doc: Document): "liste" | "centre" | null {
  if (tablesWithHeaders(doc, ["jours et heures", "dates début/fin"]).length > 0) return "liste";
  if (tablesWithHeaders(doc, ["cours", "horaire"]).length > 0) return "centre";
  return null;
}

function extractListe(doc: Document): RawCapture {
  const blocks: RawCourseBlock[] = [];
  const notesByTitle = new Map<string, string[]>();

  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const first = table.rows[0]?.cells[0];
    if (!first || table.rows.length < 2 || normalize(first.textContent ?? "") !== "Remarques cours") continue;
    if (first.closest("table") !== table) continue;
    const title = precedingHeading(doc, table);
    const notes = notesByTitle.get(title) ?? [];
    for (const row of Array.from(table.rows).slice(1)) {
      if (row.closest("table") !== table || row.cells.length < 4) continue;
      const text = cellText(row.cells[row.cells.length - 1] as Element);
      if (text) notes.push(text);
    }
    notesByTitle.set(title, notes);
  }

  for (const table of tablesWithHeaders(doc, ["jours et heures", "dates début/fin"])) {
    const headers = headerTexts(table);
    const fields = headers.map((h) => LISTE_HEADERS[h]);
    const title = precedingHeading(doc, table);
    const rows: RawMeetingRow[] = [];
    for (const row of dataRows(table)) {
      if (row.cells.length !== headers.length) continue;
      const out: RawMeetingRow = { classNumber: "", section: "", component: "", daysTimes: "", location: "", instructor: "", dates: "", url: "" };
      Array.from(row.cells).forEach((cell, i) => {
        const field = fields[i];
        // La colonne URL (icône « SGA ») ne porte aucune donnée d'horaire : ignorée.
        if (field && field !== "url") out[field] = cellText(cell);
      });
      rows.push(out);
    }
    blocks.push({ title, rows, notes: notesByTitle.get(title) ?? [] });
  }

  return { source: "liste", termLabel: termLabel(doc), blocks };
}

function extractCentre(doc: Document): RawCapture {
  const blocks: RawCourseBlock[] = [];
  for (const table of tablesWithHeaders(doc, ["cours", "horaire"])) {
    const headers = headerTexts(table);
    const coursIdx = headers.findIndex((h) => h.startsWith("cours"));
    const horaireIdx = headers.findIndex((h) => h.startsWith("horaire"));
    if (coursIdx < 0 || horaireIdx < 0) continue;
    for (const row of dataRows(table)) {
      if (row.cells.length !== headers.length) continue;
      const coursLines = cellLines(row.cells[coursIdx] as Element);
      const course = CENTRE_COURSE.exec(coursLines[0] ?? "");
      if (!course) continue;
      const comp = CENTRE_COMPONENT.exec(coursLines[1] ?? "");
      const base = {
        classNumber: comp?.[2] ?? "",
        section: course[2] as string,
        component: comp?.[1] ?? "",
        instructor: "",
        dates: "",
        url: "",
      };
      const rows: RawMeetingRow[] = [];
      let pending = "";
      for (const line of cellLines(row.cells[horaireIdx] as Element)) {
        if (TIME_RANGE.test(line)) {
          if (pending) rows.push({ ...base, daysTimes: pending, location: "" });
          pending = line;
        } else if (pending) {
          rows.push({ ...base, daysTimes: pending, location: line });
          pending = "";
        } else {
          rows.push({ ...base, daysTimes: "", location: line });
        }
      }
      if (pending) rows.push({ ...base, daysTimes: pending, location: "" });
      blocks.push({ title: (course[1] as string).replace(/\s+/g, " "), rows, notes: [] });
    }
  }
  return { source: "centre", termLabel: "", blocks };
}

export function extractCapture(doc: Document): RawCapture | null {
  const page = detectPage(doc);
  if (page === "liste") return extractListe(doc);
  if (page === "centre") return extractCentre(doc);
  return null;
}
