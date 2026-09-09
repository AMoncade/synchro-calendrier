import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GCAL_BASE, GCAL_TZ, googleCalendarUrl } from "../src/core/gcal";
import { examSummary, formatLocation } from "../src/core/ics";
import { parsePastedText } from "../src/core/parse";

const fixture = (name: string): string => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

describe("googleCalendarUrl — forme", () => {
  const base = { title: "Examen", date: "2026-10-07", start: "13:30", end: "15:30" };

  it("compose l'URL TEMPLATE avec heures locales et fuseau nommé", () => {
    expect(googleCalendarUrl(base)).toBe(
      "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Examen" +
        "&dates=20261007T133000/20261007T153000&ctz=America%2FToronto",
    );
  });

  it("n'exporte jamais en UTC", () => {
    // 13:30 à Montréal, c'est 17:30 UTC en octobre. Aucun Z, aucun 1730.
    const url = googleCalendarUrl(base);
    expect(url).toContain("T133000");
    expect(url).not.toContain("Z&");
    expect(url).not.toContain("T173000");
    expect(url).toContain(`ctz=${encodeURIComponent(GCAL_TZ)}`);
    expect(url.startsWith(`${GCAL_BASE}?`)).toBe(true);
  });

  it("accepte les secondes et les complète sinon", () => {
    expect(googleCalendarUrl({ ...base, start: "08:00:30", end: "09:00" })).toContain(
      "dates=20261007T080030/20261007T090000",
    );
  });

  it("omet location et details quand ils sont absents ou vides", () => {
    expect(googleCalendarUrl(base)).not.toContain("location=");
    expect(googleCalendarUrl(base)).not.toContain("details=");
    expect(googleCalendarUrl({ ...base, location: "", details: "" })).toBe(googleCalendarUrl(base));
  });

  it("place les paramètres dans un ordre stable", () => {
    const url = googleCalendarUrl({ ...base, location: "Z-110", details: "note" });
    expect([...url.matchAll(/[?&](\w+)=/g)].map((m) => m[1])).toEqual([
      "action",
      "text",
      "dates",
      "ctz",
      "location",
      "details",
    ]);
  });

  it("refuse une date ou une heure mal formée", () => {
    expect(() => googleCalendarUrl({ ...base, date: "07/10/2026" })).toThrow();
    expect(() => googleCalendarUrl({ ...base, start: "8:30" })).toThrow();
    expect(() => googleCalendarUrl({ ...base, end: "" })).toThrow();
  });
});

describe("googleCalendarUrl — encodage", () => {
  it("échappe le & d'un titre pour qu'il ne coupe pas la requête", () => {
    const url = googleCalendarUrl({
      title: "MAT1400 — Examen intra & reprise",
      date: "2026-10-07",
      start: "13:30",
      end: "15:30",
    });
    expect(url).toContain("text=MAT1400%20%E2%80%94%20Examen%20intra%20%26%20reprise");
    // Un seul & de séparation par paramètre : celui du titre ne compte pas.
    expect(url.split("&")).toHaveLength(4);
  });

  it("échappe les autres caractères réservés", () => {
    const url = googleCalendarUrl({
      title: "A=B?C#D",
      date: "2026-10-07",
      start: "13:30",
      end: "15:30",
      location: "B-0215, Pavillon J.-Brillant",
      details: "Ligne 1\nLigne 2 + suite",
    });
    expect(url).toContain("text=A%3DB%3FC%23D");
    expect(url).toContain("location=B-0215%2C%20Pavillon%20J.-Brillant");
    expect(url).toContain("details=Ligne%201%0ALigne%202%20%2B%20suite");
    expect(url).not.toContain("#");
  });

  it("laisse littéral le seul / attendu, celui qui sépare les deux horodatages", () => {
    const url = googleCalendarUrl({ title: "x", date: "2026-10-07", start: "13:30", end: "15:30" });
    const query = url.slice(url.indexOf("?"));
    expect(query.match(/\//g)).toHaveLength(1);
    expect(query).toContain("20261007T133000/20261007T153000");
  });
});

describe("googleCalendarUrl — sur un examen réel de la fixture", () => {
  const schedule = parsePastedText(fixture("liste-A26.txt"), { capturedAt: "2026-09-09T12:00:00.000Z" });

  it("retrouve l'intra de STT 1700 tel que Synchro l'annonce", () => {
    const exam = schedule.exams.find((e) => e.courseCode === "STT1700" && e.kind === "intra")!;
    expect(exam).toMatchObject({
      date: "2026-10-07",
      start: "13:30",
      end: "15:30",
      location: "S1-151 Pav. Jean Coutu",
    });
  });

  it("construit l'URL exacte de cet examen", () => {
    const exam = schedule.exams.find((e) => e.courseCode === "STT1700" && e.kind === "intra")!;
    const url = googleCalendarUrl({
      title: examSummary(exam),
      date: exam.date,
      start: exam.start,
      end: exam.end,
      location: formatLocation(exam.location),
    });
    expect(url).toBe(
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=STT1700%20%E2%80%94%20Examen%20intra" +
        "&dates=20261007T133000/20261007T153000" +
        "&ctz=America%2FToronto" +
        "&location=S1-151%2C%20Pavillon%20Jean%20Coutu",
    );
  });

  it("donne une URL distincte et déterministe pour chacun des neuf examens", () => {
    const urls = schedule.exams.map((e) =>
      googleCalendarUrl({ title: examSummary(e), date: e.date, start: e.start, end: e.end }),
    );
    expect(urls).toHaveLength(9);
    expect(new Set(urls).size).toBe(9);
    for (const u of urls) expect(u.startsWith(`${GCAL_BASE}?action=TEMPLATE&`)).toBe(true);
    // Deux appels sur la même entrée donnent la même URL.
    const again = schedule.exams.map((e) =>
      googleCalendarUrl({ title: examSummary(e), date: e.date, start: e.start, end: e.end }),
    );
    expect(again).toEqual(urls);
  });

  it("ne fait fuir aucune donnée au-delà des champs reçus", () => {
    const exam = schedule.exams[0]!;
    const url = googleCalendarUrl({ title: examSummary(exam), date: exam.date, start: exam.start, end: exam.end });
    // Ni matricule, ni trimestre, ni horodatage de capture.
    expect(url).not.toContain("A26");
    expect(url).not.toContain(schedule.capturedAt);
    // Hors les deux horodatages de `dates`, aucune longue suite de chiffres :
    // c'est la forme qu'aurait un matricule ou un nº de classe s'il fuyait.
    expect(url.replace(/&dates=[^&]*/, "")).not.toMatch(/\d{5,}/);
  });
});
