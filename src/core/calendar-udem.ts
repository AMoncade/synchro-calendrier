// Calendrier universitaire de l'UdeM : bornes des trimestres, relâche, congés.
// Données codées en dur, vérifiées à la main sur les sources citées. Tout est
// pur et déterministe (aucun Date.now()) : les dates sont des chaînes
// "AAAA-MM-JJ", les comparaisons sont lexicographiques.
//
// Règle de provenance :
//   - `term`, `breakStart/End`, `holidays` : calendrier universitaire du
//     Bureau du registraire (s'applique à toute l'université).
//   - `classesStart/End`, `examsStart/End` : le registraire ne publie ni le
//     dernier jour de cours ni la période d'examens ; ces dates viennent du
//     calendrier facultaire cité dans `facultySource` (FAS pour A26/H27).
//     Une autre faculté peut différer.
//   - Date introuvable → `null` + TODO daté, jamais une supposition.

import type { Term } from "./model";

export interface Holiday {
  date: string;
  label: string;
}

export interface TermCalendar {
  term: Term;
  /** Premier jour de cours (calendrier facultaire, sinon rentrée du registraire). */
  classesStart: string | null;
  /** Dernier jour de cours (calendrier facultaire). */
  classesEnd: string | null;
  examsStart: string | null;
  examsEnd: string | null;
  /** Semaine d'activités libres (relâche), bornes incluses ; `null` si aucune. */
  breakStart: string | null;
  breakEnd: string | null;
  /** Jours sans cours : congés universitaires et journées « aucune activité d'enseignement ». */
  holidays: Holiday[];
  /** URL du calendrier universitaire (registraire) ayant servi de source principale. */
  source: string;
  /** URL du calendrier facultaire ayant fourni les dates de cours et d'examens, s'il y a lieu. */
  facultySource?: string;
  /** Date de consultation des sources, "AAAA-MM-JJ". */
  verifiedOn: string;
}

const REGISTRAIRE_2026_2027 =
  "https://registraire.umontreal.ca/fileadmin/registrariat/documents/calendriers/2026-2027_calendrier.pdf";
const FAS_A26_H27 =
  "https://fas.umontreal.ca/public/FAS/fas/Documents/Calendrier/Calendrier_etudes_FAS_A26-H27.pdf";
const VERIFIED_ON = "2026-09-09";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Développe un intervalle inclusif "AAAA-MM-JJ" en une entrée par jour. */
function spanHolidays(from: string, to: string, label: string): Holiday[] {
  return eachDay(from, to).map((date) => ({ date, label }));
}

