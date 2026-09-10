// Tests de `src/core/studium.ts` — capture StudiUM → échéances.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ FIXTURE SYNTHÉTIQUE — écrite le 2026-09-10, à remplacer.                 │
// │                                                                         │
// │ `tests/fixtures/studium-monthly-2026-09.json` N'EST PAS une capture      │
// │ réelle : personne n'a encore enregistré de réponse JSON de StudiUM       │
// │ (l'extension Chrome était déconnectée ce jour-là). Elle est dérivée de   │
// │ la forme documentée dans le code source de Moodle 4.x                    │
// │ (`calendar/classes/external/event_exporter_base.php` et                  │
// │ `calendar_event_exporter.php`), remplie avec les noms, dates et sites    │
// │ RÉELS relevés dans docs/REPERAGE-STUDIUM-2026-09-10.md §4.               │
// │                                                                         │
// │ Ce qui est donc solide ici : les instants, les libellés, les `courseid`, │
// │ le fait qu'un quiz produise « s'ouvre » + « se termine ». Ce qui reste   │
// │ à confirmer : les NOMS de champs exacts et leur présence systématique.   │
// │ Voir le rapport de fin de la session `studium-parse` pour le détail      │
// │ champ par champ (« vu dans le source Moodle » / « supposé »).            │
// │                                                                         │
// │ À la première vraie capture : remplacer le fichier, garder les mêmes     │
// │ assertions. Si elles cassent, c'est la fixture qui mentait, pas le code. │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Aucun test ne dépend de l'heure réelle : les instants Unix sont construits en
// UTC explicite, donc le résultat ne bouge pas avec le fuseau de la machine.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Deadline, RawMoodleEvent, RawStudiumCapture } from "../src/core/model";
import { deadlinesFromStudium, parseShortname, studiumCourses, toLocalDateTime } from "../src/core/studium";

const capture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures", "studium-monthly-2026-09.json"), "utf8"),
) as RawStudiumCapture;

/** Heure locale de Montréal → secondes Unix. Septembre 2026 est en EDT (UTC-4). */
const edt = (day: number, hour: number, minute: number): number =>
  Date.UTC(2026, 8, day, hour + 4, minute) / 1000;

/** Idem en décembre 2026, qui est en EST (UTC-5). */
const est = (day: number, hour: number, minute: number): number =>
  Date.UTC(2026, 11, day, hour + 5, minute) / 1000;

const MAT1600AB = { id: 366018, shortname: "MAT1600-AB-A26", fullname: "Algèbre linéaire - TP (A26)" };

function event(over: Partial<RawMoodleEvent> & Pick<RawMoodleEvent, "eventtype" | "timestart">): RawMoodleEvent {
  return {
    id: 1,
    name: "Sans nom",
    timeduration: 0,
    course: MAT1600AB,
    ...over,
  };
}

function quizEvent(
  suffix: "open" | "close",
  timestart: number,
  over: Partial<RawMoodleEvent> = {},
): RawMoodleEvent {
  return event({
    eventtype: suffix,
    timestart,
    name: `Quiz-tp3 ${suffix === "open" ? "s'ouvre" : "se termine"}`,
    activityname: "Quiz-tp3",
    modulename: "quiz",
    component: "mod_quiz",
    url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6624100",
    ...over,
  });
}

const raw = (events: RawMoodleEvent[], courses: RawStudiumCapture["courses"] = []): RawStudiumCapture => ({
  months: ["2026-09"],
  events,
  courses,
});

const titles = (deadlines: Deadline[]): string[] => deadlines.map((d) => d.title);

// ---------------------------------------------------------------------------

