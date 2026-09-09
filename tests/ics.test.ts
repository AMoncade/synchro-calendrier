import { describe, expect, it } from "vitest";
import type { Schedule } from "../src/core/model";
import { expandSchedule } from "../src/core/expand";
import {
  compactCode,
  courseSummary,
  escapeText,
  examSummary,
  examUid,
  foldLine,
  formatDtstamp,
  generateIcs,
  meetingUid,
  torontoLocalToUtc,
  torontoUtcOffsetMinutes,
} from "../src/core/ics";

// Automne 2026 : 1er septembre = mardi, 1er novembre = 1er dimanche de novembre
// (retour à l'heure normale), donc PHY1441 traverse le changement d'heure.
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
        // Local tel que Synchro l'écrit vraiment : deux espaces, numéro civique.
        { weekday: 3, start: "13:30", end: "15:30", location: "B-0215  Pav. 3200 J.-Brillant", dateStart: "2026-09-07", dateEnd: "2026-09-30" },
      ],
    },
    {
      code: "IFT1015",
      title: "Programmation 1",
      section: "B",
      component: "TP",
      meetings: [
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
    {
      code: "PHY1441",
      title: "Mécanique classique",
      section: "A01",
      component: "TH",
      meetings: [
        // Cours du soir sur tout le trimestre : force le pliage (local long et
        // accentué) et le cas UNTIL (19:00 EST = 00:00Z le lendemain).
        {
          weekday: 4,
          start: "19:00",
          end: "22:00",
          location:
            "Pavillon Roger-Gaudry, salle Z-110 — Université de Montréal, campus de la montagne, Montréal (Québec), Canada",
          dateStart: "2026-09-03",
          dateEnd: "2026-12-10",
          note: "Apporter la calculatrice; manuel obligatoire",
        },
      ],
    },
  ],
  exams: [
    { courseCode: "MAT1400", kind: "intra", date: "2026-10-20", start: "08:30", end: "11:30", location: "Z-110", label: "Examen intra" },
    { courseCode: "PHY1441", kind: "final", date: "2026-12-17", start: "09:00", end: "12:00", location: "Z-110", label: "Examen final" },
  ],
};

// 09-03 : première occurrence de PHY (DTSTART doit glisser au 09-10).
// 09-14 : un lundi de MAT. 10-22 : un jeudi de PHY (semaine de relâche).
// 10-12 : lundi hors plage de MAT (aucun EXDATE attendu).
const excludedDates = ["2026-09-03", "2026-09-14", "2026-10-22", "2026-10-12"];
const dtstamp = "2026-09-09T12:00:00Z";
const ics = generateIcs(fixture, { excludedDates, dtstamp });

// ---------------------------------------------------------------------------
// Mini-parseur ICS : indépendant du générateur, sert d'oracle au test (c).

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Recolle les lignes pliées (continuation = espace en tête). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\r\n")) {
    if (raw.startsWith(" ") && out.length > 0) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  if (out.at(-1) === "") out.pop();
  return out;
}

