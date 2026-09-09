// Onglet « Aujourd'hui » du popup (spec v2 §4) : qu'est-ce qui s'en vient.
//
// Pur et déterministe : `now` est toujours un paramètre (« AAAA-MM-JJTHH:MM »,
// heure locale), jamais `Date.now()`. Les occurrences arrivent déjà expansées,
// triées et débarrassées des congés par `expand.ts` ; ce module choisit le jour
// à afficher et qualifie chaque bloc.
//
// Convention de bord, commune à `alerts.ts` et `conflicts.ts` : un bloc est en
// cours sur [début, fin[, donc terminé à l'heure de fin pile. `countdown.ts`
// suit la convention inverse pour les examens (un examen qui finit à 12:00 est
// encore « à venir » à 12:00 pile) : c'est voulu, les deux questions diffèrent.

import { busyDay, dedupeOccurrences, minutesOfTime, parseLocalNow } from "./alerts";
import { nextExam as findNextExam, type NextExam } from "./countdown";
import { addDays } from "./expand";
import type { Exam, Occurrence } from "./model";

export type ItemStatus = "now" | "next" | "later" | "done";

export interface TodayItem {
  occurrence: Occurrence;
  status: ItemStatus;
  /** Minutes avant le début. Seulement pour « next »/« later », et seulement le jour même. */
  minutesToStart?: number;
  /** Minutes avant la fin. Seulement pour « now ». */
  minutesToEnd?: number;
  /**
   * Même pavillon que le bloc précédent de la journée affichée. `undefined` pour le
   * premier bloc, et quand un des deux locaux n'a pas de pavillon (« En ligne »).
   */
  sameBuildingAsPrevious?: boolean;
}

export type TodayKind = "today" | "tomorrow" | "next-day" | "nothing" | "term-over";

export interface TodayView {
  /** Jour affiché, « AAAA-MM-JJ ». Vaut aujourd'hui sauf bascule (voir `kind`). */
  date: string;
  kind: TodayKind;
  /** Blocs encore à venir du jour affiché, par heure croissante, au plus `MAX_ITEMS`. */
  items: TodayItem[];
  /** Blocs à venir qui dépassent le plafond : « + N autres ». */
  hiddenCount: number;
  /** Blocs déjà terminés du jour affiché. Vide dès que le jour affiché n'est pas aujourd'hui. */
  doneItems: TodayItem[];
  /** Prochain examen, seulement s'il est à moins de `NEXT_EXAM_HORIZON_DAYS` jours. */
  nextExam?: NextExam;
  /** Le jour affiché est chargé (spec §8.3). */
  busy: boolean;
}

/** Plafond d'affichage : « ne jamais afficher plus de 6 éléments » (spec §4). */
export const MAX_ITEMS = 6;
/** Le prochain examen n'est annoncé qu'en deçà de ce nombre de jours (spec §4). */
export const NEXT_EXAM_HORIZON_DAYS = 30;

const PAVILLON = /\bPav\.\s*(\S.*)$/;

/**
 * Pavillon d'un local : le texte après « Pav. ».
 * « B-0215 Pav. 3200 J.-Brillant » → « 3200 J.-Brillant » ; « En ligne » → `undefined`.
 */
export function pavillonOf(location: string): string | undefined {
  const m = PAVILLON.exec(location.replace(/\s+/g, " ").trim());
  return m ? m[1]!.trim() : undefined;
}

function sameBuilding(previous: Occurrence | undefined, current: Occurrence): boolean | undefined {
  if (!previous) return undefined;
  const a = pavillonOf(previous.location);
  const b = pavillonOf(current.location);
  if (!a || !b) return undefined;
  return a.toLowerCase() === b.toLowerCase();
}

function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Ordre d'une journée : début, fin, puis libellé pour rester déterministe. */
function compareInDay(x: Occurrence, y: Occurrence): number {
  return (
    compareStrings(x.start, y.start) ||
    compareStrings(x.end, y.end) ||
    compareStrings(x.label, y.label) ||
    compareStrings(x.courseCode, y.courseCode)
  );
}