describe("toLocalDateTime", () => {
  it("rend l'heure de Montréal, pas l'UTC, en heure avancée (EDT)", () => {
    // Le cas qui a coûté une couture sur ce projet : `toISOString()` aurait
    // rendu « 2026-09-11T03:59 », soit le mauvais jour.
    expect(toLocalDateTime(edt(10, 23, 59))).toBe("2026-09-10T23:59");
  });

  it("rend l'heure de Montréal en heure normale (EST)", () => {
    expect(toLocalDateTime(est(10, 23, 59))).toBe("2026-12-10T23:59");
  });

  it("garde le décalage juste de part et d'autre du changement d'heure", () => {
    // Retour à l'heure normale : dimanche 1er novembre 2026 à 02:00.
    expect(toLocalDateTime(Date.UTC(2026, 9, 31, 18, 0) / 1000)).toBe("2026-10-31T14:00"); // EDT
    expect(toLocalDateTime(Date.UTC(2026, 10, 2, 19, 0) / 1000)).toBe("2026-11-02T14:00"); // EST
  });

  it("rend minuit « 00:00 » et non « 24:00 »", () => {
    expect(toLocalDateTime(edt(14, 0, 0))).toBe("2026-09-14T00:00");
  });

  it("refuse un instant qui n'est pas un nombre fini", () => {
    expect(() => toLocalDateTime(Number.NaN)).toThrow(RangeError);
  });
});

describe("parseShortname", () => {
  it("découpe un site de TP (-AB, celui qui porte le travail évalué)", () => {
    expect(parseShortname("MAT1600-AB-A26")).toEqual({
      courseCode: "MAT1600",
      section: "AB",
      termCode: "A26",
    });
  });

  it("découpe un site principal", () => {
    expect(parseShortname("MAT1400-A-A26")).toEqual({
      courseCode: "MAT1400",
      section: "A",
      termCode: "A26",
    });
  });

  it("rend undefined sur un site qui n'est pas un cours", () => {
    expect(parseShortname("BIB-SOUTIEN-2026")).toBeUndefined();
  });

  it("rend undefined en minuscules — le motif est strict", () => {
    expect(parseShortname("mat1400-ab-a26")).toBeUndefined();
  });

  it("tolère les espaces autour", () => {
    expect(parseShortname("  MAT1400-AB-A26 ")?.courseCode).toBe("MAT1400");
  });

  it("rend undefined sur une entrée qui n'est pas une chaîne", () => {
    expect(parseShortname(undefined as unknown as string)).toBeUndefined();
  });
});

describe("studiumCourses", () => {
  it("fait l'union des inscriptions et des sites vus dans les événements", () => {
    const courses = studiumCourses(capture);
    // MAT1600-AB n'est présent que via ses événements ; MAT1500-A n'a aucun
    // événement et ne vient donc que de la liste des inscriptions.
    expect(courses.map((c) => c.shortname)).toEqual([
      "BIB-SOUTIEN-2026",
      "MAT1400-A-A26",
      "MAT1400-AB-A26",
      "MAT1500-A-A26",
      "MAT1600-AB-A26",
    ]);
  });

  it("déduit le sigle du shortname, y compris quand idnumber est vide", () => {
    const courses = studiumCourses(capture);
    const tp = courses.find((c) => c.id === 366020);
    expect(tp).toEqual({
      id: 366020,
      shortname: "MAT1400-AB-A26",
      fullname: "Calcul 1 - Travaux pratiques (A26)",
      courseCode: "MAT1400",
    });
  });

  it("laisse courseCode absent quand le shortname ne colle pas au motif", () => {
    const bib = studiumCourses(capture).find((c) => c.id === 412003);
    expect(bib?.courseCode).toBeUndefined();
  });

  it("dédoublonne par id", () => {
    const input = raw(
      [quizEvent("close", edt(17, 23, 59)), quizEvent("close", edt(17, 23, 59), { id: 2 })],
      [MAT1600AB, { ...MAT1600AB, fullname: "Autre libellé" }],
    );
    expect(studiumCourses(input)).toHaveLength(1);
  });

  it("ignore un site sans id ou sans shortname au lieu de lancer", () => {
    const input = raw([], [
      { id: 1 } as unknown as RawStudiumCapture["courses"][number],
      { shortname: "MAT1400-A-A26" } as unknown as RawStudiumCapture["courses"][number],
      MAT1600AB,
    ]);
    expect(studiumCourses(input).map((c) => c.id)).toEqual([366018]);
  });
});

