// Test de couture : l'enveloppe brute de StudiUM traverse les trois modules
// écrits par trois sessions parallèles, jusqu'à l'état stocké.
//
//   fixture brute  →  content/studium.ts   (readAjaxPayload, flattenMonthlyEvents,
//                                            dedupeEvents, readCourses, captureStudium)
//                  →  core/studium.ts      (deadlinesFromStudium, studiumCourses)
//                  →  core/deadlines.ts    (mergeStudium, allDeadlines, deadlineStatus)
//
// Chaque module a sa propre suite ; celle-ci ne teste que ce qu'aucune d'elles
// ne peut voir : les raccords. Un module vert de son côté peut très bien ne pas
// s'emboîter avec le suivant.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ FIXTURE SYNTHÉTIQUE — écrite le 2026-09-10, à remplacer.                 │
// │                                                                         │
// │ `studium-monthly-2026-09-brut.json` n'est PAS une capture réelle : la    │
// │ session StudiUM n'était pas joignable ce jour-là. Elle imbrique les      │
// │ événements de `studium-monthly-2026-09.json` dans l'enveloppe que rend   │
// │ `/lib/ajax/service.php`, dont la forme a été relevée champ par champ     │
// │ dans moodle/moodle @ MOODLE_404_STABLE :                                 │
// │                                                                         │
// │  month_exporter      url · courseid · categoryid · filter_selector ·     │
// │                      weeks · daynames · view · date · periodname ·      │
// │                      includenavigation · initialeventsloaded ·          │
// │                      previousperiod(+link,+name) ·                      │
// │                      nextperiod(+link,+name) · larrow · rarrow ·        │
// │                      defaulteventcontext · calendarinstanceid ·         │
// │                      viewingmonth · showviewselector · viewinginblock   │
// │  week_exporter       prepadding · postpadding · days                    │
// │                      (les deux paddings sont des TABLEAUX d'entiers de   │
// │                      remplissage, pas des jours — donc deux mois         │
// │                      consécutifs ne se recouvrent jamais)               │
// │  day_exporter        seconds · minutes · hours · mday · wday · year ·    │
// │                      yday · timestamp · neweventtimestamp ·             │
// │                      viewdaylink · viewdaylinktitle · events ·          │
// │                      hasevents · calendareventtypes · previousperiod ·  │
// │                      nextperiod · haslastdayofevent                     │
// │                      (`navigation` n'existe pas)                        │
// │  week_day_exporter   + istoday · isweekend · popovertitle · daytitle     │
// │                                                                         │
// │ Non vérifié : qu'un événement de durée non nulle soit rattaché à chaque  │
// │ jour qu'il couvre (le code est dans calendar/lib.php, pas dans les       │
// │ exporters). Sans effet sur A26 — le repérage a mesuré timeduration = 0   │
// │ sur les 50 événements — mais si c'est le cas, c'est `dedupeEvents` de    │
// │ content/studium.ts qui doit l'absorber, pas le parseur.                  │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Aucun test ne dépend de l'heure réelle : `now` est toujours passé en dur.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureStudium,
  flattenMonthlyEvents,
  readAjaxPayload,
  readCourses,
  type StudiumFetch,
} from "../src/content/studium";
import { allDeadlines, deadlineStatus, mergeStudium } from "../src/core/deadlines";
import { deadlinesFromStudium, studiumCourses } from "../src/core/studium";
import type { Deadline, RawStudiumCapture } from "../src/core/model";
import type { StoredState } from "../src/lib/messages";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8"));

const BRUT = fixture("studium-monthly-2026-09-brut.json");
const PLATE = fixture("studium-monthly-2026-09.json") as RawStudiumCapture;

/** Réponse de `core_course_get_enrolled_courses_by_timeline_classification`. */
const TIMELINE = [{ error: false, data: { courses: PLATE.courses, nextoffset: PLATE.courses.length } }];

const byId = <T extends { id: number | string }>(list: T[]): T[] =>
  [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));

/**
 * Un `fetch` injecté qui rend la fixture de septembre pour CHACUN des cinq mois
 * demandés. C'est volontairement le pire cas : le même événement revient cinq
 * fois, ce que `dedupeEvents` puis le parseur doivent absorber sans broncher.
 */
function fakeFetch(): { fetch: StudiumFetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: StudiumFetch = async (url) => {
    urls.push(url);
    const data = url.includes("monthly_view") ? BRUT : TIMELINE;
    return { ok: true, status: 200, json: async () => data };
  };
  return { fetch, urls };
}

const SESSKEY = "aBcD1234efGH";
const NOW = new Date(2026, 8, 10); // 10 septembre 2026, heure locale de la machine

