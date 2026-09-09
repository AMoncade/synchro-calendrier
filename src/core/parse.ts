// Parser : capture brute (texte tel qu'affiché par Synchro) → Schedule.
// Pur et déterministe : aucune API navigateur, aucun Date.now(). Les formats
// reconnus sont ceux observés dans tests/fixtures (docs/ARCHITECTURE.md §5).

import { getTermCalendar, inferTermCode } from "./calendar-udem";
import {
  SCHEMA_VERSION,
  type Component,
  type Course,
  type Exam,
  type ExamKind,
  type Meeting,
  type RawCapture,
  type RawCourseBlock,
  type RawMeetingRow,
  type Schedule,
  type Term,
  type Weekday,
} from "./model";

/**
 * Synchro affiche les fins de séance en « :29 » (10:29) pour éviter le
 * chevauchement visuel avec la séance suivante. On arrondit à la minute
 * supérieure (10:30) : c'est ce qu'un étudiant écrirait dans son agenda.
 */
export const ROUND_END_TO_HALF_HOUR = true;

export interface ParseOptions {
  /** Instant de la capture, ISO 8601 ; sert aussi de repli pour deviner le trimestre. */
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Briques élémentaires (exportées pour les tests)
// ---------------------------------------------------------------------------

const WEEKDAYS: Record<string, Weekday> = {
  l: 1, lu: 1, lun: 1, lundi: 1,
  ma: 2, mar: 2, mardi: 2,
  me: 3, mer: 3, mercredi: 3,
  j: 4, je: 4, jeu: 4, jeudi: 4,
  v: 5, ve: 5, ven: 5, vendredi: 5,
  s: 6, sa: 6, sam: 6, samedi: 6,
  d: 7, di: 7, dim: 7, dimanche: 7,
};

const TIME_RANGE = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/;
const DATE_DMY = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
const COURSE_CODE = /^([A-Z]{2,4})\s?(\d{4}[A-Z]?)/;
const TERM_LABEL = /^(Automne|Hiver|Été|Ete)\s+(\d{4})/i;

export function normalizeSpaces(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** « 8:30 » → « 08:30 ». */
export function normalizeTime(h: string, m: string): string {
  return `${h.padStart(2, "0")}:${m}`;
}

/** « 10:29 » → « 10:30 » quand ROUND_END_TO_HALF_HOUR ; « 10:30 » reste « 10:30 ». */
export function roundEnd(time: string): string {
  if (!ROUND_END_TO_HALF_HOUR) return time;
  const [h, m] = time.split(":").map(Number) as [number, number];
  if (m % 10 !== 9) return time;
  const total = h * 60 + m + 1;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface DaysTimes {
  /** undefined quand le jour n'est pas fixé (« À communiquer 08:30 - 10:29 »). */
  weekday: Weekday | undefined;
  start: string;
  end: string;
}

/** « Ma 08:30 - 10:29 » → { weekday: 2, start: "08:30", end: "10:30" } ; null si aucune plage horaire. */
export function parseDaysTimes(text: string): DaysTimes | null {
  const s = normalizeSpaces(text);
  const m = TIME_RANGE.exec(s);
  if (!m) return null;
  const [, h1, m1, h2, m2] = m as unknown as [string, string, string, string, string];
  const prefix = s.slice(0, m.index).trim().toLowerCase().replace(/\.$/, "");
  const weekday = WEEKDAYS[prefix];
  return { weekday, start: normalizeTime(h1, m1), end: roundEnd(normalizeTime(h2, m2)) };
}

/** « 31/08/2026 - 16/10/2026 » → { start, end } ISO ; « 26/10/2026 » → start = end ; null si aucune date. */
export function parseDateRange(text: string): { start: string; end: string } | null {
  const dates: string[] = [];
  for (const m of normalizeSpaces(text).matchAll(DATE_DMY)) {
    const [, d, mo, y] = m as unknown as [string, string, string, string];
    dates.push(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }
  const start = dates[0];
  if (!start) return null;
  return { start, end: dates[1] ?? start };
}

/** « MAT 1400 - Calcul 1 » → { code: "MAT1400", title: "Calcul 1" } ; « MAT 1400 » → titre vide. */
export function parseCourseTitle(text: string): { code: string; title: string } | null {
  const s = normalizeSpaces(text);
  const m = COURSE_CODE.exec(s);
  if (!m) return null;
  const code = `${m[1]}${m[2]}`;
  const rest = s.slice(m[0].length).replace(/^\s*[-–:]\s*/, "").trim();
  return { code, title: rest };
}

/** « Automne 2026 | Premier cycle | … » → "A26" ; undefined si non reconnu. */
export function termCodeFromLabel(label: string): string | undefined {
  const m = TERM_LABEL.exec(normalizeSpaces(label));
  if (!m) return undefined;
  const season = (m[1] as string).toLowerCase();
  const letter = season.startsWith("a") ? "A" : season.startsWith("h") ? "H" : "E";
  return `${letter}${(m[2] as string).slice(2)}`;
}

export function componentOf(volet: string): Component {
  const v = volet.trim().toUpperCase();
  if (v === "TH") return "TH";
  if (v === "TP") return "TP";
  if (v === "LAB" || v === "LABO") return "LAB";
  return "AUTRE";
}

function examKindOf(volet: string): ExamKind | null {
  const v = volet.trim().toUpperCase();
  if (v === "EXI") return "intra";
  if (v === "EXF") return "final";
  if (v.startsWith("EX")) return "autre";
  return null;
}

function examLabel(kind: ExamKind, volet: string): string {
  if (kind === "intra") return "Examen intra";
  if (kind === "final") return "Examen final";
  return `Examen (${volet.trim()})`;
}

// ---------------------------------------------------------------------------
// Capture → Schedule
// ---------------------------------------------------------------------------

function resolveTerm(raw: RawCapture, opts: ParseOptions, dates: string[]): Term {
  const code =
    termCodeFromLabel(raw.termLabel) ??
    (dates[0] ? inferTermCode(dates[0]) : undefined) ??
    inferTermCode(opts.capturedAt.slice(0, 10));
  const cal = code ? getTermCalendar(code) : undefined;
  if (cal) return cal.term;
  const sorted = [...dates].sort();
  const start = sorted[0] ?? opts.capturedAt.slice(0, 10);
  const end = sorted[sorted.length - 1] ?? start;
  return { code: code ?? "", label: code ? labelFromCode(code) : "Trimestre inconnu", start, end };
}

function labelFromCode(code: string): string {
  const season = code.startsWith("A") ? "Automne" : code.startsWith("H") ? "Hiver" : "Été";
  return `${season} 20${code.slice(1)}`;
}

/** Bornes par défaut des séances quand la page ne donne pas de dates (Centre étudiant). */
function defaultRange(termCode: string, term: Term): { start: string; end: string } {
  const cal = getTermCalendar(termCode);
  return {
    start: cal?.classesStart ?? term.start,
    end: cal?.classesEnd ?? term.end,
  };
}

interface Inherited {
  classNumber: string;
  section: string;
  component: string;
}

export function parseCapture(raw: RawCapture, opts: ParseOptions): Schedule {
  const allDates: string[] = [];
  for (const b of raw.blocks) for (const r of b.rows) {
    const d = parseDateRange(r.dates);
    if (d) allDates.push(d.start, d.end);
  }
  const term = resolveTerm(raw, opts, allDates);
  const fallback = defaultRange(term.code, term);

  const courses: Course[] = [];
  const exams: Exam[] = [];

  for (const block of raw.blocks) {
    const head = parseCourseTitle(block.title);
    if (!head) continue;
    const byKey = new Map<string, Course>();
    const inherited: Inherited = { classNumber: "", section: "", component: "" };
    const notes: string[] = [];

    for (const row of block.rows) {
      const volet = row.component.trim();
      const kind = examKindOf(volet);
      if (kind) {
        pushExam(exams, head.code, kind, volet, row);
        continue;
      }
      if (row.classNumber.trim() || row.section.trim() || volet) {
        inherited.classNumber = row.classNumber.trim() || inherited.classNumber;
        inherited.section = row.section.trim() || inherited.section;
        inherited.component = volet || inherited.component;
      }
      const component = componentOf(inherited.component);
      const key = `${inherited.section}|${component}`;
      let course = byKey.get(key);
      if (!course) {
        course = {
          code: head.code,
          title: head.title,
          section: inherited.section,
          component,
          meetings: [],
        };
        if (inherited.classNumber) course.classNumber = inherited.classNumber;
        byKey.set(key, course);
      }
      const dt = parseDaysTimes(row.daysTimes);
      const location = normalizeSpaces(row.location);
      if (!dt) {
        // Ligne sans plage horaire (ex. « En ligne » seul sur le Centre étudiant).
        if (location) notes.push(`${course.section ? `Section ${course.section}` : head.code} : ${location}`);
        continue;
      }
      const range = parseDateRange(row.dates) ?? fallback;
      if (dt.weekday === undefined) {
        const where = location ? ` (${location})` : "";
        notes.push(`Séance ${component} ${dt.start}–${dt.end}, jour à communiquer${where}`);
        continue;
      }
      const meeting: Meeting = {
        weekday: dt.weekday,
        start: dt.start,
        end: dt.end,
        location,
        dateStart: range.start,
        dateEnd: range.end,
      };
      course.meetings.push(meeting);
    }

    for (const c of byKey.values()) {
      const own = dedupe(notes.concat(block.notes.map(normalizeSpaces).filter(Boolean)));
      if (own.length) c.notes = own;
      courses.push(c);
    }
  }

  exams.sort((a, b) => (a.date + a.start + a.courseCode).localeCompare(b.date + b.start + b.courseCode));

  return { schemaVersion: SCHEMA_VERSION, capturedAt: opts.capturedAt, term, courses, exams };
}

function pushExam(exams: Exam[], courseCode: string, kind: ExamKind, volet: string, row: RawMeetingRow): void {
  const dt = parseDaysTimes(row.daysTimes);
  const range = parseDateRange(row.dates);
  if (!dt || !range) return;
  exams.push({
    courseCode,
    kind,
    date: range.start,
    start: dt.start,
    end: dt.end,
    location: normalizeSpaces(row.location),
    label: examLabel(kind, volet),
  });
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Repli « Coller mon horaire » : texte sélectionné-copié depuis Synchro → RawCapture.
// Reconnaît le texte de la page « Votre horaire cours » (étiquette puis valeur
// sur la ligne suivante) et celui du Centre étudiant (« MAT 1400-A » / « TH (1490) »
// suivis de paires heure / local).
// ---------------------------------------------------------------------------

const LISTE_LABELS = ["Nº cours", "Section", "Volet", "Jours et heures", "Local", "Enseignant", "Dates début/fin", "URL"] as const;
type ListeLabel = (typeof LISTE_LABELS)[number];
const LABEL_TO_FIELD: Record<ListeLabel, keyof RawMeetingRow> = {
  "Nº cours": "classNumber",
  Section: "section",
  Volet: "component",
  "Jours et heures": "daysTimes",
  Local: "location",
  Enseignant: "instructor",
  "Dates début/fin": "dates",
  URL: "url",
};
const COURSE_TITLE_LINE = /^[A-Z]{2,4} \d{4}[A-Z]? - .+/;
const CENTRE_COURSE_LINE = /^[A-Z]{2,4} \d{4}[A-Z]?-[A-Z]\d*$/;
// « TH (1490) », éventuellement suivi d'une autre cellule (« TH (1490) Horaire » après collage).
const CENTRE_COMPONENT_LINE = /^([A-Z]{2,4}) \((\d+)\)(?:\s|$)/;

function emptyRow(): RawMeetingRow {
  return { classNumber: "", section: "", component: "", daysTimes: "", location: "", instructor: "", dates: "", url: "" };
}

function isLabel(line: string): line is ListeLabel {
  return (LISTE_LABELS as readonly string[]).includes(line);
}

export function textToCapture(text: string): RawCapture {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\t/g, " ").replace(/ /g, " ").trim());
  const termLine = lines.find((l) => TERM_LABEL.test(l)) ?? "";
  const termLabel = termLine ? normalizeSpaces(termLine) : "";

  if (lines.some((l) => COURSE_TITLE_LINE.test(l) && !l.includes("|"))) {
    return { source: "liste", termLabel, blocks: parseListeText(lines) };
  }
  return { source: "centre", termLabel: "", blocks: parseCentreText(lines) };
}

function parseListeText(lines: string[]): RawCourseBlock[] {
  const blocks: RawCourseBlock[] = [];
  let block: RawCourseBlock | null = null;
  let row: RawMeetingRow | null = null;
  let inNotes = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (COURSE_TITLE_LINE.test(line) && !line.includes("|")) {
      block = { title: normalizeSpaces(line), rows: [], notes: [] };
      blocks.push(block);
      row = null;
      inNotes = false;
      continue;
    }
    if (!block) continue;
    if (line === "Remarques cours") {
      inNotes = true;
      row = null;
      continue;
    }
    if (inNotes) {
      // Les remarques sont des phrases ; les jetons courts (nº, section, volet) sont ignorés.
      if (line.length > 12) block.notes.push(normalizeSpaces(line));
      continue;
    }
    if (isLabel(line)) {
      if (line === "Nº cours") {
        row = emptyRow();
        block.rows.push(row);
      }
      if (!row) continue;
      const next = lines[i + 1] ?? "";
      if (next && !isLabel(next) && !COURSE_TITLE_LINE.test(next) && next !== "Remarques cours") {
        row[LABEL_TO_FIELD[line]] = normalizeSpaces(next);
        i++;
      }
    }
  }
  return blocks;
}

function parseCentreText(lines: string[]): RawCourseBlock[] {
  const blocks: RawCourseBlock[] = [];
  let block: RawCourseBlock | null = null;
  let section = "";
  let component = "";
  let classNumber = "";
  let pendingTime = "";

  const flush = (location: string) => {
    if (!block) return;
    block.rows.push({ classNumber, section, component, daysTimes: pendingTime, location, instructor: "", dates: "", url: "" });
    pendingTime = "";
  };

  for (const raw of lines) {
    const line = normalizeSpaces(raw);
    if (!line) continue;
    const course = CENTRE_COURSE_LINE.exec(line);
    if (course) {
      if (pendingTime) flush("");
      const [codePart, sec] = line.split("-") as [string, string];
      block = { title: codePart.trim(), rows: [], notes: [] };
      blocks.push(block);
      section = sec.trim();
      component = "";
      classNumber = "";
      continue;
    }
    if (!block) continue;
    const comp = CENTRE_COMPONENT_LINE.exec(line);
    if (comp && !component) {
      component = comp[1] as string;
      classNumber = comp[2] as string;
      continue;
    }
    if (TIME_RANGE.test(line)) {
      if (pendingTime) flush("");
      pendingTime = line;
      continue;
    }
    if (/^(Dates limites|SGA|Cours|Horaire|DATES LIMITES|COURS|HORAIRE|Voir «)/.test(line)) continue;
    // Ligne de local : suit une heure, ou « En ligne » seul.
    if (pendingTime) flush(line);
    else if (/^En ligne$/i.test(line)) flush(line);
  }
  if (pendingTime) flush("");
  return blocks;
}

/** Texte collé par l'étudiant → Schedule (mêmes règles que la capture DOM). */
export function parsePastedText(text: string, opts: ParseOptions): Schedule {
  return parseCapture(textToCapture(text), opts);
}