describe("deadlinesFromStudium — la fixture de septembre", () => {
  const deadlines = deadlinesFromStudium(capture);

  it("garde trois échéances sur sept événements, triées par échéance", () => {
    expect(titles(deadlines)).toEqual(["Quiz obligatoire-Thème 1", "Quiz-tp3", "Devoir 1"]);
  });

  it("rend le close orphelin sans fenêtre d'ouverture", () => {
    expect(deadlines[0]).toEqual({
      id: "studium:6620001",
      source: "studium",
      courseCode: "MAT1400",
      studiumCourseId: 366020,
      title: "Quiz obligatoire-Thème 1",
      kind: "quiz",
      due: "2026-09-10T23:59",
      url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6620001",
    });
  });

  it("fusionne « s'ouvre » et « se termine » en une échéance avec fenêtre", () => {
    expect(deadlines[1]).toEqual({
      id: "studium:6624100",
      source: "studium",
      courseCode: "MAT1600",
      studiumCourseId: 366018,
      title: "Quiz-tp3",
      kind: "quiz",
      start: "2026-09-14T10:30",
      due: "2026-09-17T23:59",
      url: "https://studium.umontreal.ca/mod/quiz/view.php?id=6624100",
    });
  });

  it("rend un devoir (eventtype « due », modulename « assign »)", () => {
    expect(deadlines[2]).toEqual({
      id: "studium:6620500",
      source: "studium",
      courseCode: "MAT1400",
      studiumCourseId: 366020,
      title: "Devoir 1",
      kind: "devoir",
      due: "2026-09-25T23:59",
      url: "https://studium.umontreal.ca/mod/assign/view.php?id=6620500",
    });
  });

  it("jette le « s'ouvre » dont le « se termine » tombe le mois suivant", () => {
    expect(titles(deadlines)).not.toContain("Quiz-tp4");
  });

  it("jette les événements d'agenda (user, course)", () => {
    expect(titles(deadlines)).not.toContain("Rendez-vous TGDE");
    expect(deadlines.every((d) => d.studiumCourseId !== 349955)).toBe(true);
  });
});

describe("deadlinesFromStudium — les règles", () => {
  it("ignore un « s'ouvre » seul", () => {
    expect(deadlinesFromStudium(raw([quizEvent("open", edt(14, 10, 30))]))).toEqual([]);
  });

  it("accepte un « se termine » seul, sans start", () => {
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59))]));
    expect(deadline?.due).toBe("2026-09-17T23:59");
    expect(deadline?.start).toBeUndefined();
  });

  it("fusionne quel que soit l'ordre d'arrivée des deux événements", () => {
    const inOrder = deadlinesFromStudium(
      raw([quizEvent("open", edt(14, 10, 30)), quizEvent("close", edt(17, 23, 59))]),
    );
    const reversed = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59)), quizEvent("open", edt(14, 10, 30))]),
    );
    expect(reversed).toEqual(inOrder);
    expect(inOrder).toHaveLength(1);
  });

  it("ignore les autres eventtype", () => {
    const ignored = ["user", "course", "category", "site", "gradingdue", "expectcompletionon", ""];
    const events = ignored.map((eventtype, index) =>
      event({ eventtype, timestart: edt(15, 12, 0), id: index, name: "Repère", activityname: "Repère" }),
    );
    expect(deadlinesFromStudium(raw(events))).toEqual([]);
  });

  it("classe en « autre » un module inconnu qui se ferme", () => {
    const [deadline] = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59), { modulename: "h5pactivity" })]),
    );
    expect(deadline?.kind).toBe("autre");
  });

  it("classe en « devoir » un eventtype « due » même sans modulename connu", () => {
    const [deadline] = deadlinesFromStudium(
      raw([event({ eventtype: "due", timestart: edt(25, 23, 59), activityname: "Remise", modulename: null })]),
    );
    expect(deadline?.kind).toBe("devoir");
  });

  it("laisse tomber une fenêtre qui s'ouvrirait après sa fermeture", () => {
    const [deadline] = deadlinesFromStudium(
      raw([quizEvent("open", edt(20, 10, 30)), quizEvent("close", edt(17, 23, 59))]),
    );
    expect(deadline?.start).toBeUndefined();
    expect(deadline?.due).toBe("2026-09-17T23:59");
  });

  it("trie par échéance puis par titre", () => {
    const same = edt(17, 23, 59);
    const events = [
      quizEvent("close", same, { id: 1, activityname: "Zeta", url: "https://studium.umontreal.ca/mod/quiz/view.php?id=3" }),
      quizEvent("close", same, { id: 2, activityname: "Alpha", url: "https://studium.umontreal.ca/mod/quiz/view.php?id=2" }),
      quizEvent("close", edt(12, 23, 59), { id: 3, activityname: "Oméga", url: "https://studium.umontreal.ca/mod/quiz/view.php?id=1" }),
    ];
    expect(titles(deadlinesFromStudium(raw(events)))).toEqual(["Oméga", "Alpha", "Zeta"]);
  });
});