async function runChain(): Promise<RawStudiumCapture> {
  const { fetch } = fakeFetch();
  const outcome = await captureStudium(fetch, SESSKEY, NOW);
  if (!outcome.ok) throw new Error(`capture échouée : ${outcome.error}`);
  return outcome.capture;
}

// ---------------------------------------------------------------------------

describe("l'enveloppe brute → la capture", () => {
  it("démêle `[{ error, data }]` et rend le corps du mois", () => {
    const outcome = readAjaxPayload(BRUT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect((outcome.data as { periodname?: string }).periodname).toBe("septembre 2026");
  });

  it("aplatit weeks → days → events sur exactement les événements de la fixture plate", () => {
    // Le raccord qui compte : ce que 07 produit est ce que je consomme. Les
    // deux fixtures sont d'accord par construction, ce test le vérifie.
    const outcome = readAjaxPayload(BRUT);
    if (!outcome.ok) throw new Error("enveloppe illisible");
    const flat = flattenMonthlyEvents(outcome.data);
    expect(flat).toHaveLength(PLATE.events.length);
    expect(byId(flat)).toEqual(byId(PLATE.events));
  });

  it("ne tire aucun événement du bourrage de grille", () => {
    const weeks = (BRUT as [{ data: { weeks: Array<{ prepadding: unknown; days: unknown[] }> } }])[0].data
      .weeks;
    // `prepadding` est une liste d'entiers de remplissage, pas des jours.
    expect(weeks[0]?.prepadding).toEqual([0, 1]);
    expect(weeks.flatMap((w) => w.days)).toHaveLength(30);
  });

  it("rend le code d'erreur Moodle quand la session a expiré", () => {
    const refus = [{ error: true, exception: { errorcode: "invalidsesskey" } }];
    expect(readAjaxPayload(refus)).toEqual({ ok: false, error: "invalidsesskey" });
  });

  it("lit les sites de la vue chronologique", () => {
    const outcome = readAjaxPayload(TIMELINE);
    if (!outcome.ok) throw new Error("enveloppe illisible");
    expect(readCourses(outcome.data)).toEqual(PLATE.courses);
  });
});

describe("la chaîne complète, cinq mois interrogés", () => {
  it("interroge cinq mois puis les sites, et dédoublonne les cinq réponses identiques", async () => {
    const { fetch, urls } = fakeFetch();
    const outcome = await captureStudium(fetch, SESSKEY, NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(urls).toHaveLength(6); // 5 vues mensuelles + 1 liste de sites
    expect(outcome.capture.months).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    // 7 événements rendus 5 fois = 35 bruts, ramenés à 7 par l'id.
    expect(outcome.capture.events).toHaveLength(7);
  });

  it("ramène sept événements bruts à trois échéances (open + close = une seule)", async () => {
    const capture = await runChain();
    const deadlines = deadlinesFromStudium(capture);
    expect(capture.events).toHaveLength(7);
    expect(deadlines).toHaveLength(3);
    expect(deadlines.map((d) => d.title)).toEqual(["Quiz obligatoire-Thème 1", "Quiz-tp3", "Devoir 1"]);
  });

  it("rend des ids identiques d'un passage complet à l'autre", async () => {
    const first = deadlinesFromStudium(await runChain());
    const second = deadlinesFromStudium(await runChain());
    expect(second.map((d) => d.id)).toEqual(first.map((d) => d.id));
    expect(second).toEqual(first);
  });

  it("rend start et due en heure de Montréal, pas en UTC", async () => {
    const quiz = deadlinesFromStudium(await runChain()).find((d) => d.title === "Quiz-tp3");
    expect(quiz?.start).toBe("2026-09-14T10:30");
    expect(quiz?.due).toBe("2026-09-17T23:59");
    // Le piège : `toISOString()` aurait rendu 2026-09-18T03:59 — le mauvais jour.
    expect(quiz?.due.startsWith("2026-09-17")).toBe(true);
  });

  it("déduit le sigle sur un site -AB, dont l'idnumber est vide", async () => {
    const capture = await runChain();
    const quiz = deadlinesFromStudium(capture).find((d) => d.title === "Quiz-tp3");
    expect(quiz?.courseCode).toBe("MAT1600");
    expect(quiz?.studiumCourseId).toBe(366018);
    const site = studiumCourses(capture).find((c) => c.id === 366018);
    expect(site?.shortname).toBe("MAT1600-AB-A26");
    expect(site?.courseCode).toBe("MAT1600");
  });

  it("ne laisse fuir ni sesskey ni authtoken dans les échéances", async () => {
    const { fetch, urls } = fakeFetch();
    const outcome = await captureStudium(fetch, SESSKEY, NOW);
    if (!outcome.ok) throw new Error("capture échouée");
    // Le sesskey circule bien dans l'URL d'appel…
    expect(urls[0]).toContain(`sesskey=${SESSKEY}`);
    // …mais rien de ce qui est stocké ne doit le porter.
    const stored = JSON.stringify(deadlinesFromStudium(outcome.capture));
    expect(stored).not.toContain(SESSKEY);
    expect(stored).not.toContain("sesskey");
    expect(stored).not.toContain("authtoken");
  });
});

describe("la capture → l'état stocké", () => {
  /** Un état d'avant la phase 12 : ni `deadlines`, ni `studium`, ni `courseLinks`. */
  const legacyState = (): StoredState => ({
    schedules: {},
    sources: {},
    lastCapturedAt: "2026-09-01T08:00",
    lastSource: "liste",
  });

  async function merged(state: StoredState = legacyState()): Promise<StoredState> {
    const capture = await runChain();
    return mergeStudium(
      state,
      deadlinesFromStudium(capture),
      studiumCourses(capture),
      "2026-09-10T12:00",
    );
  }

  it("traverse un état antérieur à la phase 12 sans rien exiger de lui", async () => {
    const before = legacyState();
    expect(before.deadlines).toBeUndefined();
    expect(before.studium).toBeUndefined();

    const after = await merged(before);
    expect(Object.keys(after.deadlines ?? {})).toHaveLength(3);
    expect(after.studium?.lastSyncAt).toBe("2026-09-10T12:00");
    expect(after.studium?.lastError).toBeNull();
    expect(after.studium?.courses).toHaveLength(5);
    // L'état d'entrée n'est pas muté, et ses champs d'origine survivent.
    expect(before.deadlines).toBeUndefined();
    expect(after.lastCapturedAt).toBe("2026-09-01T08:00");
  });

  it("rend les échéances triées, du plus proche au plus lointain", async () => {
    const state = await merged();
    expect(allDeadlines(state).map((d) => d.due)).toEqual([
      "2026-09-10T23:59",
      "2026-09-17T23:59",
      "2026-09-25T23:59",
    ]);
  });

  it("qualifie chaque échéance à un instant donné", async () => {
    const deadlines = allDeadlines(await merged());
    const at = (now: string): string[] => deadlines.map((d) => deadlineStatus(d, now));
    // Le 15 à 9 h : le premier quiz est passé, tp3 est ouvert depuis la veille,
    // le devoir n'a pas de fenêtre et reste à venir.
    expect(at("2026-09-15T09:00")).toEqual(["overdue", "open", "upcoming"]);
    // Le jour de l'échéance de tp3, c'est l'échéance qui prime sur la fenêtre.
    expect(at("2026-09-17T08:00")).toEqual(["overdue", "due-today", "upcoming"]);
    // Avant l'ouverture de tp3, il est simplement à venir.
    expect(at("2026-09-12T08:00")).toEqual(["overdue", "upcoming", "upcoming"]);
  });

  it("garde une échéance manuelle qu'une resynchronisation ne connaît pas", async () => {
    const manual: Deadline = {
      id: "manuel:0d4c9f7e",
      source: "manuel",
      title: "Rendez-vous TGDE",
      kind: "evenement",
      due: "2026-09-15T14:00",
    };
    const state = legacyState();
    state.deadlines = { [manual.id]: manual };

    const after = await merged(state);
    expect(after.deadlines?.[manual.id]).toEqual(manual);
    expect(Object.keys(after.deadlines ?? {})).toHaveLength(4);
    expect(allDeadlines(after).map((d) => d.source)).toEqual([
      "studium",
      "manuel",
      "studium",
      "studium",
    ]);
  });

  it("ne réinstalle pas une échéance que l'utilisateur a masquée", async () => {
    const state = legacyState();
    state.hiddenDeadlines = ["studium:6624100"]; // Quiz-tp3
    const after = await merged(state);
    expect(after.deadlines?.["studium:6624100"]).toBeUndefined();
    expect(Object.keys(after.deadlines ?? {})).toHaveLength(2);
  });

  it("remplace les échéances StudiUM d'une synchronisation à l'autre", async () => {
    const first = await merged();
    const second = await merged(first);
    // Deuxième passage sur le même calendrier : toujours trois, pas six.
    expect(Object.keys(second.deadlines ?? {})).toHaveLength(3);
    expect(allDeadlines(second)).toEqual(allDeadlines(first));
  });
});
