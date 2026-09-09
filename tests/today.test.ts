// Vue « Aujourd'hui » sur l'horaire réel A26 (fixture `liste-A26.rows.json`),
// pour que les attentes soient des faits vérifiés et non des exemples inventés.
//
// Repères de la fixture, tous confirmés par la chaîne parse → expand :
//   mer. 09/09 : MAT1500 TH 08:30–10:30, STT1700 TP 13:30–15:30
//   jeu. 10/09 : MAT1400 TH 08:30–10:30, MAT1500 TP 10:30–12:30
//   ven. 11/09 : MAT1600 TP 08:30–10:30           sam. 12/09 et dim. 13/09 : rien
//   lun. 14/09 : quatre blocs de 08:30 à 17:30
//   relâche du 19 au 25/10 : rien ; reprise le lun. 26/10
//   dernière occurrence du trimestre : examen final MAT1400 le 17/12, 08:30–11:30

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { excludedDates } from "../src/core/calendar-udem";
import { expandSchedule } from "../src/core/expand";
import { parseCapture } from "../src/core/parse";
import { MAX_ITEMS, buildTodayView, pavillonOf } from "../src/core/today";
import type { Exam, Occurrence, RawCapture, RawCourseBlock } from "../src/core/model";

const CAPTURED_AT = "2026-09-09T16:30:00-04:00";

interface RowsFixture {
  term: string;
  courses: { title: string; rows: string[][]; notes: string[] }[];
}

function realSchedule(): { occurrences: Occurrence[]; exams: Exam[] } {
  const raw = readFileSync(resolve(__dirname, "fixtures", "liste-A26.rows.json"), "utf8");
  const data = JSON.parse(raw) as RowsFixture;
  const blocks: RawCourseBlock[] = data.courses.map((c) => ({
    title: c.title,
    notes: c.notes,
    rows: c.rows.map((r) => ({
      classNumber: r[0] ?? "",
      section: r[1] ?? "",
      component: r[2] ?? "",
      daysTimes: r[3] ?? "",
      location: r[4] ?? "",
      instructor: r[5] ?? "",
      dates: r[6] ?? "",
      url: r[7] ?? "",
    })),
  }));
  const capture: RawCapture = { source: "liste", termLabel: data.term, blocks };
  const schedule = parseCapture(capture, { capturedAt: CAPTURED_AT });
  return {
    occurrences: expandSchedule(schedule, { excludedDates: excludedDates("A26") }),
    exams: schedule.exams,
  };
}

const { occurrences, exams } = realSchedule();
const view = (now: string) => buildTodayView(occurrences, exams, now);
const codes = (items: { occurrence: Occurrence }[]) => items.map((i) => i.occurrence.courseCode);

describe("pavillonOf", () => {
  it("lit le texte après « Pav. »", () => {
    expect(pavillonOf("B-0215 Pav. 3200 J.-Brillant")).toBe("3200 J.-Brillant");
    expect(pavillonOf("P-310 Pav. Roger-Gaudry")).toBe("Roger-Gaudry");
    expect(pavillonOf("S1-151 Pav. Jean Coutu")).toBe("Jean Coutu");
  });

  it("rend undefined quand il n'y a pas de pavillon", () => {
    expect(pavillonOf("En ligne")).toBeUndefined();
    expect(pavillonOf("")).toBeUndefined();
  });
});

