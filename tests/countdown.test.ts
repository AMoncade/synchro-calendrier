import { describe, expect, it } from "vitest";
import { nextExam } from "../src/core/countdown";
import type { Exam } from "../src/core/model";

function exam(partial: Partial<Exam> & Pick<Exam, "date">): Exam {
  return {
    courseCode: "MAT1400",
    kind: "intra",
    start: "09:00",
    end: "12:00",
    location: "Z-110",
    label: "MAT 1400 — Examen intra",
    ...partial,
  };
}

const INTRA = exam({ date: "2026-10-20" });
const FINAL = exam({ date: "2026-12-15", kind: "final", label: "MAT 1400 — Examen final", start: "13:00", end: "16:00" });
const EXAMS = [FINAL, INTRA];

describe("nextExam", () => {
  it("retourne le premier examen avant le premier", () => {
    expect(nextExam(EXAMS, "2026-09-14T08:00")).toEqual({ exam: INTRA, daysLeft: 36 });
  });

  it("retourne le second entre les deux", () => {
    expect(nextExam(EXAMS, "2026-10-21T08:00")).toEqual({ exam: FINAL, daysLeft: 55 });
  });

  it("compte 0 jour le jour même avant l'heure de fin", () => {
    expect(nextExam(EXAMS, "2026-10-20T11:59")).toEqual({ exam: INTRA, daysLeft: 0 });
  });

  it("passe au suivant le jour même après l'heure de fin", () => {
    expect(nextExam(EXAMS, "2026-10-20T12:01")).toEqual({ exam: FINAL, daysLeft: 56 });
  });

  it("compte 1 jour la veille, même tard le soir", () => {
    expect(nextExam(EXAMS, "2026-10-19T23:59")?.daysLeft).toBe(1);
  });

  it("retourne undefined après le dernier", () => {
    expect(nextExam(EXAMS, "2026-12-15T16:01")).toBeUndefined();
    expect(nextExam(EXAMS, "2027-01-01T00:00")).toBeUndefined();
  });

  it("retourne undefined sur une liste vide", () => {
    expect(nextExam([], "2026-09-14T08:00")).toBeUndefined();
  });

  it("choisit le plus tôt de deux examens le même jour", () => {
    const tardif = exam({ date: "2026-10-20", courseCode: "STT1700", label: "STT 1700 — Examen intra", start: "13:00", end: "16:00" });
    expect(nextExam([tardif, INTRA], "2026-10-20T08:00")?.exam).toBe(INTRA);
    expect(nextExam([tardif, INTRA], "2026-10-20T12:30")?.exam).toBe(tardif);
  });

  it("rejette un instant mal formé", () => {
    expect(() => nextExam(EXAMS, "2026-09-14")).toThrow(RangeError);
  });

  it("compte juste sur une longue échéance, par-dessus quatre changements de mois", () => {
    // Reprise de l'ancienne couverture de badgeText, qui plafonnait à « 99+ » :
    // le seul endroit où un écart de plus de trois mois était vérifié.
    expect(nextExam(EXAMS, "2026-06-01T08:00")?.daysLeft).toBe(141);
  });
});
