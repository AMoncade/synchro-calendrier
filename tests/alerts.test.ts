// Alertes (spec v2 §8.1, §8.3, §10.3) sur l'horaire réel A26.
//
// Examens de la fixture, dans l'ordre : intra 07/10, 16/10, 26/10, 29/10, 11/11,
// puis les quatre finaux 10/12, 11/12, 15/12 et 17/12.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  busyDay,
  classesRemainingToday,
  dedupeOccurrences,
  examClusters,
  minutesOfTime,
  parseLocalNow,
} from "../src/core/alerts";
import { excludedDates } from "../src/core/calendar-udem";
import { expandSchedule } from "../src/core/expand";
import { parseCapture } from "../src/core/parse";
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
const day = (date: string) => occurrences.filter((o) => o.date === date);

function exam(date: string, courseCode = "XXX1000"): Exam {
  return {
    courseCode,
    kind: "final",
    date,
    start: "08:30",
    end: "11:30",
    location: "A-100 Pav. Roger-Gaudry",
    label: `${courseCode} — Examen final`,
  };
}

describe("briques", () => {
  it("convertit une heure en minutes", () => {
    expect(minutesOfTime("00:00")).toBe(0);
    expect(minutesOfTime("08:30")).toBe(510);
    expect(minutesOfTime("23:59")).toBe(1439);
  });

  it("découpe un instant local et rejette un format inattendu", () => {
    expect(parseLocalNow("2026-09-09T13:45")).toEqual({ date: "2026-09-09", time: "13:45" });
    expect(parseLocalNow("2026-09-09T13:45:30")).toEqual({ date: "2026-09-09", time: "13:45" });
    expect(() => parseLocalNow("09/09/2026 13:45")).toThrow(RangeError);
  });

  it("retire les occurrences identiques en gardant l'ordre", () => {
    const mercredi = day("2026-09-09");
    expect(dedupeOccurrences([...mercredi, ...mercredi])).toEqual(mercredi);
  });
});