describe("buildTodayView — le jour même", () => {
  it("qualifie le cours en cours et le suivant, à 09:00 le mercredi", () => {
    const v = view("2026-09-09T09:00");
    expect(v.kind).toBe("today");
    expect(v.date).toBe("2026-09-09");
    expect(codes(v.items)).toEqual(["MAT1500", "STT1700"]);
    expect(v.items[0]!.status).toBe("now");
    expect(v.items[0]!.minutesToEnd).toBe(90); // fin 10:30
    expect(v.items[0]!.minutesToStart).toBeUndefined();
    expect(v.items[1]!.status).toBe("next");
    expect(v.items[1]!.minutesToStart).toBe(270); // début 13:30
    expect(v.doneItems).toEqual([]);
    expect(v.hiddenCount).toBe(0);
  });

  it("marque le même pavillon d'un bloc à l'autre", () => {
    const v = view("2026-09-09T09:00");
    // Les deux blocs du mercredi sont au pavillon 3200 J.-Brillant.
    expect(v.items[0]!.sameBuildingAsPrevious).toBeUndefined(); // premier bloc du jour
    expect(v.items[1]!.sameBuildingAsPrevious).toBe(true);
  });

  it("signale un changement de pavillon le lundi", () => {
    const v = view("2026-09-14T07:00");
    // P-310 et N-515 sont à Roger-Gaudry, puis B-0215 est au 3200 J.-Brillant.
    expect(v.items.map((i) => i.sameBuildingAsPrevious)).toEqual([undefined, true, false, true]);
  });

  it("sort du présent le bloc terminé et le range dans doneItems", () => {
    const v = view("2026-09-09T12:00");
    expect(v.kind).toBe("today");
    expect(codes(v.items)).toEqual(["STT1700"]);
    expect(v.items[0]!.status).toBe("next");
    expect(v.items[0]!.minutesToStart).toBe(90);
    expect(codes(v.doneItems)).toEqual(["MAT1500"]);
    expect(v.doneItems[0]!.status).toBe("done");
  });

  it("considère un bloc terminé à l'heure de fin pile", () => {
    const v = view("2026-09-09T10:30");
    expect(codes(v.doneItems)).toEqual(["MAT1500"]);
    expect(v.items[0]!.status).toBe("next");
  });

  it("considère un bloc en cours à l'heure de début pile", () => {
    const v = view("2026-09-09T08:30");
    expect(v.items[0]!.status).toBe("now");
    expect(v.items[0]!.minutesToEnd).toBe(120);
  });

  it("marque la journée chargée du lundi et pas celle du jeudi", () => {
    expect(view("2026-09-14T07:00").busy).toBe(true); // quatre blocs, 08:30 → 17:30
    expect(view("2026-09-10T07:00").busy).toBe(false); // deux blocs, 08:30 → 12:30
  });
});

describe("buildTodayView — bascules", () => {
  it("passe à demain quand tout est terminé", () => {
    const v = view("2026-09-09T18:00");
    expect(v.kind).toBe("tomorrow");
    expect(v.date).toBe("2026-09-10");
    expect(codes(v.items)).toEqual(["MAT1400", "MAT1500"]);
    expect(v.items.map((i) => i.status)).toEqual(["next", "later"]);
  });

  it("n'annonce pas de minutes pour un jour qui n'est pas aujourd'hui", () => {
    const v = view("2026-09-09T18:00");
    expect(v.items.every((i) => i.minutesToStart === undefined)).toBe(true);
    expect(v.items.every((i) => i.minutesToEnd === undefined)).toBe(true);
    expect(v.doneItems).toEqual([]); // les blocs terminés d'aujourd'hui ne suivent pas la bascule
  });

  it("saute au lundi le vendredi soir, demain étant vide", () => {
    const v = view("2026-09-11T18:00");
    expect(v.kind).toBe("next-day");
    expect(v.date).toBe("2026-09-14");
    expect(v.items).toHaveLength(4);
  });

  it("saute au lundi depuis le samedi, jour sans aucun cours", () => {
    const v = view("2026-09-12T10:00");
    expect(v.kind).toBe("nothing");
    expect(v.date).toBe("2026-09-14");
    expect(codes(v.items)).toEqual(["MAT1600", "MAT1500", "STT1700", "MAT1400"]);
    expect(v.busy).toBe(true);
  });

  it("saute la semaine de relâche jusqu'à la reprise du 26 octobre", () => {
    const v = view("2026-10-19T09:00");
    expect(v.kind).toBe("nothing");
    expect(v.date).toBe("2026-10-26");
    expect(v.items).toHaveLength(4); // trois cours puis l'examen intra de MAT1400
    expect(v.items[3]!.occurrence.kind).toBe("examen");
  });

  it("déclare le trimestre terminé après la dernière occurrence", () => {
    const v = view("2026-12-18T08:00");
    expect(v.kind).toBe("term-over");
    expect(v.date).toBe("2026-12-18");
    expect(v.items).toEqual([]);
    expect(v.doneItems).toEqual([]);
    expect(v.hiddenCount).toBe(0);
    expect(v.busy).toBe(false);
    expect(v.nextExam).toBeUndefined();
  });

  it("déclare le trimestre terminé le dernier jour, une fois l'examen final passé", () => {
    const v = view("2026-12-17T14:00");
    expect(v.kind).toBe("term-over");
    expect(v.date).toBe("2026-12-17");
    expect(v.items).toEqual([]);
    expect(codes(v.doneItems)).toEqual(["MAT1400"]); // l'examen final du matin
  });
});

