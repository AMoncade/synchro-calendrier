// Signaux d'alerte tirés de l'horaire (spec v2 §8.1, §8.3, §10.3).
//
// Module bas niveau de la paire alerts/today : `today.ts` importe d'ici, jamais
// l'inverse. Tout est pur et déterministe — l'instant courant est un paramètre,
// jamais `Date.now()` — et les heures "HH:MM" zéro-remplies se comparent comme
// des chaînes (contrat de `model.ts`, garanti par `parse.ts`).
//
// Le déplacement entre pavillons (§8.2) n'est pas ici : il demande la table des
// temps de marche `src/data/pavillons.ts`, qui n'existe pas encore.

import type { Exam, Occurrence } from "./model";
import { dateToUtc } from "./expand";

const DAY_MS = 86_400_000;
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** Nombre de blocs à partir duquel une journée est dite chargée (spec §8.3). */
export const BUSY_MIN_BLOCKS = 3;
/** Amplitude de présence au-delà de laquelle une journée est dite chargée, en minutes (spec §8.3). */
export const BUSY_SPAN_MINUTES = 6 * 60;
/** Largeur de la fenêtre glissante d'une grappe d'examens, en jours civils (spec §8.1). */
export const CLUSTER_WINDOW_DAYS = 8;
/** Nombre d'examens à partir duquel une fenêtre devient une grappe (spec §8.1). */
export const CLUSTER_MIN_EXAMS = 3;

// ---------------------------------------------------------------------------
// Briques partagées avec today.ts (exportées pour être testées directement)
// ---------------------------------------------------------------------------

