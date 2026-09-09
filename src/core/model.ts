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
