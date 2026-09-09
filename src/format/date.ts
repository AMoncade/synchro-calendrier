// Formatage des dates civiles (« AAAA-MM-JJ ») en français du Québec.
//
// Les noms de mois et de jours sont écrits ici, pas tirés d'`Intl`, pour que la
// chaîne affichée soit une propriété du code source et non de la version d'ICU
// embarquée dans le navigateur. Vérifié le 2026-09-09 : Node 24 (ICU 78.2) et
// Chrome 152 produisent exactement ces formes en « fr-CA » ; le test
// `date.test.ts` compare la table à `Intl` et deviendra rouge si l'un des deux
// s'en écarte un jour.
//
// Aucune `Date` n'est construite à partir d'une chaîne : une date civile est un
// triplet (année, mois, jour) ramené à `Date.UTC`, ce qui interdit tout
// glissement d'un jour selon le fuseau (docs/ARCHITECTURE.md, piège horaire).

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Index 0 = janvier. */
export const MONTHS_LONG: readonly string[] = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Index 0 = janvier. Abréviations CLDR : « juill. », pas « juil. ». */
export const MONTHS_SHORT: readonly string[] = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juill.", "août", "sept.", "oct.", "nov.", "déc.",
];

/** Index 0 = lundi (ISO 8601). */
export const WEEKDAYS_LONG: readonly string[] = [
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
];

/** Index 0 = lundi (ISO 8601). */
export const WEEKDAYS_SHORT: readonly string[] = [
  "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim.",
];

export type NameStyle = "short" | "long";

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface CivilDate {
  year: number;
  /** 1 = janvier … 12 = décembre. */
  month: number;
  day: number;
}

/** « 2026-10-07 » → { year: 2026, month: 10, day: 7 }. Lance si la date n'existe pas. */
export function parseIsoDate(date: string): CivilDate {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Date invalide (attendu AAAA-MM-JJ) : ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Date.UTC normalise en silence (2026-02-30 → 2 mars) : on vérifie le retour.
  const back = new Date(Date.UTC(year, month - 1, day));
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    throw new RangeError(`Date inexistante : ${date}`);
  }
  return { year, month, day };
}

function civilToUtcMs(c: CivilDate): number {
  return Date.UTC(c.year, c.month - 1, c.day);
}

/** Jour de la semaine ISO d'une date civile (1 = lundi … 7 = dimanche). */
export function isoWeekday(date: string): Weekday {
  const dow = new Date(civilToUtcMs(parseIsoDate(date))).getUTCDay();
  return (dow === 0 ? 7 : dow) as Weekday;
}

/** 1 → « lun. » / « lundi ». Lance hors de 1–7. */
export function weekdayName(weekday: number, style: NameStyle = "long"): string {
  const name = (style === "short" ? WEEKDAYS_SHORT : WEEKDAYS_LONG)[weekday - 1];
  if (name === undefined) throw new RangeError(`Jour de semaine invalide (attendu 1–7) : ${weekday}`);
  return name;
}

/** 10 → « oct. » / « octobre ». Lance hors de 1–12. */
export function monthName(month: number, style: NameStyle = "long"): string {
  const name = (style === "short" ? MONTHS_SHORT : MONTHS_LONG)[month - 1];
  if (name === undefined) throw new RangeError(`Mois invalide (attendu 1–12) : ${month}`);
  return name;
}

/**
 * Quantième du mois tel qu'on l'écrit en français : « 1er » pour le premier,
 * le nombre nu ensuite. C'est l'usage de l'UdeM elle-même — le calendrier du
 * registraire écrit « Mardi 1er septembre 2026 ». `Intl` en « fr-CA » rend
 * « 1 » : c'est la seule divergence assumée entre notre sortie et la sienne,
 * et `format.test.ts` la vérifie explicitement.
 */
export function dayOfMonth(day: number): string {
  return day === 1 ? "1er" : String(day);
}

/** « 2026-10-07 » → « mer. 7 oct. » ; « 2026-12-01 » → « mar. 1er déc. ». */
export function shortDate(date: string): string {
  const c = parseIsoDate(date);
  return `${weekdayName(isoWeekday(date), "short")} ${dayOfMonth(c.day)} ${monthName(c.month, "short")}`;
}

/** « 2026-09-09 » → « mercredi 9 septembre » (sans l'année). */
export function longDate(date: string): string {
  const c = parseIsoDate(date);
  return `${weekdayName(isoWeekday(date), "long")} ${dayOfMonth(c.day)} ${monthName(c.month, "long")}`;
}

/** « 2026-09-09 » → « 9 sept. » (sans jour de semaine ni année). */
export function dayMonthShort(date: string): string {
  const c = parseIsoDate(date);
  return `${dayOfMonth(c.day)} ${monthName(c.month, "short")}`;
}

/** « 2026-09-09 » → « 9 septembre 2026 ». */
export function dayMonthYear(date: string): string {
  const c = parseIsoDate(date);
  return `${dayOfMonth(c.day)} ${monthName(c.month, "long")} ${c.year}`;
}

/**
 * Différence en jours civils : `dateIso` − `todayIso`. Jamais d'heure, donc
 * jamais de glissement d'un jour ni d'arrondi lié au changement d'heure.
 * Demain → 1, hier → −1.
 */
export function daysUntil(dateIso: string, todayIso: string): number {
  return Math.round((civilToUtcMs(parseIsoDate(dateIso)) - civilToUtcMs(parseIsoDate(todayIso))) / DAY_MS);
}

/**
 * 0 → « aujourd'hui », 1 → « demain », −1 → « hier »,
 * 5 → « dans 5 j », −3 → « il y a 3 j ».
 */
export function formatDaysUntil(days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`Nombre de jours non entier : ${days}`);
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "demain";
  if (days === -1) return "hier";
  if (days > 1) return `dans ${days} j`;
  return `il y a ${-days} j`;
}
