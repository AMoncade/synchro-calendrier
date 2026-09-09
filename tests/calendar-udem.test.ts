import { describe, expect, it } from "vitest";
import {
  KNOWN_TERM_CODES,
  excludedDates,
  getTermCalendar,
  inferTermCode,
  isExcluded,
} from "../src/core/calendar-udem";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function days(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe("getTermCalendar", () => {
  it("couvre A26, H27 et E27", () => {
    expect(KNOWN_TERM_CODES).toEqual(["A26", "H27", "E27"]);
    for (const code of KNOWN_TERM_CODES) {
      expect(getTermCalendar(code)?.term.code).toBe(code);
    }
  });

  it("retourne undefined pour un trimestre inconnu", () => {
    expect(getTermCalendar("A25")).toBeUndefined();
    expect(getTermCalendar("")).toBeUndefined();
  });

  it("n'expose que des dates ISO, une source et une date de vérification", () => {
    for (const code of KNOWN_TERM_CODES) {
      const cal = getTermCalendar(code)!;
      const fields = [
        cal.term.start,
        cal.term.end,
        cal.classesStart,
        cal.classesEnd,
        cal.examsStart,
        cal.examsEnd,
        cal.breakStart,
        cal.breakEnd,
        ...cal.holidays.map((h) => h.date),
      ];
      for (const value of fields) if (value !== null) expect(value).toMatch(ISO);
      expect(cal.source).toMatch(/^https:\/\/registraire\.umontreal\.ca\//);
      expect(cal.verifiedOn).toMatch(ISO);
      expect(cal.term.start <= cal.term.end).toBe(true);
    }
  });

  it("A26 : bornes du registraire et dates de cours/examens de la FAS", () => {
    const cal = getTermCalendar("A26")!;
    expect(cal.term).toEqual({ code: "A26", label: "Automne 2026", start: "2026-09-01", end: "2026-12-23" });
    expect(cal.classesStart).toBe("2026-08-31");
    expect(cal.classesEnd).toBe("2026-12-09");
    expect(cal.examsStart).toBe("2026-12-10");
    expect(cal.examsEnd).toBe("2026-12-23");
    expect(cal.breakStart).toBe("2026-10-19");
    expect(cal.breakEnd).toBe("2026-10-25");
    expect(cal.facultySource).toMatch(/^https:\/\/fas\.umontreal\.ca\//);
  });

  it("H27 : bornes du registraire et dates de cours/examens de la FAS", () => {
    const cal = getTermCalendar("H27")!;
    expect(cal.term).toEqual({ code: "H27", label: "Hiver 2027", start: "2027-01-07", end: "2027-04-30" });
    expect(cal.classesStart).toBe("2027-01-07");
    expect(cal.classesEnd).toBe("2027-04-16");
    expect(cal.examsStart).toBe("2027-04-17");
    expect(cal.examsEnd).toBe("2027-04-30");
    expect(cal.breakStart).toBe("2027-03-01");
    expect(cal.breakEnd).toBe("2027-03-07");
  });

  it("E27 : pas de relâche, fin des cours et examens inconnus (null)", () => {
    const cal = getTermCalendar("E27")!;
    expect(cal.term).toEqual({ code: "E27", label: "Été 2027", start: "2027-05-03", end: "2027-08-13" });
    expect(cal.classesStart).toBe("2027-05-03");
    expect(cal.classesEnd).toBeNull();
    expect(cal.examsStart).toBeNull();
    expect(cal.examsEnd).toBeNull();
    expect(cal.breakStart).toBeNull();
    expect(cal.breakEnd).toBeNull();
    expect(cal.facultySource).toBeUndefined();
  });

  it("les congés sont triés et sans doublon", () => {
    for (const code of KNOWN_TERM_CODES) {
      const dates = getTermCalendar(code)!.holidays.map((h) => h.date);
      expect(dates).toEqual([...new Set(dates)].sort());
    }
  });
});

describe("excludedDates", () => {
  it("A26 : chaque jour de la relâche et chaque congé", () => {
    const excluded = excludedDates("A26");
    for (const day of days("2026-10-19", "2026-10-25")) expect(excluded).toContain(day);
    expect(excluded).toContain("2026-09-07"); // fête du Travail
    expect(excluded).toContain("2026-09-30"); // vérité et réconciliation
    expect(excluded).toContain("2026-10-05"); // élections provinciales (FAS)
    expect(excluded).toContain("2026-10-12"); // Action de grâce
    for (const day of days("2026-12-24", "2026-12-31")) expect(excluded).toContain(day);
    expect(excluded).toEqual([
      "2026-09-07",
      "2026-09-30",
      "2026-10-05",
      "2026-10-12",
      ...days("2026-10-19", "2026-10-25"),
      ...days("2026-12-24", "2026-12-31"),
    ]);
  });

  it("A26 : ne retire pas un jour de cours ordinaire", () => {
    const excluded = excludedDates("A26");
    for (const day of ["2026-08-31", "2026-09-01", "2026-09-08", "2026-10-26", "2026-12-09"]) {
      expect(excluded).not.toContain(day);
    }
  });

  it("H27 : relâche, Pâques et début janvier", () => {
    const excluded = excludedDates("H27");
    expect(excluded).toEqual([
      ...days("2027-01-01", "2027-01-04"),
      ...days("2027-03-01", "2027-03-07"),
      "2027-03-26",
      "2027-03-29",
    ]);
    expect(excluded).not.toContain("2027-01-07");
    expect(excluded).not.toContain("2027-03-08");
  });

  it("E27 : seulement les fériés", () => {
    expect(excludedDates("E27")).toEqual(["2027-05-24", "2027-06-24", "2027-07-01"]);
  });

  it("est triée et sans doublon pour chaque trimestre", () => {
    for (const code of KNOWN_TERM_CODES) {
      const excluded = excludedDates(code);
      expect(excluded).toEqual([...new Set(excluded)].sort());
      for (const day of excluded) expect(day).toMatch(ISO);
    }
  });

  it("trimestre inconnu → tableau vide", () => {
    expect(excludedDates("A25")).toEqual([]);
    expect(excludedDates("xyz")).toEqual([]);
  });

  it("retourne une nouvelle copie à chaque appel", () => {
    const first = excludedDates("A26");
    first.push("bidon");
    expect(excludedDates("A26")).not.toContain("bidon");
  });
});

describe("isExcluded", () => {
  it("est cohérent avec excludedDates", () => {
    for (const code of KNOWN_TERM_CODES) {
      for (const day of excludedDates(code)) expect(isExcluded(code, day)).toBe(true);
    }
    expect(isExcluded("A26", "2026-10-22")).toBe(true);
    expect(isExcluded("A26", "2026-10-26")).toBe(false);
    expect(isExcluded("H27", "2027-03-29")).toBe(true);
    expect(isExcluded("H27", "2027-03-30")).toBe(false);
  });

  it("trimestre inconnu → false", () => {
    expect(isExcluded("A25", "2025-10-13")).toBe(false);
  });
});

describe("inferTermCode", () => {
  it("découpe l'année en A / H / E aux bornes", () => {
    expect(inferTermCode("2026-08-31")).toBe("E26");
    expect(inferTermCode("2026-09-01")).toBe("A26");
    expect(inferTermCode("2026-12-31")).toBe("A26");
    expect(inferTermCode("2027-01-01")).toBe("H27");
    expect(inferTermCode("2027-04-30")).toBe("H27");
    expect(inferTermCode("2027-05-01")).toBe("E27");
  });

  it("garde deux chiffres d'année", () => {
    expect(inferTermCode("2105-02-01")).toBe("H05");
  });

  it("renvoie undefined pour une entrée qui n'est pas une date ISO", () => {
    expect(inferTermCode("")).toBeUndefined();
    expect(inferTermCode("1er septembre 2026")).toBeUndefined();
    expect(inferTermCode("2026-13-01")).toBeUndefined();
    expect(inferTermCode("2026-9-1")).toBeUndefined();
  });

  it("retombe sur un trimestre connu pour les dates couvertes", () => {
    expect(getTermCalendar(inferTermCode("2026-10-20")!)?.term.label).toBe("Automne 2026");
    expect(getTermCalendar(inferTermCode("2027-03-03")!)?.term.label).toBe("Hiver 2027");
    expect(getTermCalendar(inferTermCode("2027-06-15")!)?.term.label).toBe("Été 2027");
  });
});