const CALENDARS: readonly TermCalendar[] = [
  // ---------------------------------------------------------------------------
  // Automne 2026 — source : calendrier universitaire 2026-2027 du registraire
  // (REGISTRAIRE_2026_2027), consulté le 2026-09-09. Le registraire donne :
  //   mardi 1er septembre 2026   rentrée des personnes étudiantes
  //   lundi 7 septembre          congé – fête du Travail
  //   mercredi 30 septembre      congé – Journée nationale de la vérité et de la réconciliation
  //   lundi 12 octobre           congé – Action de grâce
  //   du lundi 19 au dimanche 25 octobre   période d'activités libres « dans certaines unités »
  //   mercredi 23 décembre       fin du trimestre
  //   du jeudi 24 décembre 2026 au lundi 4 janvier 2027   congés – fêtes de fin d'année
  // Dates de cours et d'examens : calendrier des études FAS 2026-2027
  // (FAS_A26_H27), consulté le 2026-09-09 : premier jour de cours lundi
  // 31 août 2026 (un jour AVANT la rentrée du registraire), dernier jour de
  // cours mercredi 9 décembre, journées d'examens du jeudi 10 au mercredi
  // 23 décembre. La FAS marque aussi le lundi 5 octobre 2026 « Journée des
  // élections provinciales – aucune activité d'enseignement » ; ce jour
  // n'est PAS un congé universitaire chez le registraire.
  // ---------------------------------------------------------------------------
  {
    term: { code: "A26", label: "Automne 2026", start: "2026-09-01", end: "2026-12-23" },
    classesStart: "2026-08-31",
    classesEnd: "2026-12-09",
    examsStart: "2026-12-10",
    examsEnd: "2026-12-23",
    breakStart: "2026-10-19",
    breakEnd: "2026-10-25",
    holidays: [
      { date: "2026-09-07", label: "Fête du Travail" },
      { date: "2026-09-30", label: "Journée nationale de la vérité et de la réconciliation" },
      {
        date: "2026-10-05",
        label: "Journée des élections provinciales – aucune activité d'enseignement (calendrier FAS)",
      },
      { date: "2026-10-12", label: "Action de grâce" },
      ...spanHolidays("2026-12-24", "2026-12-31", "Fêtes de fin d'année"),
    ],
    source: REGISTRAIRE_2026_2027,
    facultySource: FAS_A26_H27,
    verifiedOn: VERIFIED_ON,
  },

  // ---------------------------------------------------------------------------
  // Hiver 2027 — source : calendrier universitaire 2026-2027 du registraire
  // (REGISTRAIRE_2026_2027), consulté le 2026-09-09. Le registraire donne :
  //   du jeudi 24 décembre 2026 au lundi 4 janvier 2027   congés – fêtes de fin d'année
  //   jeudi 7 janvier 2027       rentrée des personnes étudiantes
  //   du lundi 1er au dimanche 7 mars   période d'activités libres « dans certaines unités »
  //   vendredi 26 et lundi 29 mars      congés de Pâques
  //   vendredi 30 avril          fin du trimestre
  // Dates de cours et d'examens : FAS_A26_H27, consulté le 2026-09-09 :
  // premier jour de cours jeudi 7 janvier, dernier jour de cours vendredi
  // 16 avril, journées d'examens du samedi 17 au vendredi 30 avril 2027.
  // ---------------------------------------------------------------------------
  {
    term: { code: "H27", label: "Hiver 2027", start: "2027-01-07", end: "2027-04-30" },
    classesStart: "2027-01-07",
    classesEnd: "2027-04-16",
    examsStart: "2027-04-17",
    examsEnd: "2027-04-30",
    breakStart: "2027-03-01",
    breakEnd: "2027-03-07",
    holidays: [
      ...spanHolidays("2027-01-01", "2027-01-04", "Fêtes de fin d'année"),
      { date: "2027-03-26", label: "Vendredi saint" },
      { date: "2027-03-29", label: "Lundi de Pâques" },
    ],
    source: REGISTRAIRE_2026_2027,
    facultySource: FAS_A26_H27,
    verifiedOn: VERIFIED_ON,
  },

  // ---------------------------------------------------------------------------
  // Été 2027 — source : calendrier universitaire 2026-2027 du registraire
  // (REGISTRAIRE_2026_2027), consulté le 2026-09-09. Le registraire avertit :
  // « L'horaire d'été peut différer d'une faculté à l'autre. » Il donne :
  //   lundi 3 mai 2027           rentrée des personnes étudiantes
  //   lundi 24 mai               congé – Journée nationale des Patriotes
  //   mercredi 23 juin           fin du trimestre, session intensive
  //   jeudi 24 juin              congé – Fête nationale du Québec
  //   jeudi 1er juillet          congé – Fête du Canada
  //   vendredi 13 août           fin du trimestre, session régulière
  // Aucune période d'activités libres n'est publiée pour l'été (relâche = null).
  // TODO(2026-09-09) : aucun calendrier facultaire FAS pour l'été 2027 n'est
  // publié ; dernier jour de cours et période d'examens inconnus → null.
  // `classesStart` reprend la rentrée du registraire faute de mieux.
  // ---------------------------------------------------------------------------
  {
    term: { code: "E27", label: "Été 2027", start: "2027-05-03", end: "2027-08-13" },
    classesStart: "2027-05-03",
    classesEnd: null,
    examsStart: null,
    examsEnd: null,
    breakStart: null,
    breakEnd: null,
    holidays: [
      { date: "2027-05-24", label: "Journée nationale des Patriotes" },
      { date: "2027-06-24", label: "Fête nationale du Québec" },
      { date: "2027-07-01", label: "Fête du Canada" },
    ],
    source: REGISTRAIRE_2026_2027,
    verifiedOn: VERIFIED_ON,
  },
];

const BY_CODE: ReadonlyMap<string, TermCalendar> = new Map(
  CALENDARS.map((calendar) => [calendar.term.code, calendar]),
);

/** Codes des trimestres couverts, dans l'ordre chronologique. */
export const KNOWN_TERM_CODES: readonly string[] = CALENDARS.map((c) => c.term.code);

export function getTermCalendar(code: string): TermCalendar | undefined {
  return BY_CODE.get(code);
}

/**
 * "2026-09-01" → "A26". Sept.–déc. = A, janv.–avril = H, mai–août = E ;
 * année sur deux chiffres. `undefined` si la chaîne n'est pas une date ISO.
 */
export function inferTermCode(date: string): string | undefined {
  const match = ISO_DATE.exec(date);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const season = month >= 9 ? "A" : month >= 5 ? "E" : "H";
  return `${season}${String(year % 100).padStart(2, "0")}`;
}

/**
 * Toutes les dates sans cours du trimestre : chaque jour de la relâche plus
 * les congés, triées, sans doublon. Tableau vide si le trimestre est inconnu.
 */
export function excludedDates(code: string): string[] {
  const calendar = BY_CODE.get(code);
  if (!calendar) return [];
  const dates = new Set<string>();
  if (calendar.breakStart && calendar.breakEnd) {
    for (const day of eachDay(calendar.breakStart, calendar.breakEnd)) dates.add(day);
  }
  for (const holiday of calendar.holidays) dates.add(holiday.date);
  return [...dates].sort();
}

export function isExcluded(code: string, date: string): boolean {
  return excludedDates(code).includes(date);
}

/** Jours "AAAA-MM-JJ" de `from` à `to` inclus (calcul en UTC, sans fuseau). */
function eachDay(from: string, to: string): string[] {
  const start = parseUtc(from);
  const end = parseUtc(to);
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function parseUtc(date: string): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Date ISO attendue (AAAA-MM-JJ), reçu « ${date} »`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
