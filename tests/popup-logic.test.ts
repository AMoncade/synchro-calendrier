// Logique qui alimente le popup v2, éprouvée sur l'horaire réel A26.
//
// Le popup lui-même n'est pas testable en l'état (rendu DOM + API chrome) ; ce
// fichier ne teste donc que ce qui est pur : `core/alerts.busyDay`, la bascule
// de jour de `core/today.buildTodayView`, et le choix de trimestre de
// `core/store.currentTerm`. Deux cas figent un **défaut connu** et disent quoi
// attendre après correction.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { busyDay, minutesOfTime } from "../src/core/alerts";
import { excludedDates } from "../src/core/calendar-udem";
import { expandSchedule } from "../src/core/expand";
import type { Occurrence } from "../src/core/model";
import { parsePasted } from "../src/core/parse";
import { emptyState, mergeCapture, currentTerm } from "../src/core/store";
import { buildTodayView } from "../src/core/today";

const fixture = (name: string): string => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

const { schedule } = parsePasted(fixture("liste-A26.txt"), {
  capturedAt: "2026-09-09T12:00:00.000Z",
  localDate: "2026-09-09",
});
const occurrences = expandSchedule(schedule, { excludedDates: excludedDates("A26") });

function byDay(items: Occurrence[]): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>();
  for (const o of items) out.set(o.date, [...(out.get(o.date) ?? []), o]);
  return out;
}

const DAYS = byDay(occurrences);
const day = (date: string): Occurrence[] => DAYS.get(date) ?? [];

/**
 * Présence réelle d'une journée, en minutes : somme des blocs après fusion des
 * intervalles qui se chevauchent. C'est la lecture littérale de la spec v2 §8.3
 * (« plus de 6 h de présence »), proposée en remplacement de l'amplitude.
 * La fusion compte : deux blocs qui se chevauchent ne valent pas leur somme.
 */