describe("deadlinesFromStudium — identité et idempotence", () => {
  it("rend exactement la même chose sur la même entrée passée deux fois", () => {
    expect(deadlinesFromStudium(capture)).toEqual(deadlinesFromStudium(capture));
  });

  it("ne compte qu'une échéance quand deux mois qui se chevauchent renvoient l'événement", () => {
    // Le vrai cas : la vue mensuelle de Moodle déborde sur les jours de
    // remplissage du mois voisin, donc le content script concatène des doublons.
    const doubled: RawStudiumCapture = {
      months: ["2026-09", "2026-10"],
      events: [...capture.events, ...capture.events],
      courses: capture.courses,
    };
    expect(deadlinesFromStudium(doubled)).toEqual(deadlinesFromStudium(capture));
  });

  it("garde le premier événement vu quand un doublon porte une autre heure", () => {
    // Deux mois qui se chevauchent renvoient normalement des valeurs identiques ;
    // si elles divergent, la règle est « premier vu gagne », pas « dernier écrase ».
    const deadlines = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59)), quizEvent("close", edt(18, 23, 59), { id: 2 })]),
    );
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.due).toBe("2026-09-17T23:59");
  });

  it("donne un id stable tiré du cmid de l'URL", () => {
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59))]));
    expect(deadline?.id).toBe("studium:6624100");
  });

  it("retombe sur courseid + nom normalisé quand l'URL manque", () => {
    const [deadline] = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59), { url: undefined, activityname: "Quiz obligatoire-Thème 1" })]),
    );
    expect(deadline?.id).toBe("studium:366018:quiz-obligatoire-theme-1");
  });

  it("ne confond pas l'id d'une URL de site avec un cmid", () => {
    // `/course/view.php?id=349955` porte un courseid, pas un id de module :
    // le prendre pour un cmid fabriquerait un id faux et fusionnerait à tort.
    const url = "https://studium.umontreal.ca/course/view.php?id=349955";
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59), { url })]));
    expect(deadline?.id).toBe("studium:366018:quiz-tp3");
  });

  it("recolle open et close par le nom quand aucun des deux n'a d'URL", () => {
    const deadlines = deadlinesFromStudium(
      raw([
        quizEvent("open", edt(14, 10, 30), { url: undefined }),
        quizEvent("close", edt(17, 23, 59), { url: undefined }),
      ]),
    );
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.start).toBe("2026-09-14T10:30");
  });

  it("ignore un événement sans URL et sans site — rien où accrocher un id", () => {
    expect(
      deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59), { url: undefined, course: null })])),
    ).toEqual([]);
  });
});

describe("deadlinesFromStudium — l'URL", () => {
  it("refuse une URL qui porte un authtoken", () => {
    const url = "https://studium.umontreal.ca/calendar/export_execute.php?userid=823466&authtoken=SECRET";
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59), { url })]));
    expect(deadline?.url).toBeUndefined();
  });

  it("refuse une URL qui porte un sesskey mais garde l'échéance et son cmid", () => {
    const url = "https://studium.umontreal.ca/mod/quiz/view.php?id=6624100&sesskey=aBcDeF";
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59), { url })]));
    expect(deadline?.url).toBeUndefined();
    expect(deadline?.id).toBe("studium:6624100");
  });

  it("refuse un schéma autre que http(s)", () => {
    const url = "javascript:alert(1)//mod/quiz/view.php?id=9";
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59), { url })]));
    expect(deadline?.url).toBeUndefined();
  });

  it("copie une URL de module telle quelle", () => {
    const [deadline] = deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59))]));
    expect(deadline?.url).toBe("https://studium.umontreal.ca/mod/quiz/view.php?id=6624100");
  });
});

