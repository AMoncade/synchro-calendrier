import { describe, expect, it } from "vitest";
import type { Schedule } from "../src/core/model";
import {
  addDays,
  courseLabel,
  dateToUtc,
  examLabel,
  expandSchedule,
  formatCourseCode,
  isoWeekday,
  meetingDates,
} from "../src/core/expand";

// Automne 2026 : le 1er septembre est un mardi, le 7 un lundi.
const fixture: Schedule = {
  schemaVersion: 1,
  capturedAt: "2026-09-09T12:00:00Z",
  term: { code: "A26", label: "Automne 2026", start: "2026-09-01", end: "2026-12-22" },
  courses: [
    {
      code: "MAT1400",
      title: "Calcul 1",
      section: "A",
      classNumber: "12345",
      component: "TH",
      meetings: [
        { weekday: 1, start: "08:30", end: "10:30", location: "AA-1360", dateStart: "2026-09-07", dateEnd: "2026-09-28" },
        { weekday: 3, start: "13:30", end: "15:30", location: "AA-1360", dateStart: "2026-09-07", dateEnd: "2026-09-30" },
      ],
    },
    {
      code: "IFT1015",
      title: "Programmation 1",
      section: "B",
      component: "TP",
      meetings: [
        // dateStart un lundi : la première occurrence est le mardi suivant.
        {
          weekday: 2,
          start: "16:30",
          end: "18:30",
          location: "Pavillon André-Aisenstadt, salle 3195",
          dateStart: "2026-09-07",
          dateEnd: "2026-09-29",
        },
      ],
    },
  ],
  exams: [
    {
      courseCode: "MAT1400",
      kind: "intra",
      date: "2026-10-20",
      start: "08:30",
      end: "11:30",
      location: "Z-110",
      label: "Examen intra",
    },
  ],
};

describe("dates en UTC pur", () => {
  it("calcule le jour ISO sans dépendre du fuseau local", () => {
    expect(isoWeekday("2026-09-01")).toBe(2); // mardi
    expect(isoWeekday("2026-09-06")).toBe(7); // dimanche
    expect(isoWeekday("2026-09-07")).toBe(1); // lundi
  });

  it("rejette les dates mal formées ou inexistantes", () => {
    expect(() => dateToUtc("2026-9-1")).toThrow();
    expect(() => dateToUtc("2026-02-30")).toThrow();
    expect(() => dateToUtc("01/09/2026")).toThrow();
  });

  it("additionne des jours en franchissant mois et année", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("meetingDates", () => {
  it("liste une date par semaine, bornes incluses", () => {
    expect(meetingDates(fixture.courses[0]!.meetings[0]!)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
  });

  it("démarre au premier jour de semaine correspondant après dateStart", () => {
    expect(meetingDates(fixture.courses[1]!.meetings[0]!)).toEqual([
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
    ]);
  });

  it("retourne vide si dateEnd précède dateStart", () => {
    const meeting = {
      weekday: 1 as const,
      start: "08:30",
      end: "10:30",
      location: "",
      dateStart: "2026-09-28",
      dateEnd: "2026-09-07",
    };
    expect(meetingDates(meeting)).toEqual([]);
  });
});

describe("libellés", () => {
  it("espace le code de cours", () => {
    expect(formatCourseCode("MAT1400")).toBe("MAT 1400");
    expect(formatCourseCode("MAT 1400")).toBe("MAT 1400");
    expect(formatCourseCode("IFT2015A")).toBe("IFT 2015A");
  });

  it("compose le libellé d'un cours et d'un examen", () => {
    expect(courseLabel(fixture.courses[0]!)).toBe("MAT 1400-A Calcul 1 (TH)");
    expect(examLabel(fixture.exams[0]!)).toBe("MAT 1400 — Examen intra");
    expect(examLabel({ ...fixture.exams[0]!, kind: "final" })).toBe("MAT 1400 — Examen final");
    expect(examLabel({ ...fixture.exams[0]!, kind: "autre", label: "Test 2" })).toBe("MAT 1400 — Test 2");
  });
});

describe("expandSchedule", () => {
  const excludedDates = ["2026-09-14"];
  const occurrences = expandSchedule(fixture, { excludedDates });

  it("produit le nombre exact d'occurrences", () => {
    // 4 lundis + 4 mercredis + 4 mardis − 1 lundi exclu + 1 examen.
    expect(occurrences).toHaveLength(12);
    expect(occurrences.filter((o) => o.kind === "cours")).toHaveLength(11);
    expect(occurrences.filter((o) => o.kind === "examen")).toHaveLength(1);
  });

  it("n'a aucune occurrence sur la date exclue", () => {
    expect(occurrences.some((o) => o.date === "2026-09-14")).toBe(false);
    // Les autres lundis sont bien là.
    const mondays = occurrences
      .filter((o) => o.kind === "cours" && o.courseCode === "MAT1400" && o.start === "08:30")
      .map((o) => o.date);
    expect(mondays).toEqual(["2026-09-07", "2026-09-21", "2026-09-28"]);
  });

  it("est trié par date puis heure de début", () => {
    const keys = occurrences.map((o) => `${o.date}T${o.start}`);
    expect(keys).toEqual([...keys].sort());
    expect(occurrences[0]).toMatchObject({ date: "2026-09-07", start: "08:30" });
    expect(occurrences.at(-1)).toMatchObject({ kind: "examen", date: "2026-10-20" });
  });

  it("renseigne label, local et heures", () => {
    expect(occurrences[0]).toEqual({
      kind: "cours",
      courseCode: "MAT1400",
      label: "MAT 1400-A Calcul 1 (TH)",
      date: "2026-09-07",
      start: "08:30",
      end: "10:30",
      location: "AA-1360",
    });
  });

  it("n'exclut jamais un examen", () => {
    const out = expandSchedule(fixture, { excludedDates: ["2026-10-20"] });
    expect(out.filter((o) => o.kind === "examen")).toHaveLength(1);
  });

  it("ne mute pas l'entrée et est déterministe", () => {
    const copy = JSON.parse(JSON.stringify(fixture));
    const a = expandSchedule(fixture, { excludedDates });
    const b = expandSchedule(fixture, { excludedDates });
    expect(a).toEqual(b);
    expect(fixture).toEqual(copy);
  });
});
