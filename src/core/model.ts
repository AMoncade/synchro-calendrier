// Contrat de données de l'extension (docs/ARCHITECTURE.md §2).
// Toutes les heures sont locales (America/Toronto), format "HH:MM" ; les dates "AAAA-MM-JJ".

export const SCHEMA_VERSION = 1 as const;

/** 1 = lundi … 7 = dimanche (ISO 8601). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Component = "TH" | "TP" | "LAB" | "AUTRE";

export interface Meeting {
  weekday: Weekday;
  start: string;
  end: string;
  location: string;
  dateStart: string;
  dateEnd: string;
  note?: string;
}

export interface Course {
  code: string; // ex. "MAT1400"
  title: string;
  section: string;
  classNumber?: string;
  component: Component;
  meetings: Meeting[];
  /** Séances annoncées sans jour fixe (« à déterminer »). */
  notes?: string[];
}

export type ExamKind = "intra" | "final" | "autre";

export interface Exam {
  courseCode: string;
  kind: ExamKind;
  date: string;
  start: string;
  end: string;
  location: string;
  label: string;
}

export interface Term {
  code: string; // ex. "A26"
  label: string; // ex. "Automne 2026"
  start: string;
  end: string;
}

export interface Schedule {
  schemaVersion: typeof SCHEMA_VERSION;
  capturedAt: string; // ISO 8601, fourni par l'appelant
  term: Term;
  courses: Course[];
  exams: Exam[];
}

export type ConflictKind = "cours-cours" | "cours-examen" | "examen-examen";

export interface Conflict {
  kind: ConflictKind;
  a: string;
  b: string;
  date: string;
  start: string;
  end: string;
}

/**
 * Une séance ou un examen ramené à une date concrète (après expansion des
 * récurrences et retrait des exclusions). C'est l'unité commune du générateur
 * ICS et du détecteur de conflits.
 */
export interface Occurrence {
  kind: "cours" | "examen";
  /** ex. "MAT1400" */
  courseCode: string;
  /** Texte affichable : "MAT 1400-A Calcul 1 (TH)" ou "MAT 1400 — Examen intra". */
  label: string;
  date: string;
  start: string;
  end: string;
  location: string;
}

// ---------------------------------------------------------------------------
// Capture brute : ce que content/extract.ts tire du DOM de Synchro, avant tout
// parsing. Uniquement du texte, tel qu'affiché (voir docs/ARCHITECTURE.md §5).
// ---------------------------------------------------------------------------

/**
 * Une rangée du tableau « Nº cours | Section | Volet | Jours et heures | Local |
 * Enseignant | Dates début/fin | URL ». Les rangées de continuation ont
 * classNumber/section/component vides et héritent de la rangée précédente.
 * Sur la page Centre étudiant, `dates`, `instructor` et `url` sont vides.
 */
export interface RawMeetingRow {
  classNumber: string; // "1490" ou ""
  section: string; // "A", "A102" ou ""
  component: string; // "TH", "TP", "EXI", "EXF" ou ""
  daysTimes: string; // "Ma 08:30 - 10:29", "À communiquer 08:30 - 10:29"
  location: string; // "E-310 Pav. Roger-Gaudry", "En ligne"
  instructor: string; // "Nom Prénom", "À communiquer" ou ""
  dates: string; // "31/08/2026 - 16/10/2026", "26/10/2026" ou ""
  url: string; // "SGA" ou ""
}

/** Un bloc de cours : titre `<h2>` + rangées + remarques. */
export interface RawCourseBlock {
  title: string; // "MAT 1400 - Calcul 1" (liste) ou "MAT 1400" (centre étudiant)
  rows: RawMeetingRow[];
  notes: string[];
}

export interface RawCapture {
  /** Page d'origine : "liste" = Votre horaire cours (complet), "centre" = Centre étudiant (résumé). */
  source: "liste" | "centre";
  /** "Automne 2026 | Premier cycle | Université de Montréal" ou "" si absent. */
  termLabel: string;
  blocks: RawCourseBlock[];
}
