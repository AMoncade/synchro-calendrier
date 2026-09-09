import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawCapture, RawCourseBlock } from "../src/core/model";
import {
  parseCapture,
  parseCourseTitle,
  parseDateRange,
  parseDaysTimes,
  parsePastedText,
  roundEnd,
  termCodeFromLabel,
  textToCapture,
} from "../src/core/parse";

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

interface RowsFixture {
  term: string;
  courses: { title: string; rows: string[][]; notes: string[] }[];
}

function captureFromRowsJson(): RawCapture {
  const data = JSON.parse(fixture("liste-A26.rows.json")) as RowsFixture;
  const blocks: RawCourseBlock[] = data.courses.map((c) => ({
    title: c.title,
    notes: c.notes,
    rows: c.rows.map(([classNumber, section, component, daysTimes, location, instructor, dates, url]) => ({
      classNumber: classNumber ?? "",
      section: section ?? "",
      component: component ?? "",
      daysTimes: daysTimes ?? "",
      location: location ?? "",
      instructor: instructor ?? "",
      dates: dates ?? "",
      url: url ?? "",
    })),
  }));
  return { source: "liste", termLabel: data.term, blocks };
}

const OPTS = { capturedAt: "2026-09-09T16:30:00-04:00" };

describe("briques", () => {
  it("lit jours et heures, arrondit la fin :29 → :30", () => {
    expect(parseDaysTimes("Ma 08:30 - 10:29")).toEqual({ weekday: 2, start: "08:30", end: "10:30" });
    expect(parseDaysTimes("Lun 15:30 - 17:29")).toEqual({ weekday: 1, start: "15:30", end: "17:30" });
    expect(parseDaysTimes("Mer 13:30 - 15:29")?.weekday).toBe(3);
    expect(parseDaysTimes("J 08:30 - 11:29")).toEqual({ weekday: 4, start: "08:30", end: "11:30" });
    expect(parseDaysTimes("V 08:30 - 10:29")?.weekday).toBe(5);
  });
  it("zéro-remplit « 8:30 » et respecte une fin déjà ronde", () => {
    expect(parseDaysTimes("Ma 8:30 - 10:30")).toEqual({ weekday: 2, start: "08:30", end: "10:30" });
    expect(roundEnd("23:59")).toBe("00:00");
    expect(roundEnd("10:45")).toBe("10:45");
  });
  it("garde une séance sans jour fixe avec weekday indéfini", () => {
    expect(parseDaysTimes("À communiquer 08:30 - 10:29")).toEqual({ weekday: undefined, start: "08:30", end: "10:30" });
  });
  it("retourne null sans plage horaire", () => {
    expect(parseDaysTimes("")).toBeNull();
    expect(parseDaysTimes("En ligne")).toBeNull();
  });
  it("lit les plages de dates jj/mm/aaaa et les dates uniques", () => {
    expect(parseDateRange("31/08/2026 - 16/10/2026")).toEqual({ start: "2026-08-31", end: "2026-10-16" });
    expect(parseDateRange("26/10/2026")).toEqual({ start: "2026-10-26", end: "2026-10-26" });
    expect(parseDateRange("")).toBeNull();
  });
  it("lit les titres de cours", () => {
    expect(parseCourseTitle("MAT 1400 - Calcul 1")).toEqual({ code: "MAT1400", title: "Calcul 1" });
    expect(parseCourseTitle("STT 1700 - Introduction à la statistique")).toEqual({ code: "STT1700", title: "Introduction à la statistique" });
    expect(parseCourseTitle("MAT 1400")).toEqual({ code: "MAT1400", title: "" });
    expect(parseCourseTitle("Remarques cours")).toBeNull();
  });
  it("déduit le code de trimestre de l'étiquette", () => {
    expect(termCodeFromLabel("Automne 2026 | Premier cycle | Université de Montréal")).toBe("A26");
    expect(termCodeFromLabel("Hiver 2027")).toBe("H27");
    expect(termCodeFromLabel("Été 2027 | …")).toBe("E27");
    expect(termCodeFromLabel("")).toBeUndefined();
  });
});

