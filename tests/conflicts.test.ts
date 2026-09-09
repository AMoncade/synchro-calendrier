import { describe, expect, it } from "vitest";
import { findConflicts, findOverlaps, findSameDayExams } from "../src/core/conflicts";
import type { Occurrence } from "../src/core/model";

function occ(partial: Partial<Occurrence> & Pick<Occurrence, "label" | "start" | "end">): Occurrence {
  return {
    kind: "cours",
    courseCode: partial.label.slice(0, 8).replace(" ", ""),
    date: "2026-09-14",
    location: "Z-110",
    ...partial,
  };
}

const MAT = occ({ label: "MAT 1400-A Calcul 1 (TH)", start: "09:00", end: "10:30" });
const PHY = occ({ label: "PHY 1001-A Mécanique (TH)", start: "10:00", end: "11:30" });
const INTRA = occ({ kind: "examen", label: "ACT 1010 — Examen intra", start: "09:30", end: "12:30" });
const INTRA2 = occ({ kind: "examen", label: "STT 1700 — Examen intra", start: "13:00", end: "16:00" });

describe("findOverlaps", () => {
  it("signale un chevauchement cours/cours avec l'intersection", () => {
    expect(findOverlaps([PHY, MAT])).toEqual([
      { kind: "cours-cours", a: MAT.label, b: PHY.label, date: "2026-09-14", start: "10:00", end: "10:30" },
    ]);
  });

  it("signale un chevauchement cours/examen", () => {
    expect(findOverlaps([MAT, INTRA])).toEqual([
      { kind: "cours-examen", a: MAT.label, b: INTRA.label, date: "2026-09-14", start: "09:30", end: "10:30" },
    ]);
  });

  it("ne signale pas deux séances bord à bord", () => {
    const suivant = occ({ label: "IFT 1015-A Programmation 1 (TH)", start: "10:30", end: "12:00" });
    expect(findOverlaps([MAT, suivant])).toEqual([]);
  });

  it("ne signale rien pour des jours différents", () => {
    expect(findOverlaps([MAT, occ({ ...PHY, date: "2026-09-15" })])).toEqual([]);
  });

  it("ignore les doublons ré-importés", () => {
    expect(findOverlaps([MAT, { ...MAT }, MAT])).toEqual([]);
  });

  it("donne l'intervalle englobé quand l'un contient l'autre", () => {
    const court = occ({ label: "STT 1700-A Statistique (TP)", start: "10:00", end: "11:00" });
    expect(findOverlaps([INTRA, court])).toEqual([
      { kind: "cours-examen", a: INTRA.label, b: court.label, date: "2026-09-14", start: "10:00", end: "11:00" },
    ]);
  });

  it("compare chaque séance à toutes celles encore ouvertes", () => {
    const longue = occ({ label: "AAA 1000 Longue (TH)", start: "08:00", end: "12:00" });
    const conflits = findOverlaps([longue, MAT, PHY]);
    expect(conflits.map((c) => [c.a, c.b])).toEqual([
      [longue.label, MAT.label], // 09:00-10:30
      [MAT.label, PHY.label], // 10:00-10:30
      [longue.label, PHY.label], // 10:00-11:30
    ]);
  });
});

describe("findSameDayExams", () => {
  it("signale deux examens disjoints le même jour, du premier début à la dernière fin", () => {
    expect(findSameDayExams([INTRA2, INTRA, MAT])).toEqual([
      { kind: "examen-examen", a: INTRA.label, b: INTRA2.label, date: "2026-09-14", start: "09:30", end: "16:00" },
    ]);
  });

  it("ne signale rien pour un seul examen ou des examens à des jours différents", () => {
    expect(findSameDayExams([INTRA, occ({ ...INTRA2, date: "2026-09-15" })])).toEqual([]);
  });
});

describe("findConflicts", () => {
  it("réunit chevauchements et examens le même jour", () => {
    expect(findConflicts([PHY, INTRA2, MAT, INTRA])).toEqual([
      { kind: "cours-examen", a: MAT.label, b: INTRA.label, date: "2026-09-14", start: "09:30", end: "10:30" },
      { kind: "examen-examen", a: INTRA.label, b: INTRA2.label, date: "2026-09-14", start: "09:30", end: "16:00" },
      { kind: "cours-cours", a: MAT.label, b: PHY.label, date: "2026-09-14", start: "10:00", end: "10:30" },
      { kind: "cours-examen", a: INTRA.label, b: PHY.label, date: "2026-09-14", start: "10:00", end: "11:30" },
    ]);
  });

  it("ne signale qu'une fois deux examens qui se chevauchent", () => {
    const chevauchant = occ({ kind: "examen", label: "MAT 1400 — Examen intra", start: "11:00", end: "14:00" });
    expect(findConflicts([INTRA, chevauchant])).toEqual([
      { kind: "examen-examen", a: INTRA.label, b: chevauchant.label, date: "2026-09-14", start: "11:00", end: "12:30" },
    ]);
  });

  it("trie par date puis début, quel que soit l'ordre d'entrée", () => {
    const lundi = [MAT, PHY];
    const mardi = [occ({ ...INTRA, date: "2026-09-15" }), occ({ ...INTRA2, date: "2026-09-15" })];
    const dimanche = [occ({ ...MAT, date: "2026-09-13" }), occ({ ...PHY, date: "2026-09-13" })];
    const attendu = findConflicts([...dimanche, ...lundi, ...mardi]);
    expect(attendu.map((c) => `${c.date} ${c.start}`)).toEqual([
      "2026-09-13 10:00",
      "2026-09-14 10:00",
      "2026-09-15 09:30",
    ]);
    expect(findConflicts([...mardi, ...dimanche, ...lundi])).toEqual(attendu);
  });

  it("reste instantané sur un trimestre complet", () => {
    const occurrences: Occurrence[] = [];
    for (let day = 0; day < 15 * 7; day++) {
      const date = `2026-${String(9 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`;
      for (let i = 0; i < 12; i++) {
        const start = `${String(8 + i).padStart(2, "0")}:00`;
        const end = `${String(9 + i).padStart(2, "0")}:30`;
        occurrences.push(occ({ label: `COURS ${i}`, courseCode: `C${i}`, date, start, end }));
      }
    }
    const t0 = performance.now();
    const conflits = findConflicts(occurrences);
    expect(performance.now() - t0).toBeLessThan(200);
    // 11 chevauchements de 30 min par jour, sur 105 jours.
    expect(conflits).toHaveLength(105 * 11);
  });
});