function parseProperty(line: string): Property {
  const colon = line.indexOf(":");
  const head = line.slice(0, colon);
  const [name = "", ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    params[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return { name, params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function parseEvents(text: string): Property[][] {
  const events: Property[][] = [];
  let current: Property[] | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT") {
      events.push(current!);
      current = null;
    } else if (current) current.push(parseProperty(line));
  }
  return events;
}

function prop(event: Property[], name: string): Property | undefined {
  return event.find((p) => p.name === name);
}

/** "20260907T083000" → ["2026-09-07", "08:30"]. */
function splitLocal(value: string): [string, string] {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}$/.exec(value)!;
  return [`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}:${m[5]}`];
}

// Réimplémentation volontairement indépendante de la règle d'heure avancée.
function nthSunday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((7 - first) % 7) + 7 * (n - 1);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Instant UTC (ms) d'une date-heure locale Toronto, hors heures de transition. */
function torontoInstant(date: string, time: string): number {
  const year = Number(date.slice(0, 4));
  const dst = date >= nthSunday(year, 3, 2) && date < nthSunday(year, 11, 1);
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  return Date.UTC(y, mo - 1, d, h + (dst ? 4 : 5), mi);
}

function parseUtc(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)!;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

interface Flat {
  date: string;
  start: string;
  end: string;
  label: string;
  location: string;
}

/** Développe un VEVENT (DTSTART + RRULE hebdomadaire − EXDATE) en instances. */
function flattenEvent(event: Property[]): Flat[] {
  const [date, start] = splitLocal(prop(event, "DTSTART")!.value);
  const [, end] = splitLocal(prop(event, "DTEND")!.value);
  const label = unescapeText(prop(event, "SUMMARY")!.value);
  const location = unescapeText(prop(event, "LOCATION")!.value);
  const rrule = prop(event, "RRULE");
  if (!rrule) return [{ date, start, end, label, location }];

  const parts = Object.fromEntries(rrule.value.split(";").map((kv) => kv.split("=") as [string, string]));
  expect(parts["FREQ"]).toBe("WEEKLY");
  const untilMs = parseUtc(parts["UNTIL"]!);
  const exdates = new Set((prop(event, "EXDATE")?.value ?? "").split(",").filter(Boolean).map((v) => splitLocal(v)[0]));

  const out: Flat[] = [];
  let ms = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  for (;;) {
    const d = new Date(ms).toISOString().slice(0, 10);
    if (torontoInstant(d, start) > untilMs) break;
    if (!exdates.has(d)) out.push({ date: d, start, end, label, location });
    ms += 7 * 86_400_000;
  }
  return out;
}

const byKey = (a: Flat, b: Flat) => `${a.date}${a.start}${a.label}`.localeCompare(`${b.date}${b.start}${b.label}`);

// ---------------------------------------------------------------------------

describe("fuseau America/Toronto", () => {
  it("bascule le 2e dimanche de mars et le 1er dimanche de novembre à 02:00", () => {
    expect(torontoUtcOffsetMinutes("2026-03-08", "01:59")).toBe(-300);
    expect(torontoUtcOffsetMinutes("2026-03-08", "02:00")).toBe(-240);
    expect(torontoUtcOffsetMinutes("2026-07-01", "12:00")).toBe(-240);
    expect(torontoUtcOffsetMinutes("2026-11-01", "01:59")).toBe(-240);
    expect(torontoUtcOffsetMinutes("2026-11-01", "02:00")).toBe(-300);
    expect(torontoUtcOffsetMinutes("2026-01-15", "12:00")).toBe(-300);
  });

  it("convertit une heure locale en UTC", () => {
    expect(torontoLocalToUtc("2026-09-28", "23:59:59")).toBe("20260929T035959Z");
    expect(torontoLocalToUtc("2026-12-10", "23:59:59")).toBe("20261211T045959Z");
    expect(torontoLocalToUtc("2026-12-10", "19:00")).toBe("20261211T000000Z");
  });

  it("normalise dtstamp", () => {
    expect(formatDtstamp("2026-09-09T12:00:00Z")).toBe("20260909T120000Z");
    expect(formatDtstamp("20260909T120000Z")).toBe("20260909T120000Z");
    expect(() => formatDtstamp("hier")).toThrow();
  });
});

describe("texte RFC 5545", () => {
  it("échappe \\ ; , et les sauts de ligne", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("plie en octets UTF-8, jamais au milieu d'un caractère", () => {
    const line = "LOCATION:" + "é".repeat(100); // 209 octets
    const physical = foldLine(line);
    expect(physical.length).toBeGreaterThan(1);
    for (const p of physical) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    for (const p of physical.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(physical[0] + physical.slice(1).map((p) => p.slice(1)).join("")).toBe(line);
  });

  it("ne plie pas une ligne courte", () => {
    expect(foldLine("VERSION:2.0")).toEqual(["VERSION:2.0"]);
  });
});

describe("generateIcs — structure", () => {
  const lines = unfold(ics);
  const events = parseEvents(ics);

  it("ouvre et ferme le calendrier avec l'en-tête attendu", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//synchro-calendrier//UdeM//FR");
    expect(lines).toContain("CALSCALE:GREGORIAN");
    expect(lines).toContain("X-WR-CALNAME:UdeM — Automne 2026");
    expect(lines).toContain("X-WR-TIMEZONE:America/Toronto");
  });

  it("respecte calName", () => {
    const custom = generateIcs(fixture, { excludedDates, dtstamp, calName: "Cours, A26" });
    expect(unfold(custom)).toContain("X-WR-CALNAME:Cours\\, A26");
  });

  it("contient un VTIMEZONE America/Toronto complet", () => {
    const start = lines.indexOf("BEGIN:VTIMEZONE");
    const end = lines.indexOf("END:VTIMEZONE");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const tz = lines.slice(start, end + 1);
    expect(tz).toContain("TZID:America/Toronto");
    expect(tz).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(tz).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    const daylight = tz.slice(tz.indexOf("BEGIN:DAYLIGHT"), tz.indexOf("END:DAYLIGHT"));
    expect(daylight).toEqual(expect.arrayContaining(["TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "DTSTART:19700308T020000"]));
    const standard = tz.slice(tz.indexOf("BEGIN:STANDARD"), tz.indexOf("END:STANDARD"));
    expect(standard).toEqual(expect.arrayContaining(["TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "DTSTART:19701101T020000"]));
    // Le VTIMEZONE précède le premier VEVENT.
    expect(end).toBeLessThan(lines.indexOf("BEGIN:VEVENT"));
  });

  it("émet un VEVENT par meeting et par examen", () => {
    expect(events).toHaveLength(4 + 2);
    expect(events.filter((e) => prop(e, "RRULE"))).toHaveLength(4);
    expect(events.filter((e) => !prop(e, "RRULE"))).toHaveLength(2);
  });

  it("n'utilise que CRLF", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("ne dépasse jamais 75 octets par ligne physique et plie au moins une ligne", () => {
    const physical = ics.split("\r\n");
    for (const p of physical) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(physical.some((p) => p.startsWith(" "))).toBe(true);
    expect(physical.some((p) => p.startsWith(" ") && /[éèà]/.test(p))).toBe(true);
  });

  it("échappe la virgule d'un local et le point-virgule d'une note", () => {
    expect(lines).toContain("LOCATION:Pavillon André-Aisenstadt\\, salle 3195");
    expect(lines.some((l) => l.includes("calculatrice\\; manuel"))).toBe(true);
    expect(lines.some((l) => l.startsWith("DESCRIPTION:Mécanique classique\\n"))).toBe(true);
  });

  it("étiquette et décrit les séances (v2 §9.3)", () => {
    const mat = events.find((e) => prop(e, "UID")!.value.startsWith("A26-MAT1400-A-TH-1-"))!;
    expect(prop(mat, "SUMMARY")!.value).toBe("MAT1400-A — Théorie");
    expect(prop(mat, "LOCATION")!.value).toBe("AA-1360");
    expect(prop(mat, "DESCRIPTION")!.value).toBe("Calcul 1\\nclasse nº 12345");
    expect(prop(mat, "CATEGORIES")!.value).toBe("Cours");
    // Volet en toutes lettres, et le sigle perd son espace.
    const ift = events.find((e) => prop(e, "UID")!.value.startsWith("A26-IFT1015-B-TP-"))!;
    expect(prop(ift, "SUMMARY")!.value).toBe("IFT1015-B — Travaux pratiques");
    // Sans nº de classe : la description se réduit au titre.
    expect(prop(ift, "DESCRIPTION")!.value).toBe("Programmation 1");
  });

  it("normalise le local du pavillon dans le VEVENT", () => {
    const mer = events.find((e) => prop(e, "UID")!.value.startsWith("A26-MAT1400-A-TH-3-"))!;
    expect(prop(mer, "LOCATION")!.value).toBe("B-0215\\, Pavillon J.-Brillant");
  });

  it("étiquette les examens (v2 §9.3)", () => {
    const exams = events.filter((e) => !prop(e, "RRULE"));
    expect(exams.map((e) => prop(e, "SUMMARY")!.value)).toEqual([
      "MAT1400 — Examen intra",
      "PHY1441 — Examen final",
    ]);
    for (const e of exams) expect(prop(e, "CATEGORIES")!.value).toBe("Examen");
    const other = generateIcs(
      { ...fixture, courses: [], exams: [{ ...fixture.exams[0]!, kind: "autre", label: "Test 2" }] },
      { excludedDates, dtstamp },
    );
    expect(prop(parseEvents(other)[0]!, "SUMMARY")!.value).toBe("MAT1400 — Test 2");
  });
});

describe("libellés et locaux v2", () => {
  it("compacte le sigle", () => {
    expect(compactCode("MAT 1400")).toBe("MAT1400");
    expect(compactCode("MAT1400")).toBe("MAT1400");
  });

  it("compose le SUMMARY d'une séance et d'un examen", () => {
    expect(courseSummary(fixture.courses[0]!)).toBe("MAT1400-A — Théorie");
    expect(courseSummary({ ...fixture.courses[0]!, component: "LAB" })).toBe("MAT1400-A — Laboratoire");
    expect(courseSummary({ ...fixture.courses[0]!, component: "AUTRE" })).toBe("MAT1400-A — Autre");
    // Section absente : pas de tiret orphelin.
    expect(courseSummary({ ...fixture.courses[0]!, section: "" })).toBe("MAT1400 — Théorie");
    expect(examSummary(fixture.exams[0]!)).toBe("MAT1400 — Examen intra");
    expect(examSummary({ ...fixture.exams[0]!, kind: "final" })).toBe("MAT1400 — Examen final");
    expect(examSummary({ ...fixture.exams[0]!, kind: "autre", label: "" })).toBe("MAT1400 — Examen");
  });

  // La règle du local (« Pav. », numéro civique, « En ligne », texte inconnu)
  // est couverte par tests/format.test.ts, qui appartient à `fullLocation`.
  // Ici, seul compte le fait que le VEVENT passe bien par cette fonction : c'est
  // l'objet du test « normalise le local du pavillon dans le VEVENT » ci-dessus.
});

describe("rappels VALARM (v2 §9.2)", () => {
  /** Les VALARM d'un VEVENT, sous forme de paires [TRIGGER, DESCRIPTION]. */
  const alarmsOf = (text: string, uidPrefix: string): [string, string][] => {
    const lines = unfold(text);
    const out: [string, string][] = [];
    let inTarget = false;
    let trigger = "";
    for (const line of lines) {
      if (line.startsWith("UID:")) inTarget = line.slice(4).startsWith(uidPrefix);
      if (!inTarget) continue;
      if (line.startsWith("TRIGGER:")) trigger = line.slice(8);
      if (line.startsWith("DESCRIPTION:") && trigger) {
        out.push([trigger, line.slice(12)]);
        trigger = "";
      }
    }
    return out;
  };

  it("pose deux rappels sur un examen par défaut, aucun sur un cours", () => {
    expect(alarmsOf(ics, "A26-MAT1400-examen-")).toEqual([
      ["-PT24H", "MAT1400 — Examen intra"],
      ["-PT1H", "MAT1400 — Examen intra"],
    ]);
    expect(alarmsOf(ics, "A26-MAT1400-A-TH-1-")).toEqual([]);
  });

  it("pose un rappel de 15 min sur les cours quand on le demande", () => {
    const withCourses = generateIcs(fixture, { excludedDates, dtstamp, alarms: { courses: true } });
    expect(alarmsOf(withCourses, "A26-MAT1400-A-TH-1-")).toEqual([["-PT15M", "MAT1400-A — Théorie"]]);
    // `alarms` partiel : `exams` garde sa valeur par défaut.
    expect(alarmsOf(withCourses, "A26-MAT1400-examen-")).toHaveLength(2);
  });

  it("n'écrit aucun VALARM quand tout est désactivé", () => {
    const none = generateIcs(fixture, { excludedDates, dtstamp, alarms: { exams: false, courses: false } });
    expect(none).not.toContain("BEGIN:VALARM");
    expect(none).not.toContain("TRIGGER:");
  });

  it("place les VALARM à l'intérieur du VEVENT, jamais après", () => {
    const withCourses = generateIcs(fixture, { excludedDates, dtstamp, alarms: { courses: true } });
    const lines = unfold(withCourses);
    let depth = 0;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") depth++;
      if (line === "BEGIN:VALARM") expect(depth).toBe(1);
      if (line === "END:VALARM") expect(depth).toBe(1);
      if (line === "END:VEVENT") depth--;
    }
    expect(depth).toBe(0);
    // Chaque VALARM est clos avant la fin de son VEVENT.
    expect(withCourses.match(/BEGIN:VALARM/g)!.length).toBe(withCourses.match(/END:VALARM/g)!.length);
    expect(withCourses).not.toContain("END:VEVENT\r\nEND:VALARM");
  });

  it("reste conforme au pliage et au CRLF avec les rappels activés", () => {
    const withCourses = generateIcs(fixture, { excludedDates, dtstamp, alarms: { courses: true } });
    expect(withCourses.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const p of withCourses.split("\r\n")) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("generateIcs — récurrences", () => {
  const events = parseEvents(ics);
  const byUid = (prefix: string) => events.find((e) => prop(e, "UID")!.value.startsWith(prefix))!;

  it("place DTSTART/DTEND sur la première occurrence non exclue", () => {
    const mat = byUid("A26-MAT1400-A-TH-1-0830-");
    expect(prop(mat, "DTSTART")).toMatchObject({ params: { TZID: "America/Toronto" }, value: "20260907T083000" });
    expect(prop(mat, "DTEND")).toMatchObject({ params: { TZID: "America/Toronto" }, value: "20260907T103000" });
    // IFT : dateStart un lundi, première occurrence le mardi.
    expect(prop(byUid("A26-IFT1015-B-TP-2-1630-"), "DTSTART")!.value).toBe("20260908T163000");
    // PHY : 09-03 exclu, DTSTART glisse au 09-10 et n'apparaît pas en EXDATE.
    const phy = byUid("A26-PHY1441-A01-TH-4-1900-");
    expect(prop(phy, "DTSTART")!.value).toBe("20260910T190000");
    expect(prop(phy, "EXDATE")!.value).not.toContain("20260903");
  });

  it("liste les EXDATE à l'heure de DTSTART, seulement pour les dates de la série", () => {
    expect(prop(byUid("A26-MAT1400-A-TH-1-0830-"), "EXDATE")).toMatchObject({
      params: { TZID: "America/Toronto" },
      value: "20260914T083000",
    });
    expect(prop(byUid("A26-PHY1441-A01-TH-4-1900-"), "EXDATE")!.value).toBe("20261022T190000");
    expect(prop(byUid("A26-MAT1400-A-TH-3-1330-"), "EXDATE")).toBeUndefined();
    expect(prop(byUid("A26-IFT1015-B-TP-2-1630-"), "EXDATE")).toBeUndefined();
  });

  it("borne la série par UNTIL en UTC = fin de dateEnd en heure de Toronto", () => {
    // 2026-09-28 23:59:59 EDT → 2026-09-29 03:59:59Z ; 2026-12-10 23:59:59 EST → 04:59:59Z.
    expect(prop(byUid("A26-MAT1400-A-TH-1-0830-"), "RRULE")!.value).toBe("FREQ=WEEKLY;UNTIL=20260929T035959Z");
    expect(prop(byUid("A26-PHY1441-A01-TH-4-1900-"), "RRULE")!.value).toBe("FREQ=WEEKLY;UNTIL=20261211T045959Z");
  });

  it("omet un meeting dont toutes les occurrences sont exclues", () => {
    const out = generateIcs(fixture, {
      excludedDates: ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"],
      dtstamp,
    });
    const uids = parseEvents(out).map((e) => prop(e, "UID")!.value);
    expect(uids).not.toContain("A26-MAT1400-A-TH-1-0830-20260907@synchro-calendrier");
    expect(uids).toHaveLength(5);
  });
});

describe("generateIcs — identité et déterminisme", () => {
  const events = parseEvents(ics);

  it("dérive des UID stables du modèle", () => {
    expect(meetingUid("A26", fixture.courses[0]!, fixture.courses[0]!.meetings[0]!)).toBe(
      "A26-MAT1400-A-TH-1-0830-20260907@synchro-calendrier",
    );
    expect(examUid("A26", fixture.exams[0]!)).toBe("A26-MAT1400-examen-2026-10-20@synchro-calendrier");
    const uids = events.map((e) => prop(e, "UID")!.value);
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids).toContain("A26-PHY1441-examen-2026-12-17@synchro-calendrier");
  });

  it("utilise opts.dtstamp partout et jamais l'heure courante", () => {
    for (const e of events) expect(prop(e, "DTSTAMP")!.value).toBe("20260909T120000Z");
    const again = generateIcs(fixture, { excludedDates, dtstamp });
    expect(again).toBe(ics);
    const other = generateIcs(fixture, { excludedDates, dtstamp: "20250101T000000Z" });
    const diff = other.split("\r\n").filter((l, i) => l !== ics.split("\r\n")[i]);
    expect(diff.every((l) => l === "DTSTAMP:20250101T000000Z")).toBe(true);
    expect(diff).toHaveLength(6);
  });
});

// Table explicite entre les libellés d'`expand.ts` (popup, conflits) et ceux de
// l'ICS v2. Écrite à la main plutôt que calculée par `courseSummary` : un test
// qui appelle la fonction qu'il vérifie ne prouve rien.
const V2_SUMMARY: Record<string, string> = {
  "MAT 1400-A Calcul 1 (TH)": "MAT1400-A — Théorie",
  "IFT 1015-B Programmation 1 (TP)": "IFT1015-B — Travaux pratiques",
  "PHY 1441-A01 Mécanique classique (TH)": "PHY1441-A01 — Théorie",
  "MAT 1400 — Examen intra": "MAT1400 — Examen intra",
  "PHY 1441 — Examen final": "PHY1441 — Examen final",
};
const V2_LOCATION: Record<string, string> = {
  "B-0215  Pav. 3200 J.-Brillant": "B-0215, Pavillon J.-Brillant",
};

/** Occurrence d'`expandSchedule` traduite dans les conventions de l'ICS v2. */
function asV2(o: { date: string; start: string; end: string; label: string; location: string }): Flat {
  const label = V2_SUMMARY[o.label];
  if (label === undefined) throw new Error(`Libellé non traduit dans V2_SUMMARY : ${o.label}`);
  return { date: o.date, start: o.start, end: o.end, label, location: V2_LOCATION[o.location] ?? o.location };
}

describe("generateIcs — ré-analyse (DTSTART + RRULE − EXDATE ≡ expandSchedule)", () => {
  it("représente exactement chaque occurrence attendue", () => {
    const expected: Flat[] = expandSchedule(fixture, { excludedDates }).map(asV2).sort(byKey);
    const actual = parseEvents(ics).flatMap(flattenEvent).sort(byKey);
    expect(actual).toEqual(expected);
    // Garde-fou : la série de PHY traverse le retour à l'heure normale et se
    // termine par un cours du soir le 10 décembre.
    expect(actual.filter((o) => o.label.startsWith("PHY1441-A01")).at(-1)).toMatchObject({ date: "2026-12-10", start: "19:00" });
    expect(actual.filter((o) => o.label.startsWith("PHY1441-A01"))).toHaveLength(15 - 2);
  });

  it("reste exact sans aucune exclusion", () => {
    const none = generateIcs(fixture, { excludedDates: [], dtstamp });
    const expected = expandSchedule(fixture, { excludedDates: [] }).map(asV2).sort(byKey);
    expect(parseEvents(none).flatMap(flattenEvent).sort(byKey)).toEqual(expected);
  });
});
