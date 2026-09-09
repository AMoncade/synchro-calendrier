import { describe, expect, it } from "vitest";
import type { Schedule } from "../src/core/model";
import { allExams, currentTerm, emptyState, mergeCapture } from "../src/core/store";

function schedule(code: string, start: string, end: string, capturedAt = "2026-09-09T12:00:00Z", exams: Schedule["exams"] = []): Schedule {
  return {
    schemaVersion: 1,
    capturedAt,
    term: { code, label: code, start, end },
    courses: [],
    exams,
  };
}

const A26 = schedule("A26", "2026-09-01", "2026-12-23");
const H27 = schedule("H27", "2027-01-07", "2027-04-30");

describe("mergeCapture", () => {
  it("installe une capture liste et note la provenance", () => {
    const s = mergeCapture(emptyState(), A26, "liste");
    expect(s.schedules["A26"]).toBe(A26);
    expect(s.sources["A26"]).toBe("liste");
    expect(s.lastCapturedAt).toBe(A26.capturedAt);
    expect(s.lastSource).toBe("liste");
  });

  it("une capture liste remplace l'entrée du même trimestre", () => {
    const newer = schedule("A26", "2026-09-01", "2026-12-23", "2026-09-10T08:00:00Z");
    const s = mergeCapture(mergeCapture(emptyState(), A26, "liste"), newer, "liste");
    expect(s.schedules["A26"]).toBe(newer);
  });

  it("une capture centre ne remplace pas une liste", () => {
    const centre = schedule("A26", "2026-09-01", "2026-12-23", "2026-09-10T08:00:00Z");
    const s = mergeCapture(mergeCapture(emptyState(), A26, "liste"), centre, "centre");
    expect(s.schedules["A26"]).toBe(A26);
    expect(s.sources["A26"]).toBe("liste");
    expect(s.lastCapturedAt).toBe(centre.capturedAt);
    expect(s.lastSource).toBe("centre");
  });

  it("une capture centre remplace une capture centre", () => {
    const c1 = schedule("A26", "2026-09-01", "2026-12-23", "2026-09-01T08:00:00Z");
    const c2 = schedule("A26", "2026-09-01", "2026-12-23", "2026-09-02T08:00:00Z");
    const s = mergeCapture(mergeCapture(emptyState(), c1, "centre"), c2, "centre");
    expect(s.schedules["A26"]).toBe(c2);
    expect(s.sources["A26"]).toBe("centre");
  });

  it("fait coexister deux trimestres", () => {
    const s = mergeCapture(mergeCapture(emptyState(), A26, "liste"), H27, "liste");
    expect(Object.keys(s.schedules).sort()).toEqual(["A26", "H27"]);
  });

  it("ne mute pas l'état d'entrée", () => {
    const before = mergeCapture(emptyState(), A26, "liste");
    const snapshot = JSON.parse(JSON.stringify(before));
    mergeCapture(before, H27, "liste");
    expect(before).toEqual(snapshot);
  });
});

describe("currentTerm", () => {
  const s = mergeCapture(mergeCapture(emptyState(), A26, "liste"), H27, "liste");

  it("retourne le trimestre en cours", () => {
    expect(currentTerm(s, "2026-10-15")?.term.code).toBe("A26");
    expect(currentTerm(s, "2027-02-01")?.term.code).toBe("H27");
  });
  it("retourne le prochain trimestre entre deux", () => {
    expect(currentTerm(s, "2026-12-28")?.term.code).toBe("H27");
    expect(currentTerm(s, "2026-08-01")?.term.code).toBe("A26");
  });
  it("retourne le plus récent après le dernier", () => {
    expect(currentTerm(s, "2027-06-01")?.term.code).toBe("H27");
  });
  it("retourne undefined sans horaire", () => {
    expect(currentTerm(emptyState(), "2026-10-15")).toBeUndefined();
  });
});

describe("allExams", () => {
  it("trie les examens de tous les trimestres", () => {
    const a = schedule("A26", "2026-09-01", "2026-12-23", "x", [
      { courseCode: "MAT1400", kind: "final", date: "2026-12-17", start: "08:30", end: "11:30", location: "", label: "Examen final" },
      { courseCode: "MAT1400", kind: "intra", date: "2026-10-26", start: "15:30", end: "17:30", location: "", label: "Examen intra" },
    ]);
    const h = schedule("H27", "2027-01-07", "2027-04-30", "x", [
      { courseCode: "STT1700", kind: "intra", date: "2027-02-20", start: "09:00", end: "11:00", location: "", label: "Examen intra" },
    ]);
    const s = mergeCapture(mergeCapture(emptyState(), h, "liste"), a, "liste");
    expect(allExams(s).map((e) => e.date)).toEqual(["2026-10-26", "2026-12-17", "2027-02-20"]);
  });
});