export function presenceMinutes(items: Occurrence[]): number {
  const spans = items
    .map((o) => [minutesOfTime(o.start), minutesOfTime(o.end)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = -1;
  let end = -1;
  for (const [from, to] of spans) {
    if (end < 0) {
      start = from;
      end = to;
    } else if (from <= end) {
      end = Math.max(end, to);
    } else {
      total += end - start;
      start = from;
      end = to;
    }
  }
  return end < 0 ? 0 : total + (end - start);
}

/** Règle proposée : au moins 3 blocs, ou plus de 6 h de présence effective. */
function busyByPresence(items: Occurrence[]): boolean {
  return items.length >= 3 || presenceMinutes(items) > 6 * 60;
}

describe("journée chargée — amplitude vs présence", () => {
  it("mesure la forme réelle des journées du trimestre", () => {
    // Mardi : deux blocs, 3 h de cours. Mercredi : deux blocs, 4 h de cours,
    // séparés par un trou de 3 h. Jeudi : deux blocs collés, 4 h de cours.
    expect(day("2026-09-08").map((o) => `${o.start}–${o.end}`)).toEqual(["08:30–10:30", "12:30–13:30"]);
    expect(day("2026-09-09").map((o) => `${o.start}–${o.end}`)).toEqual(["08:30–10:30", "13:30–15:30"]);
    expect(day("2026-09-10").map((o) => `${o.start}–${o.end}`)).toEqual(["08:30–10:30", "10:30–12:30"]);
    expect(presenceMinutes(day("2026-09-09"))).toBe(240);
    expect(presenceMinutes(day("2026-09-10"))).toBe(240);
    // Le lundi est la vraie journée chargée : quatre blocs, 8 h de présence.
    expect(day("2026-09-14")).toHaveLength(4);
    expect(presenceMinutes(day("2026-09-14"))).toBe(480);
  });

  // DÉFAUT CONNU — `busyDay` (src/core/alerts.ts) compare l'AMPLITUDE
  // (premier début → dernière fin) au seuil de 6 h, alors que la spec v2 §8.3
  // dit « plus de 6 h de présence ». Mercredi et jeudi ont exactement la même
  // présence — 4 h de cours — et reçoivent des verdicts opposés, uniquement
  // parce que le mercredi a un trou de 3 h au milieu.
  // Après correction, attendre : busyDay(mercredi) === false.
  it("DÉFAUT CONNU : même présence, verdicts opposés (mercredi vs jeudi)", () => {
    expect(presenceMinutes(day("2026-09-09"))).toBe(presenceMinutes(day("2026-09-10")));
    expect(busyDay(day("2026-09-09"))).toBe(true); // attendu après correction : false
    expect(busyDay(day("2026-09-10"))).toBe(false);
    // La règle proposée les met d'accord.
    expect(busyByPresence(day("2026-09-09"))).toBe(false);
    expect(busyByPresence(day("2026-09-10"))).toBe(false);
  });

  // DÉFAUT CONNU — l'ampleur du problème : un tiers des journées du trimestre
  // portent la mention, dont tous les mercredis. Après correction, attendre 11.
  it("DÉFAUT CONNU : 23 journées sur 68 sont dites chargées, contre 11 attendues", () => {
    const dates = [...DAYS.keys()].sort();
    expect(dates).toHaveLength(68);
    const actuel = dates.filter((d) => busyDay(day(d)));
    const propose = dates.filter((d) => busyByPresence(day(d)));
    expect(actuel).toHaveLength(23); // attendu après correction : 11
    expect(propose).toHaveLength(11);

    // Les journées qui changent de verdict sont toutes des mercredis à 2 blocs.
    const divergentes = dates.filter((d) => busyDay(day(d)) !== busyByPresence(day(d)));
    expect(divergentes).toHaveLength(12);
    for (const d of divergentes) {
      const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
      expect(new Date(Date.UTC(y, m - 1, dd)).getUTCDay()).toBe(3); // mercredi
      expect(day(d)).toHaveLength(2);
      expect(presenceMinutes(day(d))).toBe(240);
    }
  });

  it("la règle proposée garde les vraies journées chargées", () => {
    // Lundi 14 septembre : 4 blocs, 8 h de présence.
    expect(busyByPresence(day("2026-09-14"))).toBe(true);
    // Lundi 31 août : 3 blocs, exactement 6 h — retenu par le critère du nombre
    // de blocs, pas par celui de la durée (le seuil est strict).
    expect(day("2026-08-31")).toHaveLength(3);
    expect(presenceMinutes(day("2026-08-31"))).toBe(360);
    expect(busyByPresence(day("2026-08-31"))).toBe(true);
  });

  it("la présence fusionne les blocs qui se chevauchent", () => {
    const at = (start: string, end: string, label: string): Occurrence => ({
      kind: "cours", courseCode: "XXX0000", label, date: "2026-09-09", start, end, location: "",
    });
    // Deux blocs en conflit de 09:00 à 12:00 : 3 h de présence, pas 4 h.
    expect(presenceMinutes([at("09:00", "11:00", "a"), at("10:00", "12:00", "b")])).toBe(180);
    // Blocs disjoints : la somme.
    expect(presenceMinutes([at("09:00", "11:00", "a"), at("13:00", "14:00", "b")])).toBe(180);
    expect(presenceMinutes([])).toBe(0);
  });
});

describe("bascule de jour", () => {
  const view = (now: string) => buildTodayView(occurrences, schedule.exams, now);

  it("passe à demain le soir, et au jour même après minuit", () => {
    expect(view("2026-09-08T09:15")).toMatchObject({ kind: "today", date: "2026-09-08" });
    expect(view("2026-09-08T23:59")).toMatchObject({ kind: "tomorrow", date: "2026-09-09" });
    expect(view("2026-09-09T00:01")).toMatchObject({ kind: "today", date: "2026-09-09" });
  });

  it("saute le week-end et la relâche jusqu'au prochain jour de cours", () => {
    expect(view("2026-09-12T10:00")).toMatchObject({ kind: "nothing", date: "2026-09-14" });
    // Relâche du 19 au 25 octobre : le prochain jour de cours est le lundi 26.
    expect(view("2026-10-19T10:00")).toMatchObject({ kind: "nothing", date: "2026-10-26" });
  });

  it("annonce la fin du trimestre après le dernier examen", () => {
    expect(view("2026-12-09T18:00")).toMatchObject({ kind: "tomorrow", date: "2026-12-10" });
    const over = view("2026-12-18T10:00");
    expect(over.kind).toBe("term-over");
    expect(over.date).toBe("2026-12-18");
    expect(over.items).toEqual([]);
    expect(over.nextExam).toBeUndefined();
    // Entre deux trimestres, même réponse : rien à afficher, pas d'erreur.
    expect(view("2027-01-02T10:00")).toMatchObject({ kind: "term-over", date: "2027-01-02" });
  });

  it("n'annonce le prochain examen que sous l'horizon de 30 jours", () => {
    // 8 septembre → intra du 7 octobre : 29 jours, annoncé.
    expect(view("2026-09-08T09:15").nextExam?.exam.date).toBe("2026-10-07");
    // 6 septembre → 31 jours, hors horizon.
    expect(view("2026-09-06T09:15").nextExam).toBeUndefined();
  });
});

describe("choix du trimestre", () => {
  const state = mergeCapture(emptyState(), schedule, "liste");

  it("garde le trimestre capturé bien après sa fin", () => {
    expect(currentTerm(state, "2026-09-08")?.term.code).toBe("A26");
    expect(currentTerm(state, "2026-12-23")?.term.code).toBe("A26");
    // Hors trimestre, faute de mieux : le plus récent. Le popup bascule alors
    // sur « term-over », il n'affiche pas une semaine vide sans explication.
    expect(currentTerm(state, "2027-01-02")?.term.code).toBe("A26");
    expect(currentTerm(state, "2027-05-01")?.term.code).toBe("A26");
  });

  it("ne rend rien sur un état vide", () => {
    expect(currentTerm(emptyState(), "2026-09-08")).toBeUndefined();
  });
});
