// Formatage des instants (ISO 8601 avec fuseau) en heure de Montréal.
//
// Partage des rôles : `Intl` sert à convertir un instant en champs civils de
// America/Toronto — c'est un calcul de fuseau, avec les règles d'heure avancée,
// qu'on ne veut pas réécrire — mais il ne sert jamais à produire du texte. Les
// noms et la ponctuation viennent de `date.ts`, pour que la chaîne affichée ne
// dépende pas de la version d'ICU du navigateur.

import { dayMonthShort, dayMonthYear, isoWeekday, weekdayName } from "./date";

export const TIME_ZONE = "America/Toronto";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface CivilDateTime {
  year: number;
  /** 1 = janvier … 12 = décembre. */
  month: number;
  day: number;
  /** 0–23, heure locale de Montréal. */
  hour: number;
  minute: number;
}

// Locale « en-CA » : on ne lit que des champs numériques, aucun nom. hourCycle
// « h23 » évite le « 24 » que certaines versions d'ICU rendent pour minuit.
const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseInstant(iso: string): Date {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Instant ISO 8601 invalide : ${iso}`);
  return new Date(ms);
}

/** Instant ISO → champs civils à Montréal (heure avancée comprise). */
export function torontoCivil(iso: string): CivilDateTime {
  const found: Record<string, string> = {};
  for (const part of PARTS.formatToParts(parseInstant(iso))) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: Number(found["year"]),
    month: Number(found["month"]),
    day: Number(found["day"]),
    hour: Number(found["hour"]) % 24,
    minute: Number(found["minute"]),
  };
}

/** Champs civils → « AAAA-MM-JJ ». */
export function torontoDate(iso: string): string {
  const c = torontoCivil(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

/** 18 h 16, 8 h 05, 0 h 00 — convention québécoise : heure sans zéro initial. */
export function formatClock(hour: number, minute: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError(`Heure invalide : ${hour}`);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new RangeError(`Minute invalide : ${minute}`);
  return `${hour} h ${String(minute).padStart(2, "0")}`;
}

/**
 * Fraîcheur d'une capture, vue de `nowIso` :
 *   < 1 min → « à l'instant » ; < 60 min → « il y a N min » ;
 *   < 24 h → « il y a N h » ; au-delà → « le 9 sept. ».
 * Un instant dans le futur (horloge décalée) est traité comme « à l'instant »
 * plutôt que rendu en durée négative.
 */
export function relativeTime(iso: string, nowIso: string): string {
  const elapsed = parseInstant(nowIso).getTime() - parseInstant(iso).getTime();
  if (elapsed < MINUTE_MS) return "à l'instant";
  if (elapsed < HOUR_MS) return `il y a ${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `il y a ${Math.floor(elapsed / HOUR_MS)} h`;
  return `le ${dayMonthShort(torontoDate(iso))}`;
}

/** « mercredi 9 septembre 2026, 18 h 16 » — pour l'attribut `title`. */
export function fullDateTime(iso: string): string {
  const c = torontoCivil(iso);
  const date = torontoDate(iso);
  return `${weekdayName(isoWeekday(date), "long")} ${dayMonthYear(date)}, ${formatClock(c.hour, c.minute)}`;
}