describe("buildTodayView — prochain examen", () => {
  it("annonce l'examen à 28 jours", () => {
    const v = view("2026-09-09T09:00");
    expect(v.nextExam?.exam.courseCode).toBe("STT1700");
    expect(v.nextExam?.exam.date).toBe("2026-10-07");
    expect(v.nextExam?.daysLeft).toBe(28);
  });

  it("se tait au-delà de 30 jours", () => {
    // Le 31 août, le premier examen est à 37 jours.
    expect(view("2026-08-31T08:00").nextExam).toBeUndefined();
  });

  it("annonce encore l'examen à 30 jours pile", () => {
    expect(view("2026-09-07T08:00").nextExam?.daysLeft).toBe(30);
  });

  it("passe à l'examen suivant le jour même, une fois celui du jour terminé", () => {
    const v = view("2026-10-07T16:00");
    expect(v.nextExam?.exam.date).toBe("2026-10-16");
  });
});

describe("buildTodayView — plafond d'affichage", () => {
  const many: Occurrence[] = Array.from({ length: 8 }, (_, i) => ({
    kind: "cours" as const,
    courseCode: `XXX${1000 + i}`,
    label: `XXX ${1000 + i}-A Cours ${i} (TH)`,
    date: "2026-09-09",
    start: `${String(8 + i).padStart(2, "0")}:00`,
    end: `${String(8 + i).padStart(2, "0")}:50`,
    location: "A-100 Pav. Roger-Gaudry",
  }));

  it("plafonne à six blocs et compte le reste", () => {
    const v = buildTodayView(many, [], "2026-09-09T07:00");
    expect(v.items).toHaveLength(MAX_ITEMS);
    expect(v.hiddenCount).toBe(2);
    expect(v.items[0]!.status).toBe("next");
  });

  it("ne compte que les blocs à venir dans le plafond", () => {
    // À 12:30, quatre blocs sont passés (08:00 → 11:50), quatre restent.
    const v = buildTodayView(many, [], "2026-09-09T12:30");
    expect(v.items).toHaveLength(4);
    expect(v.hiddenCount).toBe(0);
    expect(v.doneItems).toHaveLength(4);
  });
});

describe("buildTodayView — robustesse", () => {
  it("rend term-over sur une liste vide", () => {
    const v = buildTodayView([], [], "2026-09-09T09:00");
    expect(v.kind).toBe("term-over");
    expect(v.items).toEqual([]);
    expect(v.nextExam).toBeUndefined();
  });

  it("ignore un doublon ré-importé", () => {
    const doubled = [...occurrences, ...occurrences];
    expect(buildTodayView(doubled, exams, "2026-09-09T09:00").items).toHaveLength(2);
  });

  it("rejette un instant mal formé", () => {
    expect(() => view("2026-09-09")).toThrow(RangeError);
  });
});