function groupByDay(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const byDay = new Map<string, Occurrence[]>();
  for (const o of dedupeOccurrences(occurrences)) {
    const day = byDay.get(o.date);
    if (day) day.push(o);
    else byDay.set(o.date, [o]);
  }
  for (const day of byDay.values()) day.sort(compareInDay);
  return byDay;
}

/**
 * Construit la vue du jour.
 *
 * Choix du jour affiché :
 * - il reste quelque chose aujourd'hui → `today` ;
 * - aujourd'hui avait des blocs, tous terminés, et demain en a → `tomorrow` ;
 * - même chose mais demain est vide → `next-day`, premier jour suivant qui a des blocs
 *   (un vendredi soir saute au lundi sans traiter le week-end à part) ;
 * - aujourd'hui n'avait rien du tout → `nothing`, avec les blocs du prochain jour utile
 *   (c'est le cas du samedi et du dimanche, et celui de la semaine de relâche) ;
 * - plus rien après aujourd'hui → `term-over`, `date` reste aujourd'hui.
 *
 * `items` ne contient que ce qui reste à venir : sur un écran qui répond à « qu'est-ce
 * qui s'en vient », replier les blocs à venir derrière « + N autres » tout en montrant
 * les blocs déjà passés serait à l'envers. Les blocs terminés du jour restent
 * disponibles dans `doneItems`, que le popup affiche en gris ou ignore.
 */
export function buildTodayView(occurrences: Occurrence[], exams: Exam[], now: string): TodayView {
  const { date: today, time } = parseLocalNow(now);
  const byDay = groupByDay(occurrences);

  const todayOccurrences = byDay.get(today) ?? [];
  const remainingToday = todayOccurrences.filter((o) => o.end > time);

  let date: string;
  let kind: TodayKind;
  if (remainingToday.length > 0) {
    date = today;
    kind = "today";
  } else {
    let nextDate: string | undefined;
    for (const candidate of byDay.keys()) {
      if (candidate > today && (nextDate === undefined || candidate < nextDate)) nextDate = candidate;
    }
    if (nextDate === undefined) {
      date = today;
      kind = "term-over";
    } else {
      date = nextDate;
      kind =
        todayOccurrences.length === 0 ? "nothing" : nextDate === addDays(today, 1) ? "tomorrow" : "next-day";
    }
  }

  const isToday = date === today;
  const dayOccurrences = byDay.get(date) ?? [];

  // Premier passage : terminé / en cours / à venir.
  const all: TodayItem[] = dayOccurrences.map((occurrence, index) => {
    let status: ItemStatus = "later";
    if (isToday) {
      if (occurrence.end <= time) status = "done";
      else if (occurrence.start <= time) status = "now";
    }
    const item: TodayItem = { occurrence, status };
    const adjacency = sameBuilding(dayOccurrences[index - 1], occurrence);
    if (adjacency !== undefined) item.sameBuildingAsPrevious = adjacency;
    if (isToday && status === "now") {
      item.minutesToEnd = minutesOfTime(occurrence.end) - minutesOfTime(time);
    }
    return item;
  });

  // Second passage : le premier bloc à venir devient « next ».
  const first = all.find((item) => item.status === "later");
  if (first) first.status = "next";

  // Les minutes avant le début n'ont de sens que le jour même.
  if (isToday) {
    for (const item of all) {
      if (item.status === "next" || item.status === "later") {
        item.minutesToStart = minutesOfTime(item.occurrence.start) - minutesOfTime(time);
      }
    }
  }

  const upcoming = all.filter((item) => item.status !== "done");
  const soonest = findNextExam(exams, now);

  const view: TodayView = {
    date,
    kind,
    items: upcoming.slice(0, MAX_ITEMS),
    hiddenCount: Math.max(0, upcoming.length - MAX_ITEMS),
    doneItems: all.filter((item) => item.status === "done"),
    busy: busyDay(dayOccurrences),
  };
  if (soonest && soonest.daysLeft <= NEXT_EXAM_HORIZON_DAYS) view.nextExam = soonest;
  return view;
}