/** "HH:MM" → minutes depuis minuit. */
export function minutesOfTime(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * Découpe un instant local « AAAA-MM-JJTHH:MM » en jour et heure.
 * Un suffixe (secondes, fuseau) est toléré et ignoré. Lance si le format ne tient pas :
 * mieux vaut une erreur franche qu'un « aujourd'hui » silencieusement faux.
 */
export function parseLocalNow(now: string): { date: string; time: string } {
  const m = LOCAL_DATETIME.exec(now);
  if (!m) throw new RangeError(`Instant invalide (attendu AAAA-MM-JJTHH:MM) : ${now}`);
  return { date: m[1]!, time: m[2]! };
}

/**
 * Retire les occurrences strictement identiques (même cours, même créneau, même jour),
 * qu'un ré-import peut produire. Même règle que `conflicts.ts` : l'ordre d'entrée est
 * conservé, la première gagne.
 */
export function dedupeOccurrences(occurrences: Occurrence[]): Occurrence[] {
  const seen = new Set<string>();
  const out: Occurrence[] = [];
  for (const o of occurrences) {
    const key = [o.courseCode, o.label, o.date, o.start, o.end].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Ordre déterministe des examens : date, début, fin, cours, libellé. */
function compareExams(x: Exam, y: Exam): number {
  return (
    compareStrings(x.date, y.date) ||
    compareStrings(x.start, y.start) ||
    compareStrings(x.end, y.end) ||
    compareStrings(x.courseCode, y.courseCode) ||
    compareStrings(x.label, y.label)
  );
}

function dedupeExams(exams: Exam[]): Exam[] {
  const seen = new Set<string>();
  const out: Exam[] = [];
  for (const e of exams) {
    const key = [e.courseCode, e.kind, e.date, e.start, e.end, e.label].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §8.1 — Grappes d'examens
// ---------------------------------------------------------------------------

export interface ExamCluster {
  /** Date du premier examen de la grappe (pas le début théorique de la fenêtre). */
  start: string;
  /** Date du dernier examen de la grappe. */
  end: string;
  exams: Exam[];
}

/**
 * Fenêtre glissante de `windowDays` jours civils contenant au moins `min` examens.
 * Deux fenêtres qui partagent un examen sont fusionnées, de sorte qu'une grappe est
 * maximale : les quatre finaux du 10 au 17 décembre donnent une grappe, pas deux.
 *
 * La fenêtre est inclusive : `windowDays = 8` accepte deux examens distants de 7 jours.
 *
 * Le tri des examens passés est laissé à l'appelant — la fonction ne connaît pas
 * l'instant courant et reste ainsi utilisable sur un trimestre entier comme sur ce
 * qu'il en reste.
 */
export function examClusters(
  exams: Exam[],
  windowDays: number = CLUSTER_WINDOW_DAYS,
  min: number = CLUSTER_MIN_EXAMS,
): ExamCluster[] {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(`Fenêtre invalide (jours entiers ≥ 1) : ${windowDays}`);
  }
  if (!Number.isInteger(min) || min < 1) {
    throw new RangeError(`Seuil invalide (entier ≥ 1) : ${min}`);
  }

  const sorted = dedupeExams(exams).sort(compareExams);
  const spanMs = (windowDays - 1) * DAY_MS;

  // Bornes en indices, fusionnées au fil de l'eau : les fenêtres candidates sont
  // produites par début croissant, deux qui se chevauchent sont donc adjacentes.
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = dateToUtc(sorted[i]!.date);
    let last = i;
    while (last + 1 < sorted.length && dateToUtc(sorted[last + 1]!.date) - from <= spanMs) {
      last++;
    }
    if (last - i + 1 < min) continue;
    const previous = ranges[ranges.length - 1];
    if (previous && i <= previous[1]) previous[1] = Math.max(previous[1], last);
    else ranges.push([i, last]);
  }

  return ranges.map(([from, to]) => {
    const group = sorted.slice(from, to + 1);
    return { start: group[0]!.date, end: group[group.length - 1]!.date, exams: group };
  });
}

// ---------------------------------------------------------------------------
// §8.3 — Journée chargée
// ---------------------------------------------------------------------------

/**
 * Journée chargée : plus de 6 h entre le premier début et la dernière fin, ou au moins
 * 3 blocs. Purement informatif (spec §8.3 : « aucun jugement »).
 *
 * L'appel normal porte sur une seule journée. Si la liste en couvre plusieurs, chaque
 * jour est évalué séparément et la réponse vaut « au moins une journée est chargée » :
 * une amplitude calculée à cheval sur deux dates n'aurait aucun sens.
 */
export function busyDay(items: Occurrence[]): boolean {
  const byDay = new Map<string, Occurrence[]>();
  for (const o of dedupeOccurrences(items)) {
    const day = byDay.get(o.date);
    if (day) day.push(o);
    else byDay.set(o.date, [o]);
  }

  for (const day of byDay.values()) {
    if (day.length >= BUSY_MIN_BLOCKS) return true;
    let first = day[0]!.start;
    let last = day[0]!.end;
    for (const o of day) {
      if (o.start < first) first = o.start;
      if (o.end > last) last = o.end;
    }
    if (minutesOfTime(last) - minutesOfTime(first) > BUSY_SPAN_MINUTES) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// §10.3 — Badge : cours restants aujourd'hui
// ---------------------------------------------------------------------------

/**
 * Nombre de cours du jour qui ne sont pas terminés à l'instant `now`. Un cours en train
 * de se donner compte encore : il reste à y être. Les examens sont exclus — le badge de
 * la spec §10.3 annonce des cours, le compte à rebours d'examens vit dans `countdown.ts`.
 *
 * Un cours qui se termine à l'heure pile ne compte plus (fin 10:30 à 10:30 = terminé),
 * même convention de bord que `today.ts` et que `conflicts.ts`.
 */
export function classesRemainingToday(occurrences: Occurrence[], now: string): number {
  const { date: today, time } = parseLocalNow(now);
  let count = 0;
  for (const o of dedupeOccurrences(occurrences)) {
    if (o.kind !== "cours" || o.date !== today) continue;
    if (o.end <= time) continue;
    count++;
  }
  return count;
}