describe("deadlinesFromStudium — le titre", () => {
  it("préfère activityname au libellé", () => {
    const [deadline] = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59), { name: "n'importe quoi se termine", activityname: "Quiz-tp3" })]),
    );
    expect(deadline?.title).toBe("Quiz-tp3");
  });

  it("retire « se termine » du libellé quand activityname manque", () => {
    const [deadline] = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59), { activityname: null })]),
    );
    expect(deadline?.title).toBe("Quiz-tp3");
  });

  it("retire « est à rendre » d'un devoir", () => {
    const [deadline] = deadlinesFromStudium(
      raw([
        event({
          eventtype: "due",
          timestart: edt(25, 23, 59),
          name: "Devoir 1 est à rendre",
          modulename: "assign",
          url: "https://studium.umontreal.ca/mod/assign/view.php?id=6620500",
        }),
      ]),
    );
    expect(deadline?.title).toBe("Devoir 1");
  });

  it("accepte l'apostrophe typographique de Moodle", () => {
    const [deadline] = deadlinesFromStudium(
      raw([
        quizEvent("open", edt(14, 10, 30), { name: "Quiz-tp3 s’ouvre", activityname: null }),
        quizEvent("close", edt(17, 23, 59), { name: "Quiz-tp3 se termine", activityname: null }),
      ]),
    );
    // Le « s'ouvre » n'est retiré que s'il a été reconnu ; sinon les deux
    // événements ne se recolleraient pas et l'échéance perdrait sa fenêtre.
    expect(deadline?.start).toBe("2026-09-14T10:30");
    expect(deadline?.title).toBe("Quiz-tp3");
  });

  it("laisse intact un libellé sans suffixe connu", () => {
    const [deadline] = deadlinesFromStudium(
      raw([quizEvent("close", edt(17, 23, 59), { name: "Examen maison", activityname: null })]),
    );
    expect(deadline?.title).toBe("Examen maison");
  });
});

describe("deadlinesFromStudium — tolérance", () => {
  it("ignore un événement sans timestart utilisable au lieu de lancer", () => {
    const broken = [
      quizEvent("close", Number.NaN),
      quizEvent("close", 0, { id: 2 }),
      quizEvent("close", "17 septembre" as unknown as number, { id: 3 }),
    ];
    expect(deadlinesFromStudium(raw(broken))).toEqual([]);
  });

  it("ignore un événement sans nom ni activityname", () => {
    expect(
      deadlinesFromStudium(raw([quizEvent("close", edt(17, 23, 59), { name: "", activityname: null })])),
    ).toEqual([]);
  });

  it("ignore une entrée nulle ou d'un autre type", () => {
    const events = [null, undefined, 42, "close", quizEvent("close", edt(17, 23, 59))];
    expect(deadlinesFromStudium(raw(events as unknown as RawMoodleEvent[]))).toHaveLength(1);
  });

  it("rend une liste vide sur une capture vide ou mal formée", () => {
    expect(deadlinesFromStudium(raw([]))).toEqual([]);
    expect(deadlinesFromStudium({} as unknown as RawStudiumCapture)).toEqual([]);
    expect(deadlinesFromStudium(undefined as unknown as RawStudiumCapture)).toEqual([]);
    expect(studiumCourses(undefined as unknown as RawStudiumCapture)).toEqual([]);
  });

  it("ignore un eventtype qui n'est pas une chaîne", () => {
    expect(
      deadlinesFromStudium(raw([event({ eventtype: 3 as unknown as string, timestart: edt(17, 23, 59) })])),
    ).toEqual([]);
  });
});