describe("parseCapture — page « Votre horaire cours » (4 cours réels)", () => {
  const schedule = parseCapture(captureFromRowsJson(), OPTS);

  it("reconnaît le trimestre A26 via le calendrier universitaire", () => {
    expect(schedule.term).toEqual({ code: "A26", label: "Automne 2026", start: "2026-09-01", end: "2026-12-23" });
    expect(schedule.capturedAt).toBe(OPTS.capturedAt);
  });

  it("produit un cours par (sigle, section, volet)", () => {
    const keys = schedule.courses.map((c) => `${c.code} ${c.section} ${c.component}`);
    expect(keys).toEqual([
      "MAT1400 A TH", "MAT1400 A102 TP",
      "MAT1500 A TH", "MAT1500 A102 TP",
      "MAT1600 A102 TP", "MAT1600 A TH",
      "STT1700 A TH", "STT1700 A103 TP",
    ]);
    expect(schedule.courses.map((c) => c.classNumber)).toEqual(["1490", "1523", "1571", "1574", "1578", "12280", "1628", "1631"]);
    expect(schedule.courses[0]?.title).toBe("Calcul 1");
  });

  it("garde les plages de dates telles qu'affichées (déjà coupées autour de la relâche)", () => {
    const mat1400 = schedule.courses.find((c) => c.code === "MAT1400" && c.component === "TH")!;
    expect(mat1400.meetings).toEqual([
      { weekday: 2, start: "08:30", end: "10:30", location: "E-310 Pav. Roger-Gaudry", dateStart: "2026-08-31", dateEnd: "2026-10-16" },
      { weekday: 4, start: "08:30", end: "10:30", location: "B-0215 Pav. 3200 J.-Brillant", dateStart: "2026-08-31", dateEnd: "2026-10-16" },
      { weekday: 2, start: "08:30", end: "10:30", location: "E-310 Pav. Roger-Gaudry", dateStart: "2026-10-26", dateEnd: "2026-12-09" },
      { weekday: 4, start: "08:30", end: "10:30", location: "B-0215 Pav. 3200 J.-Brillant", dateStart: "2026-10-26", dateEnd: "2026-12-09" },
    ]);
    const stt = schedule.courses.find((c) => c.code === "STT1700" && c.component === "TP")!;
    expect(stt.meetings.map((m) => `${m.dateStart}→${m.dateEnd}`)).toEqual([
      "2026-09-07→2026-10-02", "2026-10-12→2026-10-16", "2026-10-26→2026-11-06", "2026-11-16→2026-12-09",
    ]);
    expect(schedule.courses.reduce((n, c) => n + c.meetings.length, 0)).toBe(24);
  });

  it("transforme les volets EXI/EXF en examens, triés par date", () => {
    expect(schedule.exams).toHaveLength(9);
    expect(schedule.exams.map((e) => `${e.date} ${e.courseCode} ${e.kind}`)).toEqual([
      "2026-10-07 STT1700 intra", "2026-10-16 MAT1600 intra", "2026-10-26 MAT1400 intra",
      "2026-10-29 MAT1500 intra", "2026-11-11 STT1700 intra", "2026-12-10 MAT1500 final",
      "2026-12-11 MAT1600 final", "2026-12-15 STT1700 final", "2026-12-17 MAT1400 final",
    ]);
    expect(schedule.exams[7]).toEqual({
      courseCode: "STT1700", kind: "final", date: "2026-12-15", start: "12:30", end: "15:30",
      location: "N-515 Pav. Roger-Gaudry", label: "Examen final",
    });
  });

  it("met la séance « jour à communiquer » en note au lieu d'inventer un jour", () => {
    const th = schedule.courses.find((c) => c.code === "MAT1600" && c.component === "TH")!;
    expect(th.meetings).toHaveLength(2);
    expect(th.notes?.[0]).toBe("Séance TH 08:30–10:30, jour à communiquer (En ligne)");
    const tp = schedule.courses.find((c) => c.code === "MAT1600" && c.component === "TP")!;
    expect(tp.meetings).toHaveLength(2);
  });

  it("recopie les remarques du bloc sur chacun de ses cours", () => {
    const stt = schedule.courses.filter((c) => c.code === "STT1700");
    for (const c of stt) expect(c.notes).toContain("Les salles de cours peuvent être sujettes à modification.");
  });
});