describe("examClusters", () => {
  it("trouve la grappe des quatre finaux, du 10 au 17 décembre", () => {
    const clusters = examClusters(exams);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.start).toBe("2026-12-10");
    expect(clusters[0]!.end).toBe("2026-12-17");
    expect(clusters[0]!.exams.map((e) => e.courseCode)).toEqual([
      "MAT1500",
      "MAT1600",
      "STT1700",
      "MAT1400",
    ]);
  });

  it("ne voit aucune grappe dans les intras, trop espacés", () => {
    const intras = exams.filter((e) => e.kind === "intra");
    expect(examClusters(intras)).toEqual([]);
  });

  it("fusionne deux fenêtres qui partagent un examen", () => {
    // 01, 02 et 03 février tiennent dans une fenêtre ; le 09 est à 8 jours du 01
    // (hors fenêtre) mais à 7 jours du 02 (dans la fenêtre) : une seule grappe.
    const clusters = examClusters([
      exam("2027-02-01", "AAA1000"),
      exam("2027-02-02", "BBB1000"),
      exam("2027-02-03", "CCC1000"),
      exam("2027-02-09", "DDD1000"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.start).toBe("2027-02-01");
    expect(clusters[0]!.end).toBe("2027-02-09");
    expect(clusters[0]!.exams).toHaveLength(4);
  });

  it("garde séparées deux grappes sans examen commun", () => {
    const clusters = examClusters([
      exam("2027-02-01", "AAA1000"),
      exam("2027-02-02", "BBB1000"),
      exam("2027-02-03", "CCC1000"),
      exam("2027-03-01", "DDD1000"),
      exam("2027-03-02", "EEE1000"),
      exam("2027-03-03", "FFF1000"),
    ]);
    expect(clusters.map((c) => [c.start, c.end])).toEqual([
      ["2027-02-01", "2027-02-03"],
      ["2027-03-01", "2027-03-03"],
    ]);
  });

  it("respecte la borne inclusive de la fenêtre", () => {
    const bord = [exam("2027-02-01", "A"), exam("2027-02-05", "B"), exam("2027-02-08", "C")];
    expect(examClusters(bord, 8)).toHaveLength(1); // 7 jours d'écart, dans la fenêtre
    expect(examClusters(bord, 7)).toEqual([]); // 7 jours d'écart, hors fenêtre
  });

  it("obéit aux paramètres de fenêtre et de seuil", () => {
    const finaux = exams.filter((e) => e.kind === "final");
    expect(examClusters(finaux, 3, 2).map((c) => [c.start, c.end])).toEqual([
      ["2026-12-10", "2026-12-11"],
      ["2026-12-15", "2026-12-17"],
    ]);
  });

  it("ignore les examens ré-importés en double", () => {
    const finaux = exams.filter((e) => e.kind === "final");
    expect(examClusters([...finaux, ...finaux])[0]!.exams).toHaveLength(4);
  });

  it("rend une liste vide sans examens, et refuse des paramètres absurdes", () => {
    expect(examClusters([])).toEqual([]);
    expect(() => examClusters(exams, 0)).toThrow(RangeError);
    expect(() => examClusters(exams, 8, 0)).toThrow(RangeError);
  });
});

describe("busyDay", () => {
  it("déclare chargé le lundi de quatre blocs", () => {
    expect(busyDay(day("2026-09-14"))).toBe(true);
  });

  it("ne déclare pas chargé le jeudi de deux blocs sur quatre heures", () => {
    expect(busyDay(day("2026-09-10"))).toBe(false);
  });

  it("ne déclare pas chargé le mercredi de deux blocs étalés sur sept heures", () => {
    // 08:30–10:30 et 13:30–15:30 : quatre heures de présence, un trou de trois heures.
    // La spec parle de présence, pas d'amplitude (défaut corrigé le 2026-09-09).
    expect(busyDay(day("2026-09-09"))).toBe(false);
  });

  it("laisse tranquille une journée d'un seul cours, et une journée vide", () => {
    expect(busyDay(day("2026-09-11"))).toBe(false);
    expect(busyDay([])).toBe(false);
  });

  it("compte la présence effective, blocs fusionnés", () => {
    const bloc = (start: string, end: string, i: number): Occurrence => ({
      kind: "cours",
      courseCode: `XXX${1000 + i}`,
      label: `XXX ${1000 + i} (TH)`,
      date: "2026-09-09",
      start,
      end,
      location: "A-100 Pav. Roger-Gaudry",
    });
    expect(busyDay([bloc("08:00", "14:00", 1)])).toBe(false); // six heures pile
    expect(busyDay([bloc("08:00", "14:01", 1)])).toBe(true); // au-delà de six heures
    expect(busyDay([bloc("08:00", "09:00", 1), bloc("13:00", "14:00", 2)])).toBe(false);
    // Deux blocs qui se chevauchent ne comptent pas double : 08:00–14:00 ∪ 09:00–13:00 = 6 h pile.
    expect(busyDay([bloc("08:00", "14:00", 1), bloc("09:00", "13:00", 2)])).toBe(false);
  });

  it("évalue chaque journée séparément si la liste en couvre plusieurs", () => {
    expect(busyDay([...day("2026-09-10"), ...day("2026-09-11")])).toBe(false);
    expect(busyDay([...day("2026-09-10"), ...day("2026-09-14")])).toBe(true);
  });
});

describe("classesRemainingToday", () => {
  it("compte les deux cours du mercredi avant le premier", () => {
    expect(classesRemainingToday(occurrences, "2026-09-09T08:00")).toBe(2);
  });

  it("compte encore le cours en train de se donner", () => {
    expect(classesRemainingToday(occurrences, "2026-09-09T09:00")).toBe(2);
  });

  it("ne compte plus un cours terminé à l'heure de fin pile", () => {
    expect(classesRemainingToday(occurrences, "2026-09-09T10:30")).toBe(1);
    expect(classesRemainingToday(occurrences, "2026-09-09T12:00")).toBe(1);
  });

  it("rend zéro une fois la journée finie", () => {
    expect(classesRemainingToday(occurrences, "2026-09-09T16:00")).toBe(0);
  });

  it("rend zéro un samedi", () => {
    expect(classesRemainingToday(occurrences, "2026-09-12T08:00")).toBe(0);
  });

  it("ne compte pas les examens", () => {
    // Le 7 octobre : un cours le matin, un examen intra de 13:30 à 15:30.
    expect(classesRemainingToday(occurrences, "2026-10-07T09:00")).toBe(1);
    expect(classesRemainingToday(occurrences, "2026-10-07T14:00")).toBe(0);
  });

  it("ignore un doublon ré-importé", () => {
    expect(classesRemainingToday([...occurrences, ...occurrences], "2026-09-09T08:00")).toBe(2);
  });
});
