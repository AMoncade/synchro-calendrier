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

// ---------------------------------------------------------------------------
// Échéances (phase 12, 2026-09-10) : quiz et devoirs StudiUM, événements ajoutés
// à la main. Distinctes des séances (récurrentes) et des examens (Synchro) :
// une échéance est un instant qui compte, avec une fenêtre optionnelle avant.
// Voir docs/ARCHITECTURE.md §7.
// ---------------------------------------------------------------------------

export type DeadlineSource = "studium" | "manuel";

export type DeadlineKind = "quiz" | "devoir" | "evenement" | "autre";

/** Instant local "AAAA-MM-JJTHH:MM" (America/Toronto), sans secondes ni fuseau. */
export type LocalDateTime = string;

export interface Deadline {
  /**
   * Identifiant stable d'une synchronisation à l'autre. StudiUM :
   * `studium:<cmid>` (id du module dans l'URL `view.php?id=`), sinon
   * `studium:<courseid>:<nom d'activité normalisé>`. Manuel : `manuel:<uuid>`.
   */
  id: string;
  source: DeadlineSource;
  /** Sigle Synchro déduit ("MAT1400") ; absent si non lié. Le popup peut le surcharger via `courseLinks`. */
  courseCode?: string;
  /** Id du site StudiUM d'origine (`courseid` Moodle), pour l'écran de liaison. */
  studiumCourseId?: number;
  /** Nom affiché : "Quiz-tp3", "Devoir 1", "Rendez-vous TGDE". */
  title: string;
  kind: DeadlineKind;
  /** Début de la fenêtre (quiz « s'ouvre ») ou début d'un événement manuel. */
  start?: LocalDateTime;
  /** L'instant qui compte : fermeture du quiz, remise, fin de l'événement. */
  due: LocalDateTime;
  location?: string;
  /** Lien direct vers l'activité (StudiUM) ; jamais de jeton dedans. */
  url?: string;
  note?: string;
}

/** Un site de cours StudiUM tel que vu lors de la dernière synchronisation. */
export interface StudiumCourse {
  id: number;
  /** "MAT1400-AB-A26" — clé de jointure ; `idnumber` est vide sur les sites -AB. */
  shortname: string;
  fullname: string;
  /** Sigle déduit du shortname ("MAT1400"), ou absent si le motif ne colle pas. */
  courseCode?: string;
}

// ---------------------------------------------------------------------------
// Capture brute StudiUM : ce que content/studium.ts tire de l'API AJAX de
// Moodle (`/lib/ajax/service.php`, méthode core_calendar_get_calendar_monthly_view)
// avant tout parsing. Champs tels que renvoyés par Moodle 4.x ; tout ce qui
// n'est pas listé est ignoré. Les instants `timestart` sont des secondes Unix.
// ---------------------------------------------------------------------------

export interface RawMoodleEvent {
  id: number;
  name: string; // "Quiz-tp3 s'ouvre"
  description?: string;
  eventtype: string; // "open" | "close" | "due" | "user" | "course" | …
  timestart: number; // secondes Unix
  timeduration: number; // 0 pour les quiz
  modulename?: string | null; // "quiz", "assign", …
  component?: string | null;
  activityname?: string | null; // "Quiz-tp3"
  /** PARAM_RAW côté Moodle, optionnel, souvent vide ; recopié dans Deadline.location (2026-09-10, patch adrie-29). */
  location?: string | null;
  url?: string; // "https://studium.umontreal.ca/mod/quiz/view.php?id=6624079"
  course?: { id: number; shortname: string; fullname: string; idnumber?: string } | null;
}

// ---------------------------------------------------------------------------
// Carnet de notes StudiUM (phase 13, 2026-09-10, opt-in). Lu dans
// /grade/report/user/index.php?id=<courseid>, gardé tel qu'affiché (chaînes
// Moodle : « 8,50 », « 0–10 », « 85,00 % »), jamais recalculé. Voir ARCHITECTURE §8.
// ---------------------------------------------------------------------------

export interface GradeItem {
  /** « Test de connaissances préliminaires », « Quiz-tp3 ». */
  name: string;
  /** Note telle qu'affichée, "-" si non publiée. */
  grade: string;
  /** « 0–10 » (Valeurs possibles). */
  range?: string;
  /** « 85,00 % ». */
  percentage?: string;
  /** Pondération calculée. */
  weight?: string;
  /** Moyenne du groupe, si le cours l'expose. */
  average?: string;
  feedback?: string;
  /** Profondeur dans le carnet (0 = élément, 1+ = catégorie), pour l'indentation. */
  depth?: number;
  /** Lien vers l'activité, sans jeton. */
  url?: string;
}

export interface GradeReport {
  studiumCourseId: number;
  /** "MAT1600-AB-A26" */
  shortname: string;
  courseCode?: string;
  items: GradeItem[];
  /** Ligne « Total du cours », si présente. */
  total?: GradeItem;
}

export interface RawStudiumCapture {
  /** Mois interrogés, "AAAA-MM", dans l'ordre. */
  months: string[];
  events: RawMoodleEvent[];
  /** Sites vus dans les événements ou par core_course_get_enrolled_courses_by_timeline_classification. */
  courses: Array<{ id: number; shortname: string; fullname: string; idnumber?: string }>;
}