describe("textToCapture — texte collé depuis « Votre horaire cours »", () => {
  it("reconstitue exactement les rangées de la capture DOM", () => {
    const fromText = textToCapture(fixture("liste-A26.txt"));
    const expected = captureFromRowsJson();
    expect(fromText.source).toBe("liste");
    expect(fromText.termLabel).toBe(expected.termLabel);
    expect(fromText.blocks.map((b) => b.title)).toEqual(expected.blocks.map((b) => b.title));
    for (let i = 0; i < expected.blocks.length; i++) {
      expect(fromText.blocks[i]?.rows, expected.blocks[i]?.title).toEqual(expected.blocks[i]?.rows);
      expect(fromText.blocks[i]?.notes, expected.blocks[i]?.title).toEqual(expected.blocks[i]?.notes);
    }
  });

  it("donne le même Schedule que la capture DOM", () => {
    expect(parsePastedText(fixture("liste-A26.txt"), OPTS)).toEqual(parseCapture(captureFromRowsJson(), OPTS));
  });
});

describe("textToCapture — texte collé depuis le Centre étudiant", () => {
  const raw = textToCapture(fixture("centre-etudiant-A26.txt"));

  it("reconnaît 8 blocs sans dates", () => {
    expect(raw.source).toBe("centre");
    expect(raw.blocks).toHaveLength(8);
    expect(raw.blocks[0]).toEqual({
      title: "MAT 1400",
      notes: [],
      rows: [
        { classNumber: "1490", section: "A", component: "TH", daysTimes: "J 08:30 - 10:29", location: "B-0215 Pav. 3200 J.-Brillant", instructor: "", dates: "", url: "" },
        { classNumber: "1490", section: "A", component: "TH", daysTimes: "Ma 08:30 - 10:29", location: "E-310 Pav. Roger-Gaudry", instructor: "", dates: "", url: "" },
      ],
    });
    expect(raw.blocks[4]?.rows[0]).toEqual({ classNumber: "12280", section: "A", component: "TH", daysTimes: "", location: "En ligne", instructor: "", dates: "", url: "" });
  });

  it("borne les séances sur le calendrier facultaire faute de dates", () => {
    const s = parsePastedText(fixture("centre-etudiant-A26.txt"), OPTS);
    expect(s.term.code).toBe("A26");
    expect(s.exams).toEqual([]);
    expect(s.courses).toHaveLength(8);
    const first = s.courses[0]!;
    expect(first.meetings[0]).toMatchObject({ weekday: 4, start: "08:30", end: "10:30", dateStart: "2026-08-31", dateEnd: "2026-12-09" });
    const mat1600 = s.courses.find((c) => c.code === "MAT1600" && c.component === "TH")!;
    expect(mat1600.notes).toEqual(["Section A : En ligne"]);
  });
});

describe("cas limites", () => {
  it("retombe sur la date de capture pour deviner le trimestre", () => {
    const s = parseCapture({ source: "centre", termLabel: "", blocks: [] }, { capturedAt: "2027-02-01T10:00:00" });
    expect(s.term.code).toBe("H27");
    expect(s.courses).toEqual([]);
  });
  it("construit un trimestre inconnu à partir des dates vues", () => {
    const s = parseCapture(
      { source: "liste", termLabel: "Automne 2031 | x", blocks: [{ title: "ABC 1000 - Test", notes: [], rows: [
        { classNumber: "1", section: "A", component: "TH", daysTimes: "Lun 9:00 - 10:59", location: "X", instructor: "", dates: "01/09/2031 - 01/12/2031", url: "" },
      ] }] },
      OPTS,
    );
    expect(s.term).toEqual({ code: "A31", label: "Automne 2031", start: "2031-09-01", end: "2031-12-01" });
    expect(s.courses[0]?.meetings[0]).toMatchObject({ start: "09:00", end: "11:00" });
  });
  it("ignore un bloc dont le titre n'est pas un cours", () => {
    const s = parseCapture({ source: "liste", termLabel: "", blocks: [{ title: "Remarques", notes: [], rows: [] }] }, OPTS);
    expect(s.courses).toEqual([]);
  });
});
