// Test d'intégration : la chaîne réelle, bout en bout, sur les fixtures Synchro.
//
//   extract.ts → parse.ts → calendar-udem.excludedDates → expand.ts
//                                                       → conflicts.ts
//                                                       → ics.ts
//
// Les autres suites testent chaque module isolément ; celle-ci ne teste que les
// coutures, c'est-à-dire ce qu'aucun module ne voit tout seul. Quelques cas
// figent un **défaut connu** : ils sont nommés « DÉFAUT CONNU » et devront être
// inversés quand le défaut sera corrigé (le commentaire dit quoi attendre).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { excludedDates } from "../src/core/calendar-udem";
import { findConflicts } from "../src/core/conflicts";
import { expandSchedule } from "../src/core/expand";
import { generateIcs } from "../src/core/ics";
import { parseCapture, parsePasted, parsePastedText, textToCapture } from "../src/core/parse";
import { emptyState, mergeCapture } from "../src/core/store";
import { extractCapture } from "../src/content/extract";
import type { Occurrence, Schedule } from "../src/core/model";

const fixture = (name: string): string => readFileSync(resolve(__dirname, "fixtures", name), "utf8");
const parseDoc = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

/** Instant de capture figé : la chaîne doit être déterministe. */
const CAPTURED_AT = "2026-09-09T12:00:00.000Z";
const EXCLUDED = excludedDates("A26");

// ---------------------------------------------------------------------------
// Outils ICS : déplier les lignes (RFC 5545 §3.1) puis découper en VEVENT.
// ---------------------------------------------------------------------------

