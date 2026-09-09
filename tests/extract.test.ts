import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPage, extractCapture } from "../src/content/extract";

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

interface RowsFixture {
  term: string;
  courses: { title: string; rows: string[][]; notes: string[] }[];
}
const oracle = JSON.parse(fixture("liste-A26.rows.json")) as RowsFixture;
const toRow = ([classNumber, section, component, daysTimes, location, instructor, dates, url]: string[]) => ({
  classNumber, section, component, daysTimes, location, instructor, dates, url,
});

describe("detectPage", () => {
  it("reconnaît les deux pages et rien d'autre", () => {
    expect(detectPage(parse(fixture("liste-A26.html")))).toBe("liste");
    expect(detectPage(parse(fixture("centre-etudiant-A26.html")))).toBe("centre");
    expect(detectPage(parse("<html><body><table><tr><th>Cours</th></tr></table></body></html>"))).toBeNull();
    expect(detectPage(parse("<html><body></body></html>"))).toBeNull();
  });
});

describe("extractCapture — « Votre horaire cours »", () => {
  const raw = extractCapture(parse(fixture("liste-A26.html")))!;

  it("lit l'en-tête de trimestre et les deux blocs présents", () => {
    expect(raw.source).toBe("liste");
    expect(raw.termLabel).toBe(oracle.term);
    expect(raw.blocks.map((b) => b.title)).toEqual(["MAT 1600 - Algèbre linéaire", "STT 1700 - Introduction à la statistique"]);
  });

  it("reproduit exactement les rangées de l'oracle pour MAT 1600 et STT 1700", () => {
    for (const block of raw.blocks) {
      const expected = oracle.courses.find((c) => c.title === block.title)!;
      expect(block.rows, block.title).toEqual(expected.rows.map(toRow));
      expect(block.notes, block.title).toEqual(expected.notes);
    }
    expect(raw.blocks[0]?.rows).toHaveLength(8);
    expect(raw.blocks[1]?.rows).toHaveLength(11);
    expect(raw.blocks[1]?.notes).toHaveLength(3);
  });

  it("retire les étiquettes responsives des cellules (sinon « Volet TH »)", () => {
    const withLabel = raw.blocks[0]!.rows[2]!;
    expect(withLabel.component).toBe("TH");
    expect(withLabel.classNumber).toBe("12280");
    expect(withLabel.location).toBe("P-310 Pav. Roger-Gaudry");
  });
});

describe("extractCapture — Centre étudiant", () => {
  const raw = extractCapture(parse(fixture("centre-etudiant-A26.html")))!;

  it("donne un bloc par cours, sans dates", () => {
    expect(raw.source).toBe("centre");
    expect(raw.termLabel).toBe("");
    expect(raw.blocks.map((b) => b.title)).toEqual(["MAT 1400", "MAT 1400", "MAT 1500", "MAT 1500", "MAT 1600", "MAT 1600", "STT 1700", "STT 1700"]);
    expect(raw.blocks[0]!.rows).toEqual([
      { classNumber: "1490", section: "A", component: "TH", daysTimes: "J 08:30 - 10:29", location: "B-0215 Pav. 3200 J.-Brillant", instructor: "", dates: "", url: "" },
      { classNumber: "1490", section: "A", component: "TH", daysTimes: "Ma 08:30 - 10:29", location: "E-310 Pav. Roger-Gaudry", instructor: "", dates: "", url: "" },
    ]);
  });

  it("garde « En ligne » sans heure comme rangée sans jour", () => {
    expect(raw.blocks[4]!.rows).toEqual([
      { classNumber: "12280", section: "A", component: "TH", daysTimes: "", location: "En ligne", instructor: "", dates: "", url: "" },
      { classNumber: "12280", section: "A", component: "TH", daysTimes: "Lun 08:30 - 10:29", location: "P-310 Pav. Roger-Gaudry", instructor: "", dates: "", url: "" },
    ]);
    expect(raw.blocks[6]!.rows).toHaveLength(2);
    expect(raw.blocks[7]!.rows[0]?.section).toBe("A103");
  });
});