function unfold(ics: string): string[] {
  const out: string[] = [];
  for (const line of ics.split("\r\n")) {
    if (line.startsWith(" ") && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

interface VEvent {
  uid: string;
  dtstart: string;
  dtend: string;
  rrule: string;
  exdate: string;
  summary: string;
  location: string;
}

function vevents(ics: string): VEvent[] {
  const events: VEvent[] = [];
  let current: Partial<VEvent> | null = null;
  const take = (line: string, name: string): string | undefined => {
    if (line === `BEGIN:${name}` || !line.startsWith(name)) return undefined;
    const sep = line.indexOf(":");
    const prop = line.slice(0, sep);
    return prop === name || prop.startsWith(`${name};`) ? line.slice(sep + 1) : undefined;
  };
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") {
      current = { uid: "", dtstart: "", dtend: "", rrule: "", exdate: "", summary: "", location: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current as VEvent);
      current = null;
      continue;
    }
    if (!current) continue;
    for (const [name, key] of [
      ["UID", "uid"], ["DTSTART", "dtstart"], ["DTEND", "dtend"],
      ["RRULE", "rrule"], ["EXDATE", "exdate"], ["SUMMARY", "summary"], ["LOCATION", "location"],
    ] as const) {
      const value = take(line, name);
      if (value !== undefined) current[key] = value;
    }
  }
  return events;
}

const countByLabel = (occurrences: Occurrence[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const o of occurrences) out[o.label] = (out[o.label] ?? 0) + 1;
  return out;
};

// ===========================================================================
// 1. Page « Votre horaire cours » (vue Liste), voie DOM
// ===========================================================================

describe("chaîne complète — page Liste, voie DOM", () => {
  const raw = extractCapture(parseDoc(fixture("liste-A26.html")))!;
  const schedule: Schedule = parseCapture(raw, { capturedAt: CAPTURED_AT });
  const occurrences = expandSchedule(schedule, { excludedDates: EXCLUDED });
  const courseOccurrences = occurrences.filter((o) => o.kind === "cours");
  const ics = generateIcs(schedule, { excludedDates: EXCLUDED, dtstamp: CAPTURED_AT });
  const events = vevents(ics);

  it("reconnaît le trimestre et les deux cours de la fixture HTML", () => {
    expect(raw.source).toBe("liste");
    expect(schedule.term).toEqual({
      code: "A26",
      label: "Automne 2026",
      start: "2026-09-01",
      end: "2026-12-23",
    });
    // Deux blocs <h2>, mais quatre entités : chaque bloc porte un TH et un TP
    // de sections différentes, séparés par parse.ts sur la clé section|volet.
    expect(schedule.courses.map((c) => `${c.code}-${c.section}-${c.component}`)).toEqual([
      "MAT1600-A102-TP",
      "MAT1600-A-TH",
      "STT1700-A-TH",
      "STT1700-A103-TP",
    ]);
    expect(schedule.exams).toHaveLength(5);
  });

  // (a) Aucune séance sur une date exclue par le calendrier universitaire.
  it("ne place aucune séance sur un congé ni pendant la relâche", () => {
    const forbidden = [
      "2026-09-07", // fête du Travail
      "2026-09-30", // vérité et réconciliation
      "2026-10-05", // élections provinciales (calendrier FAS)
      "2026-10-12", // Action de grâce
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", // relâche
      "2026-10-23", "2026-10-24", "2026-10-25",
    ];
    expect(EXCLUDED).toEqual(expect.arrayContaining(forbidden));
    for (const date of forbidden) {
      expect(courseOccurrences.filter((o) => o.date === date)).toEqual([]);
    }
  });

  // (a bis) Le lendemain de la relâche, les cours reprennent : l'exclusion ne
  // doit pas déborder (26/10 est un lundi et le premier jour des plages 2).
  it("fait reprendre les cours le lundi 26 octobre", () => {
    const monday = courseOccurrences.filter((o) => o.date === "2026-10-26");
    expect(monday.map((o) => o.label).sort()).toEqual([
      "MAT 1600-A Algèbre linéaire (TH)",
      "STT 1700-A Introduction à la statistique (TH)",
    ]);
  });

  // (c) Synchro coupe déjà les plages du TP autour de ses propres intras ;
  // l'expansion ne doit pas les réintroduire, et les examens doivent rester.
  it("laisse les intras de STT 1700 sans TP concurrent les 07/10 et 11/11", () => {
    for (const date of ["2026-10-07", "2026-11-11"]) {
      const sameDay = occurrences.filter((o) => o.date === date);
      expect(sameDay.filter((o) => o.kind === "cours")).toEqual([]);
      expect(sameDay.map((o) => o.label)).toEqual(["STT 1700 — Examen intra"]);
    }
  });

  it("garde les examens même si le calendrier exclut leur date", () => {
    // Règle d'expand.ts : un examen n'est jamais retiré. Aucun examen de cette
    // fixture ne tombe un jour exclu, on vérifie donc la règle sur un cas forcé.
    const forced = expandSchedule(schedule, { excludedDates: [...EXCLUDED, "2026-10-16"] });
    expect(forced.filter((o) => o.date === "2026-10-16").map((o) => o.label)).toEqual([
      "MAT 1600 — Examen intra",
    ]);
  });

  // (d) Compte total, calculé à la main sur les plages de liste-A26.rows.json.
  //
  //   Repères : 31/08/2026 = lundi ; 01/09 = mardi. Exclusions A26 retenues :
  //   07/09 (lun), 30/09 (mer), 05/10 (lun), 12/10 (lun), 19→25/10 (relâche).
  //
  //   MAT 1600 TP A102 — vendredi 08:30
  //     31/08→09/10 : 04, 11, 18, 25/09, 02, 09/10 ................. 6
  //     26/10→09/12 : 30/10, 06, 13, 20, 27/11, 04/12 .............. 6   → 12
  //   MAT 1600 TH A — lundi 08:30
  //     31/08→16/10 : 31/08, 07*, 14, 21, 28/09, 05*, 12*/10 → 7 − 3 .. 4
  //     26/10→09/12 : 26/10, 02, 09, 16, 23, 30/11, 07/12 .......... 7   → 11
  //   STT 1700 TH A — lundi 13:30 (mêmes plages que MAT 1600 TH) ..... 11
  //                 — mardi 12:30
  //     31/08→16/10 : 01, 08, 15, 22, 29/09, 06, 13/10 ............. 7
  //     26/10→09/12 : 27/10, 03, 10, 17, 24/11, 01, 08/12 .......... 7   → 14
  //   STT 1700 TP A103 — mercredi 13:30, quatre plages déjà coupées
  //     07/09→02/10 : 09, 16, 23, 30*/09 → 4 − 1 ................... 3
  //     12/10→16/10 : 14/10 ....................................... 1
  //     26/10→06/11 : 28/10, 04/11 ................................ 2
  //     16/11→09/12 : 18, 25/11, 02, 09/12 ........................ 4   → 10
  //
  //   Séances : 12 + 11 + 11 + 14 + 10 = 58.  Examens : 5.  Total 63.
  it("produit exactement 58 séances et 5 examens", () => {
    expect(courseOccurrences).toHaveLength(58);
    expect(occurrences.filter((o) => o.kind === "examen")).toHaveLength(5);
    expect(occurrences).toHaveLength(63);
    expect(countByLabel(occurrences)).toEqual({
      "MAT 1600-A102 Algèbre linéaire (TP)": 12,
      "MAT 1600-A Algèbre linéaire (TH)": 11,
      "STT 1700-A Introduction à la statistique (TH)": 25,
      "STT 1700-A103 Introduction à la statistique (TP)": 10,
      "STT 1700 — Examen intra": 2,
      "MAT 1600 — Examen intra": 1,
      "MAT 1600 — Examen final": 1,
      "STT 1700 — Examen final": 1,
    });
  });

  it("rend les occurrences triées et sans doublon", () => {
    const keys = occurrences.map((o) => `${o.date}|${o.start}|${o.label}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  // (e) Conflits attendus sur ce vrai horaire : aucun. Vérifié à la main —
  // lundi 08:30–10:30 (MAT 1600 TH) puis 13:30–15:30 (STT 1700 TH) ; mardi
  // 12:30–13:30 seul ; mercredi 13:30–15:30 seul ; vendredi 08:30–10:30 seul.
  // Les cinq examens tombent sur cinq dates distinctes, et Synchro a déjà retiré
  // les séances qui les recouvraient (07/10, 11/11, 16/10).
  it("ne détecte aucun conflit sur cet horaire réel", () => {
    expect(findConflicts(occurrences)).toEqual([]);
  });

  it("détecte un conflit dès qu'on en fabrique un (le détecteur est bien branché)", () => {
    const clash: Occurrence = {
      kind: "examen",
      courseCode: "XXX0000",
      label: "XXX 0000 — Examen intra",
      date: "2026-11-02", // lundi, sur le TH de MAT 1600
      start: "09:00",
      end: "11:00",
      location: "Z-000",
    };
    const conflicts = findConflicts([...occurrences, clash]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "cours-examen",
      date: "2026-11-02",
      start: "09:00",
      end: "10:30",
    });
  });

  // (f) L'ICS ré-analysé : un VEVENT par séance (12) + un par examen (5).
  it("écrit un VEVENT par séance et par examen", () => {
    expect(events).toHaveLength(17);
    const meetings = schedule.courses.reduce((n, c) => n + c.meetings.length, 0);
    expect(meetings).toBe(12);
    expect(events.filter((e) => e.rrule).length).toBe(12);
    expect(events.filter((e) => !e.rrule).length).toBe(5);
    for (const e of events) {
      expect(e.dtstart).toMatch(/^\d{8}T\d{6}$/);
      expect(e.summary).not.toBe("");
    }
  });

  // (f bis) Quelles séances portent réellement une date exclue dans leur plage ?
  // Seulement les trois premières plages : les deux séances du lundi (07/09,
  // 05/10, 12/10) et le TP du mercredi (30/09). Tout le reste est intact.
  it("place les EXDATE sur les seules séances qui traversent une date exclue", () => {
    const withExdate = events.filter((e) => e.exdate).map((e) => `${e.summary} @${e.dtstart} → ${e.exdate}`);
    expect(withExdate.sort()).toEqual([
      "MAT1600-A — Théorie @20260831T083000 → 20260907T083000,20261005T083000,20261012T083000",
      "STT1700-A — Théorie @20260831T133000 → 20260907T133000,20261005T133000,20261012T133000",
      "STT1700-A103 — Travaux pratiques @20260909T133000 → 20260930T133000",
    ]);
    // Le TP du vendredi ne croise aucune exclusion : aucune EXDATE.
    const friday = events.filter((e) => e.summary === "MAT1600-A102 — Travaux pratiques");
    expect(friday).toHaveLength(2);
    expect(friday.every((e) => e.exdate === "")).toBe(true);
  });

  it("n'écrit aucune EXDATE avant le DTSTART", () => {
    for (const e of events) {
      if (!e.exdate) continue;
      for (const d of e.exdate.split(",")) expect(d > e.dtstart).toBe(true);
    }
  });

  // Défaut corrigé (2026-09-09) : Synchro coupe une séance en plusieurs plages
  // autour de la relâche ; chaque plage est un VEVENT et doit avoir son UID
  // (la date de début en fait partie). Le TP du mercredi de STT 1700 a quatre
  // plages → quatre UID distincts.
  it("donne un UID distinct à chaque VEVENT, plages coupées comprises", () => {
    const uids = events.map((e) => e.uid);
    expect(uids).toHaveLength(17);
    expect(new Set(uids).size).toBe(events.length);
    expect(uids.filter((u) => u.startsWith("A26-STT1700-A103-TP-3-1330-"))).toHaveLength(4);
    expect(uids).toContain("A26-STT1700-A103-TP-3-1330-20260907@synchro-calendrier");
  });

  // Défaut corrigé (2026-09-09) : la note « séance en ligne, jour à communiquer »
  // appartient au TH de MAT 1600 et ne doit pas apparaître sur le TP du même bloc.
  it("rattache une note propre au TH à ce cours seulement", () => {
    const th = schedule.courses.find((c) => c.code === "MAT1600" && c.component === "TH")!;
    const tp = schedule.courses.find((c) => c.code === "MAT1600" && c.component === "TP")!;
    const note = "Séance TH 08:30–10:30, jour à communiquer (En ligne)";
    expect(th.notes).toEqual([note]);
    expect(tp.notes).toBeUndefined();
  });
});

// ===========================================================================
// 2. Repli « Coller mon horaire » sur la même page Liste (4 cours)
// ===========================================================================

describe("chaîne complète — collage du texte de la page Liste", () => {
  const pasted = parsePastedText(fixture("liste-A26.txt"), { capturedAt: CAPTURED_AT });
  const occurrences = expandSchedule(pasted, { excludedDates: EXCLUDED });

  it("retrouve les quatre cours et les neuf examens du texte collé", () => {
    expect(pasted.term.code).toBe("A26");
    expect(pasted.courses.map((c) => `${c.code}-${c.section}-${c.component}`)).toEqual([
      "MAT1400-A-TH", "MAT1400-A102-TP",
      "MAT1500-A-TH", "MAT1500-A102-TP",
      "MAT1600-A102-TP", "MAT1600-A-TH",
      "STT1700-A-TH", "STT1700-A103-TP",
    ]);
    expect(pasted.exams).toHaveLength(9);
  });

  // (b) Le cas qui justifie tout le module calendar-udem : Synchro affiche le TP
  // de MAT 1400 le lundi 12/10 (plage 07/09→16/10, sans coupure), alors que
  // l'UdeM est fermée ce jour-là (Action de grâce). Sans l'exclusion, la séance
  // existe ; avec l'exclusion, elle disparaît — et elle seule.
  it("retire le TP de MAT 1400 du lundi 12 octobre (Action de grâce)", () => {
    const sansExclusion = expandSchedule(pasted, { excludedDates: [] });
    const ce12 = sansExclusion.filter((o) => o.date === "2026-10-12").map((o) => o.label).sort();
    expect(ce12).toEqual([
      "MAT 1400-A102 Calcul 1 (TP)",
      "MAT 1500-A Mathématiques discrètes (TH)",
      "MAT 1600-A Algèbre linéaire (TH)",
      "STT 1700-A Introduction à la statistique (TH)",
    ]);
    // Le TP de STT 1700 est un mercredi : sa plage 12/10→16/10 commence le
    // lundi 12 mais sa première séance tombe le 14. Il n'est donc pas concerné.
    expect(occurrences.filter((o) => o.date === "2026-10-12")).toEqual([]);
    // La semaine précédente et la suivante, le même TP a bien lieu.
    const tp = occurrences.filter((o) => o.label === "MAT 1400-A102 Calcul 1 (TP)").map((o) => o.date);
    expect(tp).toContain("2026-09-14");
    expect(tp).toContain("2026-11-02");
    expect(tp).not.toContain("2026-10-12");
    expect(tp).not.toContain("2026-10-19"); // relâche
  });

  it("ne détecte aucun conflit sur l'horaire complet des quatre cours", () => {
    // Vérifié à la main : lundi 08:30/10:30/13:30/15:30 s'enchaînent sans
    // chevauchement (fin = début n'est pas un conflit), mardi et mercredi sont
    // libres l'un de l'autre, et les neuf examens tombent sur neuf dates
    // distinctes — MAT 1400 EXI 26/10, MAT 1500 EXI 29/10, MAT 1600 EXI 16/10,
    // STT 1700 EXI 07/10 et 11/11, puis les finaux 10, 11, 15 et 17/12.
    expect(findConflicts(occurrences)).toEqual([]);
    const examDates = pasted.exams.map((e) => e.date);
    expect(new Set(examDates).size).toBe(examDates.length);
  });

  // (g) Les deux voies doivent converger : même ICS pour les cours communs.
  it("donne le même ICS que la voie DOM pour les deux cours communs", () => {
    const dom = parseCapture(extractCapture(parseDoc(fixture("liste-A26.html")))!, { capturedAt: CAPTURED_AT });
    const opts = { excludedDates: EXCLUDED, dtstamp: CAPTURED_AT };
    const common = (s: Schedule): VEvent[] =>
      vevents(generateIcs(s, opts)).filter((e) => /MAT1600|STT1700/.test(e.uid));
    const fromDom = common(dom);
    const fromText = common(pasted);
    expect(fromText).toHaveLength(17);
    expect(fromText).toEqual(fromDom);
  });
});

// ===========================================================================
// 3. Couture popup → store : d'où vient une capture collée ?
// ===========================================================================

describe("couture popup → store — provenance d'un collage", () => {
  // Le popup utilise parsePasted, qui rend la provenance reconnue à l'extraction
  // (défaut corrigé le 2026-09-09 : une heuristique sur les dates répondait
  // toujours « liste », car parse.ts remplit les plages manquantes).
  const centre = parsePasted(fixture("centre-etudiant-A26.txt"), { capturedAt: CAPTURED_AT });

  it("reconnaît bien un collage du Centre étudiant", () => {
    expect(textToCapture(fixture("centre-etudiant-A26.txt")).source).toBe("centre");
    expect(textToCapture(fixture("liste-A26.txt")).source).toBe("liste");
    expect(centre.source).toBe("centre");
    expect(parsePasted(fixture("liste-A26.txt"), { capturedAt: CAPTURED_AT }).source).toBe("liste");
    expect(centre.schedule.exams).toHaveLength(0);
    // Les plages sont remplies par défaut : elles ne permettent pas de deviner la source.
    expect(centre.schedule.courses.every((c) => c.meetings.every((m) => m.dateStart !== ""))).toBe(true);
  });

  it("un collage du Centre étudiant n'écrase pas un horaire complet stocké", () => {
    const complet = parseCapture(extractCapture(parseDoc(fixture("liste-A26.html")))!, { capturedAt: CAPTURED_AT });
    let state = mergeCapture(emptyState(), complet, "liste");
    expect(state.schedules["A26"]?.exams).toHaveLength(5);
    state = mergeCapture(state, centre.schedule, centre.source);
    expect(state.schedules["A26"]?.exams).toHaveLength(5);
    expect(state.sources["A26"]).toBe("liste");
  });

  // Défaut corrigé (2026-09-09) : `capturedAt` est un instant UTC ; la date de
  // calendrier locale est passée à part (`localDate`) pour deviner le trimestre
  // quand la page n'affiche ni libellé ni dates. Le 31 décembre à 20 h à
  // Montréal, la date UTC est déjà le 1er janvier.
  it("classe un collage du 31/12 au soir dans A26 grâce à la date locale", () => {
    const raw = textToCapture(fixture("centre-etudiant-A26.txt"));
    expect(raw.termLabel).toBe(""); // aucune ancre de trimestre sur cette page
    const soir = parseCapture(raw, { capturedAt: "2027-01-01T01:00:00.000Z", localDate: "2026-12-31" });
    expect(soir.term.code).toBe("A26");
    // Sans date locale, le repli UTC reste ce qu'il est : documenté, pas caché.
    expect(parseCapture(raw, { capturedAt: "2027-01-01T01:00:00.000Z" }).term.code).toBe("H27");
    const jour = parseCapture(raw, { capturedAt: "2026-12-31T17:00:00.000Z" });
    expect(jour.term.code).toBe("A26");
  });
});
